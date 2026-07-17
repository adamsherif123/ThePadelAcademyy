-- ============================================================================
-- S11 — session confirmation. One rule: a session is confirmed when it FILLS, or
-- when the ADMIN confirms it. That falls out of capacity (individual cap-1 confirms
-- on the first booking; duo pending at 1/2; group pending at 3/4) — no status enum,
-- no per-type rules.
--
-- STICKY + RECORDED, not derived: `confirmed_at` is set once and stays set until the
-- session is cancelled. A 4/4 group that loses a player to a cancellation is 3/4 but
-- STILL confirmed — three players who were told "you're on" are not un-told for a
-- session the coach is running. `booked_count >= capacity` would silently un-confirm.
--
-- Orthogonal to money: this touches NO refund/cancel path and never reaches
-- credit_batches. The fill-confirmation rides inside the SAME guarded increment that
-- guarantees no oversell (S7a) — the WHERE clause is untouched, so the oversell
-- proof holds; only the SET gains a sticky CASE.
-- ============================================================================

alter table public.session_slots add column confirmed_at timestamptz;
-- Nullable, default null (pending). No column-grant to authenticated: the admin sets
-- it only through confirm_session (or the fill) — never a direct UPDATE. So a
-- capacity edit (updateSlotDetails, which grants coach_id/capacity/starts_at/ends_at/
-- status only) can NEVER confirm a session implicitly. Confirmation is a decision.

-- ── book_slot: stamp confirmed_at when THIS booking fills the slot ──────────────
-- Re-based on the CURRENT (S7b) book_slot — whose guarded UPDATE gates on
-- status + start so a concurrent cancel_session that commits first matches zero rows
-- (no orphan booking on a cancelled slot; caught by the concurrency proof). The only
-- change is the SET: confirmed_at is stamped iff this booking fills the slot. The
-- CASE reads the PRE-increment booked_count, so `booked_count + 1 >= capacity` is
-- exactly "this booking fills it"; `confirmed_at is null` keeps it sticky. WHERE is
-- untouched → the oversell guarantee holds.
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
    -- Guarded increment gates on status + start (S7b) so a concurrent cancel_session
    -- that commits first makes this match zero rows. The SET adds the sticky
    -- fill-confirmation. WHERE unchanged from S7b = oversell + no-orphan guarantees hold.
    update public.session_slots
      set booked_count = booked_count + 1,
          confirmed_at = case when booked_count + 1 >= capacity and confirmed_at is null
                              then now() else confirmed_at end
      where id = p_slot_id and booked_count < capacity
        and status = 'published' and starts_at > now();
    if not found then
      -- Distinguish the reason without changing the union (re-read under the snapshot).
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

-- ── admin_book_player: same one-line change to its guarded increment ────────────
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
      set booked_count = booked_count + 1,
          confirmed_at = case when booked_count + 1 >= capacity and confirmed_at is null
                              then now() else confirmed_at end
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

-- ── confirm_session(slot_id) — ADMIN. Manual "it's on" for a session that hasn't
-- filled. Idempotent (confirming twice is a no-op success), rejects a cancelled slot,
-- and rejects a PAST slot: confirming is forward-looking (attendance is the past-tense
-- action; mark_attendance is past-only, this is future-only — the clean mirror).
-- Touches only confirmed_at — never booked_count, never credits.
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

  -- Lock the slot so a manual confirm and a fill-confirm racing the same slot
  -- serialise (both end confirmed; no lost update). We never lock anything else,
  -- so there's no cycle with the slot-first booking/cancel paths.
  select * into v_slot from public.session_slots where id = p_slot_id for update;
  if not found then                       return jsonb_build_object('ok', false, 'reason', 'slot_missing');    end if;
  if v_slot.status = 'cancelled' then     return jsonb_build_object('ok', false, 'reason', 'slot_cancelled'); end if;
  if v_slot.starts_at <= now() then       return jsonb_build_object('ok', false, 'reason', 'slot_in_past');   end if;

  -- Idempotent: already confirmed → no-op success (never re-stamp, keep the audit time).
  if v_slot.confirmed_at is not null then
    return jsonb_build_object('ok', true, 'already_confirmed', true);
  end if;

  update public.session_slots set confirmed_at = now() where id = p_slot_id;
  return jsonb_build_object('ok', true, 'already_confirmed', false);
end;
$$;

revoke all on function public.confirm_session(text) from public;
grant execute on function public.confirm_session(text) to authenticated;
