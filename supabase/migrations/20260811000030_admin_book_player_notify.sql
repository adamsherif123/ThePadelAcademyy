-- ============================================================================
-- admin_book_player notifies the booked player.
--
-- Gap: when the academy books a player in manually (a WhatsApp booking, a
-- walk-in), the RPC seats them but never tells them — every OTHER
-- significant event (session confirmed, credits granted, a credit request
-- resolved) emits through tpa.notify(); this path never did. The player finds
-- out only if they happen to open the app.
--
-- FIX — additive only. One new `perform tpa.notify(...)` call on the SUCCESS
-- branch, placed exactly where the existing session_confirmed emit already
-- sits: after the guarded UPDATE + credit decrement + booking INSERT have all
-- committed inside the `begin...exception...end` block, never on the
-- unlocked pre-check peek at the top of the function. The guarded UPDATE, the
-- lock order, the credit-selection logic, and every {ok,reason} rejection
-- path are byte-identical to the live version (last redefined in
-- 20260809000028_open_slot_capacity_fix.sql) — this migration changes nothing
-- else. A rejected admin booking (gender block, no credit, slot full, type
-- mismatch, unknown player/slot, already booked) returns before this line is
-- ever reached, so it emits nothing, exactly like every other reason-path.
--
-- v_effective_type and v_slot are both already resolved by this point in the
-- function (the type-resolution block and the initial slot peek run before
-- the guarded UPDATE) and are safe to reuse here — v_slot.starts_at is never
-- mutated by this RPC, so the peek's value is still exactly correct; this is
-- the identical reasoning the existing session_confirmed emit already relies
-- on for the same field.
--
-- New type: admin_booked. Registered in the notifications.type CHECK
-- (drop+recreate, the established pattern this table already uses — see
-- 20260802000020_a3_instapay.sql's identical widening for
-- credit_request_rejected). Client-side wiring (NotificationType union, the
-- notifications-centre icon) lands in the same commit as this migration; the
-- deep-link needs NO new code — notificationHref's default branch already
-- routes any slot-carrying, non-wallet type to Sessions focused on that slot,
-- which is exactly what this type wants (verified by reading deepLink.ts).
-- The push path needs no change either — the insert trigger is unconditional
-- (`for each row`, no type filter) and send-push reads `type` only to embed
-- it in the push payload, never to gate delivery (verified by reading both).
-- ============================================================================

-- ── widen the notifications type CHECK ───────────────────────────────────────
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'session_confirmed', 'session_cancelled', 'removed_from_session',
    'session_rescheduled', 'credits_granted', 'credit_request_rejected',
    'admin_booked'));

-- ── admin_book_player: additive — one new perform tpa.notify(...), nothing else touched ──
create or replace function public.admin_book_player(
  p_slot_id text, p_player_id text, p_override boolean, p_training_type text default null
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_slot             public.session_slots;
  v_pgender          text;
  v_plevel           text;
  v_effective_type   text;
  v_batch_id         text;
  v_booking_id       text;
  v_mismatch         boolean;
  v_new_count        int;
  v_capacity         int;
  v_committed_gender text;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;

  select * into v_slot from public.session_slots where id = p_slot_id;
  if not found then                       return jsonb_build_object('ok', false, 'reason', 'slot_missing');    end if;
  select gender, level into v_pgender, v_plevel from public.players where id = p_player_id;
  if not found then                       return jsonb_build_object('ok', false, 'reason', 'player_missing');  end if;
  if v_slot.status <> 'published' then    return jsonb_build_object('ok', false, 'reason', 'slot_cancelled'); end if;
  if v_slot.starts_at <= now() then       return jsonb_build_object('ok', false, 'reason', 'slot_in_past');   end if;

  if not p_override then
    if v_slot.gender is not null and v_slot.gender <> v_pgender then
      return jsonb_build_object('ok', false, 'reason', 'gender_mismatch');
    end if;
    -- level_mismatch removed — display-only, never blocking (rule 4).
  end if;

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
  where player_id = p_player_id and training_type = v_effective_type
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
        and (p_override or gender is null or gender = v_pgender)
      returning booked_count, capacity, gender into v_new_count, v_capacity, v_committed_gender;
    if not found then
      select * into v_slot from public.session_slots where id = p_slot_id;
      if not found then                    return jsonb_build_object('ok', false, 'reason', 'slot_missing');   end if;
      if v_slot.status <> 'published' then return jsonb_build_object('ok', false, 'reason', 'slot_cancelled'); end if;
      if v_slot.starts_at <= now() then    return jsonb_build_object('ok', false, 'reason', 'slot_in_past');  end if;
      if not p_override and v_slot.gender is not null and v_slot.gender <> v_pgender then
        return jsonb_build_object('ok', false, 'reason', 'gender_mismatch');
      end if;
      if v_slot.training_type is not null and v_slot.training_type <> v_effective_type then
        return jsonb_build_object('ok', false, 'reason', 'type_mismatch');
      end if;
      return jsonb_build_object('ok', false, 'reason', 'slot_full');
    end if;

    update public.credit_batches
      set quantity_remaining = quantity_remaining - 1
      where id = v_batch_id and quantity_remaining > 0;
    if not found then raise exception 'credit race lost' using errcode = 'TP002'; end if;

    insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at, cancelled_at)
      values (v_booking_id, p_slot_id, p_player_id, v_batch_id, 'booked', now(), null);
  exception
    when sqlstate 'TP002'  then return jsonb_build_object('ok', false, 'reason', 'no_usable_credit');
    when unique_violation then return jsonb_build_object('ok', false, 'reason', 'already_booked');
  end;

  -- NEW — the only change in this migration. The booked player didn't act
  -- themselves (that's the whole reason this RPC exists), so they have no
  -- other way to find out. Fires once the seat is genuinely committed —
  -- never reached by any rejection path above.
  perform tpa.notify(
    p_player_id, 'admin_booked', 'Added to a session',
    'You''ve been added to a ' || initcap(v_effective_type) || ' session on '
      || tpa.cairo_when(v_slot.starts_at) || '.',
    p_slot_id, null);

  -- v_mismatch from the COMMITTED gender (this booking's own atomic write),
  -- not the unlocked peek — race-safe under contention.
  v_mismatch := (v_committed_gender is not null and v_committed_gender <> v_pgender);

  if v_new_count = v_capacity then
    perform tpa.notify(
      b.player_id, 'session_confirmed', 'Session confirmed',
      'Your ' || initcap(v_effective_type) || ' session on ' || tpa.cairo_when(v_slot.starts_at)
        || ' is confirmed.',
      p_slot_id, null)
    from public.bookings b
    where b.slot_id = p_slot_id and b.status = 'booked' and b.player_id <> p_player_id;
  end if;

  return jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'credit_batch_id', v_batch_id,
    'overridden', (p_override and v_mismatch));
end;
$$;
