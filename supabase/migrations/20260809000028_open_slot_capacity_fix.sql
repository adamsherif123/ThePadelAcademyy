-- ============================================================================
-- Bug fix — an open (untyped) slot's capacity never followed the type its
-- first booking chose, unless that choice was 'individual'.
--
-- book_slot / admin_book_player's guarded UPDATE already forces capacity to 1
-- the moment a booking types a previously-open slot as 'individual' (and
-- stashes the pre-image into pre_booking_capacity for the revert). Every OTHER
-- type — group, duo, trial — fell through the CASE's `else capacity end`
-- branch untouched, so the slot kept whatever capacity the admin gave it at
-- creation (the physical seat ceiling, e.g. 4) regardless of which type won.
-- Device repro: admin creates an open slot (default capacity 4), a player
-- books it choosing 'duo' — training_type correctly becomes 'duo', but
-- capacity stays 4, so spotsUntilConfirmed (capacity - booked_count) reads 3
-- more needed instead of duo's real 1.
--
-- Root cause confirmed DB-side, not a display bug: spotsUntilConfirmed
-- (@tpa/core rules.ts) and isSessionConfirmed just read slot.capacity/
-- bookedCount straight off the row — correct once the row itself is correct.
-- The one client-side thing that WAS wrong is a separate, adjacent bug: the
-- type picker's "You + N others" copy (pick-type.tsx) computed N from
-- `slot.capacity` too, which is ALSO the admin's still-untyped default at the
-- point a player is choosing a type — pre-booking, so it must derive from the
-- canonical map, never the slot's row. Fixed in the same commit as this
-- migration (apps/mobile/src/app/pick-type.tsx now reads CANONICAL_CAPACITY).
--
-- FIX — generalize the existing individual-only CASE to every type via a new
-- tpa.canonical_capacity(text) helper (mirrors tpa.cancellation_window() /
-- tpa.credit_expiry()'s existing pattern: one SQL function, referenced from
-- both RPCs, MIRRORED IN TS as @tpa/core's CANONICAL_CAPACITY — sql-parity.
-- test.ts asserts the two can never drift). Purely additive to the proven
-- guarded UPDATE: the WHERE clause, the lock/guard shape, and every other SET
-- term are byte-identical to 20260805000024/20260806000025 — only the
-- capacity/pre_booking_capacity CASE conditions widen from
-- `v_effective_type = 'individual'` to unconditional (now that the THEN branch
-- itself is a per-type lookup instead of a hardcoded 1).
--
-- The `training_type is null` guard on both CASEs is UNCHANGED and is exactly
-- what answers the admin-preset-capacity question: it only ever fires when the
-- PRE-image training_type was null — i.e. this is the first booking fixing a
-- genuinely open slot. An admin who pre-set a type (and capacity) at creation
-- never has a null training_type to begin with, so this CASE never touches
-- their row — their explicit capacity (a WhatsApp class might genuinely be an
-- odd size) is untouched, exactly as individual's existing behaviour already
-- established for one type; this migration just extends the same guarantee to
-- the other three.
--
-- least(capacity, tpa.canonical_capacity(...)), not a bare overwrite — caught
-- by concurrency.sh Scenario J under real execution: an admin's open slot can
-- have a SMALLER physical capacity than a type's canonical number (e.g. an
-- admin-created capacity-1 open slot), and a bare `capacity :=
-- canonical_capacity(v_effective_type)` would WIDEN it the moment a booking
-- chose 'duo' (canonical 2) — admitting a genuine second racer past the
-- admin's stated physical seat ceiling the instant the first booking landed
-- (Scenario J went from 1 winner to 2 under this bug). `least()` only ever
-- narrows capacity toward canonical, matching 'individual''s pre-existing,
-- always-narrowing behaviour (its canonical of 1 can never exceed any valid
-- admin capacity >= 1, so `least()` is a no-op change for individual/trial —
-- this is purely a widening-guard for duo/group). The original bug report is
-- still fixed: an admin's ordinary open-slot default (e.g. 4) still narrows to
-- duo's real 2 / group's real 4 exactly as intended; only a slot the admin
-- deliberately capped BELOW a type's canonical size stays at the admin's
-- number instead of growing past it.
-- ============================================================================

-- Mirrors @tpa/core CANONICAL_CAPACITY. The seat ceiling a session type
-- implies once a BOOKING (not an admin preset) fixes it.
create or replace function tpa.canonical_capacity(p_training_type text)
  returns integer language sql immutable
  as $$
    select case p_training_type
      when 'individual' then 1
      when 'trial'      then 1
      when 'duo'        then 2
      when 'group'      then 4
    end
  $$;

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
  if v_slot.gender is not null and v_slot.gender <> v_pgender then
    return jsonb_build_object('ok', false, 'reason', 'gender_mismatch');
  end if;
  -- level_mismatch removed — level is display-only (rule 4); no code blocks a
  -- mismatched join. gender_mismatch above is the ladies/men separation and is
  -- preserved unchanged. This is the UNLOCKED peek — see the guarded WHERE
  -- below for the race-safe re-check against the committed row (FIX 1).

  -- Resolve the effective training type (rule 1 + rule 2).
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

  -- Credit check re-pointed at the CHOICE, not the slot's (possibly absent)
  -- pre-set type.
  select id into v_batch_id
  from public.credit_batches
  where player_id = v_player and training_type = v_effective_type
    and quantity_remaining > 0 and expires_at > now()
  order by expires_at asc, id asc
  limit 1;
  if v_batch_id is null then return jsonb_build_object('ok', false, 'reason', 'no_usable_credit'); end if;

  v_booking_id := 'bk_' || gen_random_uuid();
  begin
    -- Guarded increment: WHERE gains the type clause (20260804000023) and now
    -- ALSO a gender clause (FIX 1) — a racer whose gender doesn't match the
    -- COMMITTED value matches zero rows here, same EvalPlanQual mechanism that
    -- already proves the type race. The SET terms are unchanged EXCEPT the
    -- capacity/pre_booking_capacity CASEs, which now cover every type via
    -- tpa.canonical_capacity instead of just 'individual' (this migration).
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
        and (gender is null or gender = v_pgender)
      returning booked_count, capacity into v_new_count, v_capacity;
    if not found then
      select * into v_slot from public.session_slots where id = p_slot_id;
      if not found then                    return jsonb_build_object('ok', false, 'reason', 'slot_missing');   end if;
      if v_slot.status <> 'published' then return jsonb_build_object('ok', false, 'reason', 'slot_cancelled'); end if;
      if v_slot.starts_at <= now() then    return jsonb_build_object('ok', false, 'reason', 'slot_in_past');  end if;
      if v_slot.gender is not null and v_slot.gender <> v_pgender then
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

-- admin_book_player gets the identical, additive CASE-widening treatment.
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
