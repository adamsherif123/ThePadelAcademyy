-- ============================================================================
-- S11.1 — confirmation: DERIVED fill, STICKY manual. Corrects S11's design.
--
-- The rule is now:  confirmed  ⇔  booked_count >= capacity  OR  manually confirmed.
-- Fill-confirmation is DERIVED (it drops back to pending when the slot un-fills) —
-- a duo at 1/2 is never "confirmed", which S11's sticky-fill wrongly claimed. Only
-- MANUAL confirmation (the admin's Confirm button) is sticky: "4/4 → 3/4 but I'm
-- still running it" is her decision, not an assumption the system makes for her.
--
-- Consequences:
--  1. book_slot / admin_book_player stop writing the column entirely — reverted to
--     the byte-identical S7b bodies (the guarded increment raced 40 ways in S7a; the
--     line that produced 24 orphan bookings when S11 rebased it wrong). It should
--     stop being touched.
--  2. The column is set ONLY by confirm_session, so it means "manually confirmed at",
--     not "the moment it became confirmed" — renamed so the name can't mislead.
--  3. No backfill needed: a pre-migration full session reads confirmed via
--     booked_count >= capacity (fixes the "PENDING · 0 TO FILL" an already-full
--     individual showed — its confirmed_at was NULL and the old sticky read pending).
-- ============================================================================

alter table public.session_slots rename column confirmed_at to manually_confirmed_at;

-- ── book_slot: reverted to the byte-identical S7b body (writes no confirmation) ──
create or replace function public.book_slot(p_slot_id text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_player     text;
  v_slot       public.session_slots;
  v_pgender    text;
  v_plevel     text;
  v_batch_id   text;
  v_booking_id text;
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
  if v_slot.gender is not null and v_slot.gender <> v_pgender then
    return jsonb_build_object('ok', false, 'reason', 'gender_mismatch');
  end if;
  if v_slot.level is not null and v_slot.level <> v_plevel then
    return jsonb_build_object('ok', false, 'reason', 'level_mismatch');
  end if;

  select id into v_batch_id
  from public.credit_batches
  where player_id = v_player and training_type = v_slot.training_type
    and quantity_remaining > 0 and expires_at > now()
  order by expires_at asc, id asc
  limit 1;
  if v_batch_id is null then return jsonb_build_object('ok', false, 'reason', 'no_usable_credit'); end if;

  v_booking_id := 'bk_' || gen_random_uuid();
  begin
    -- Guarded increment now gates on status + start too, so a concurrent
    -- cancel_session that commits first makes this match zero rows.
    update public.session_slots
      set booked_count = booked_count + 1
      where id = p_slot_id and booked_count < capacity
        and status = 'published' and starts_at > now();
    if not found then
      -- Distinguish the reason without changing the union. (Slot re-read under the
      -- current snapshot; no mutation happened, so a plain return is safe.)
      select * into v_slot from public.session_slots where id = p_slot_id;
      if not found then                    return jsonb_build_object('ok', false, 'reason', 'slot_missing');   end if;
      if v_slot.status <> 'published' then return jsonb_build_object('ok', false, 'reason', 'slot_cancelled'); end if;
      if v_slot.starts_at <= now() then    return jsonb_build_object('ok', false, 'reason', 'slot_in_past');  end if;
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

  return jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'credit_batch_id', v_batch_id);
end;
$$;

-- ── admin_book_player: reverted to the byte-identical S7b body ───────────────────
create or replace function public.admin_book_player(p_slot_id text, p_player_id text, p_override boolean)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_slot        public.session_slots;
  v_pgender     text;
  v_plevel      text;
  v_batch_id    text;
  v_booking_id  text;
  v_mismatch    boolean := false;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;

  select * into v_slot from public.session_slots where id = p_slot_id;
  if not found then                       return jsonb_build_object('ok', false, 'reason', 'slot_missing');    end if;
  select gender, level into v_pgender, v_plevel from public.players where id = p_player_id;
  if not found then                       return jsonb_build_object('ok', false, 'reason', 'player_missing');  end if;
  if v_slot.status <> 'published' then    return jsonb_build_object('ok', false, 'reason', 'slot_cancelled'); end if;
  if v_slot.starts_at <= now() then       return jsonb_build_object('ok', false, 'reason', 'slot_in_past');   end if;

  v_mismatch := (v_slot.gender is not null and v_slot.gender <> v_pgender)
             or (v_slot.level  is not null and v_slot.level  <> v_plevel);
  if not p_override then
    if v_slot.gender is not null and v_slot.gender <> v_pgender then
      return jsonb_build_object('ok', false, 'reason', 'gender_mismatch');
    end if;
    if v_slot.level is not null and v_slot.level <> v_plevel then
      return jsonb_build_object('ok', false, 'reason', 'level_mismatch');
    end if;
  end if;

  select id into v_batch_id
  from public.credit_batches
  where player_id = p_player_id and training_type = v_slot.training_type
    and quantity_remaining > 0 and expires_at > now()
  order by expires_at asc, id asc
  limit 1;
  if v_batch_id is null then return jsonb_build_object('ok', false, 'reason', 'no_usable_credit'); end if;

  v_booking_id := 'bk_' || gen_random_uuid();
  begin
    update public.session_slots
      set booked_count = booked_count + 1
      where id = p_slot_id and booked_count < capacity
        and status = 'published' and starts_at > now();
    if not found then
      select * into v_slot from public.session_slots where id = p_slot_id;
      if v_slot.status <> 'published' then return jsonb_build_object('ok', false, 'reason', 'slot_cancelled'); end if;
      if v_slot.starts_at <= now() then    return jsonb_build_object('ok', false, 'reason', 'slot_in_past');  end if;
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

  return jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'credit_batch_id', v_batch_id,
    'overridden', (p_override and v_mismatch));
end;
$$;

-- ── confirm_session: unchanged behaviour, now writes manually_confirmed_at ───────
-- Manual confirmation is STICKY (survives an un-fill). Idempotent, admin-only,
-- rejects a cancelled or past slot. Touches only the confirmation column.
create or replace function public.confirm_session(p_slot_id text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_slot public.session_slots;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;

  select * into v_slot from public.session_slots where id = p_slot_id for update;
  if not found then                       return jsonb_build_object('ok', false, 'reason', 'slot_missing');    end if;
  if v_slot.status = 'cancelled' then     return jsonb_build_object('ok', false, 'reason', 'slot_cancelled'); end if;
  if v_slot.starts_at <= now() then       return jsonb_build_object('ok', false, 'reason', 'slot_in_past');   end if;

  -- Idempotent: already manually confirmed → no-op success (keep the audit time).
  if v_slot.manually_confirmed_at is not null then
    return jsonb_build_object('ok', true, 'already_confirmed', true);
  end if;

  update public.session_slots set manually_confirmed_at = now() where id = p_slot_id;
  return jsonb_build_object('ok', true, 'already_confirmed', false);
end;
$$;
