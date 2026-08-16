-- ============================================================================
-- The 5h-empty-slot guard: an EMPTY (booked_count = 0) slot cannot be booked
-- within tpa.booking_window() (5 hours) of its starts_at. Once a slot has at
-- least one booking, the window no longer applies to later bookers on that
-- slot — this is a "don't let the FIRST person commit to a session that's
-- unlikely to fill in time" rule, not a blanket last-minute-booking ban.
--
-- ── the guard lives in the WHERE clause, not a pre-check ──
-- `and (booked_count > 0 or starts_at - now() >= tpa.booking_window())` is added
-- to the SAME guarded UPDATE that already enforces capacity/status/type — not a
-- separate `select ... if` before it. This is what makes the guard race-safe by
-- construction: the ONLY way booked_count can move away from 0 is a booking that
-- itself passed this same guard. Two concurrent "be the first booker on an empty
-- slot inside the window" attempts both evaluate the SAME pre-transaction
-- booked_count=0 state (Postgres serialises concurrent UPDATEs on one row; each
-- one's WHERE clause is evaluated against the row as it stands when that
-- transaction gets its turn) — since neither can ever succeed while the guard
-- holds, booked_count never leaves 0 inside the window, so every subsequent
-- attempt (however many) sees the identical blocked state and is rejected the
-- same way. There is no ordering where one racer "wins" — the empty+inside-
-- window state is stable until either the window passes (time moves the slot
-- from >5h to <5h, never the reverse — so it can never re-open this way) or the
-- slot somehow already had a booking before the window closed.
--
-- Symmetrically: if a slot's only booking is later CANCELLED while inside the
-- window, booked_count returns to 0 and the guard correctly re-applies (nobody
-- can re-book it as a fresh "first" booking that late) — this falls out of the
-- guard reading LIVE booked_count on every attempt, not a one-time flag set at
-- slot-creation time.
--
-- ── scope: book_slot only, NOT admin_book_player ──
-- admin_book_player shares an otherwise byte-identical guarded WHERE (by the
-- prior migration's own stated convention), but this guard is deliberately NOT
-- mirrored there. The rule is about players self-service-booking a session
-- that's unlikely to fill in time; admin_book_player exists specifically for an
-- admin's own judgment call (a WhatsApp booking, a walk-in, a phone call) —
-- exactly the override case this guard shouldn't block. admin_book_player is
-- untouched by this migration.
-- ============================================================================

-- Mirrors @tpa/core BOOKING_WINDOW_HOURS. A DIFFERENT rule from
-- tpa.cancellation_window() (that one is refund-vs-forfeit on a cancel; this one
-- is whether a first booking is allowed at all) — both happen to be 5 hours
-- today, kept as two separate named functions on purpose.
create or replace function tpa.booking_window()
  returns interval language sql immutable
  as $$ select interval '5 hours' $$;

create or replace function public.book_slot(p_slot_id text, p_training_type text default null)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_player        text;
  v_slot          public.session_slots;
  v_pgender       text;
  v_plevel        text;
  v_effective_type text;
  v_batch_id      text;
  v_booking_id    text;
  v_new_count     int;
  v_capacity      int;
begin
  v_player := public.current_player_id();
  if v_player is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  select * into v_slot from public.session_slots where id = p_slot_id;
  if not found then           return jsonb_build_object('ok', false, 'reason', 'slot_missing');   end if;
  if v_slot.status <> 'published' then return jsonb_build_object('ok', false, 'reason', 'slot_cancelled'); end if;
  if v_slot.starts_at <= now() then    return jsonb_build_object('ok', false, 'reason', 'slot_in_past');  end if;

  select gender, level into v_pgender, v_plevel from public.players where id = v_player;
  -- gender_mismatch removed here (this migration) — gender is now display-only.

  if v_slot.training_type is not null then
    if p_training_type is not null and p_training_type <> v_slot.training_type then
      return jsonb_build_object('ok', false, 'reason', 'type_mismatch');
    end if;
    v_effective_type := v_slot.training_type;
  else
    if p_training_type is null then
      return jsonb_build_object('ok', false, 'reason', 'type_required');
    end if;
    if p_training_type not in ('trial', 'group', 'duo', 'individual') then
      return jsonb_build_object('ok', false, 'reason', 'invalid_type');
    end if;
    v_effective_type := p_training_type;
  end if;

  select id into v_batch_id
  from public.credit_batches
  where player_id = v_player and training_type = v_effective_type
    and quantity_remaining > 0 and expires_at > now()
  order by expires_at asc, id asc
  limit 1;
  if v_batch_id is null then return jsonb_build_object('ok', false, 'reason', 'no_usable_credit'); end if;

  v_booking_id := 'bk_' || gen_random_uuid();
  begin
    update public.session_slots
      set booked_count = booked_count + 1,
          training_type = coalesce(training_type, v_effective_type),
          capacity = case when training_type is null
                          then least(capacity, tpa.canonical_capacity(v_effective_type)) else capacity end,
          pre_booking_capacity = case when training_type is null
                                      then capacity else pre_booking_capacity end,
          gender = case when training_type is null and v_effective_type = 'group'
                        then v_pgender else gender end,
          level = case when training_type is null and v_effective_type = 'group'
                       then v_plevel else level end,
          set_by_booking_at = case when training_type is null then now() else set_by_booking_at end
      where id = p_slot_id and booked_count < capacity
        and status = 'published' and starts_at > now()
        and (training_type is null or training_type = v_effective_type)
        -- NEW: an empty slot can't take its first booking inside the window.
        and (booked_count > 0 or starts_at - now() >= tpa.booking_window())
      returning booked_count, capacity into v_new_count, v_capacity;
    if not found then
      select * into v_slot from public.session_slots where id = p_slot_id;
      if not found then                    return jsonb_build_object('ok', false, 'reason', 'slot_missing');   end if;
      if v_slot.status <> 'published' then return jsonb_build_object('ok', false, 'reason', 'slot_cancelled'); end if;
      if v_slot.starts_at <= now() then    return jsonb_build_object('ok', false, 'reason', 'slot_in_past');  end if;
      if v_slot.training_type is not null and v_slot.training_type <> v_effective_type then
        return jsonb_build_object('ok', false, 'reason', 'type_mismatch');
      end if;
      -- NEW: report the specific reason before falling back to the generic
      -- slot_full — an empty slot inside the window isn't "full", it's closed.
      if v_slot.booked_count = 0 and v_slot.starts_at - now() < tpa.booking_window() then
        return jsonb_build_object('ok', false, 'reason', 'booking_window_closed');
      end if;
      return jsonb_build_object('ok', false, 'reason', 'slot_full');
    end if;

    update public.credit_batches
      set quantity_remaining = quantity_remaining - 1
      where id = v_batch_id and quantity_remaining > 0;
    if not found then raise exception 'credit race lost' using errcode = 'TP002'; end if;

    insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at, cancelled_at)
      values (v_booking_id, p_slot_id, v_player, v_batch_id, 'booked', now(), null);
  exception
    when sqlstate 'TP002'  then return jsonb_build_object('ok', false, 'reason', 'no_usable_credit');
    when unique_violation then return jsonb_build_object('ok', false, 'reason', 'already_booked');
  end;

  if v_new_count = v_capacity then
    perform tpa.notify(
      b.player_id, 'session_confirmed', 'Session confirmed',
      'Your ' || initcap(v_effective_type) || ' session on ' || tpa.cairo_when(v_slot.starts_at)
        || ' is confirmed.',
      p_slot_id, null)
    from public.bookings b
    where b.slot_id = p_slot_id and b.status = 'booked' and b.player_id <> v_player;
  end if;

  return jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'credit_batch_id', v_batch_id);
end;
$$;
