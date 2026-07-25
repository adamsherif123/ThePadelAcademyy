-- ============================================================================
-- One blocking residual from re-review, plus two non-blocking cleanups.
-- Additive on top of 20260805000024. Fixes 1, 2, 4 and the Fix-3 structural
-- refactor (the shared tpa.free_slot_seat helper) were confirmed correct by
-- re-review and execution — unchanged here.
--
-- THE RESIDUAL — delete_account's loop can free a seat for a booking a
-- concurrent cancel_booking already cancelled. The loop's cursor query is
-- `FOR UPDATE OF s` — only session_slots is locked, bookings is not. When the
-- cursor blocks on the slot's row lock (because a concurrent cancel_booking
-- holds it) and then unblocks, EvalPlanQual re-fetches ONLY the locked table
-- (session_slots) to its latest committed version; the JOIN's
-- `b.status = 'booked'` condition is still evaluated against the ORIGINAL
-- snapshot of bookings taken when the query started — which still shows
-- 'booked', even though the concurrent transaction already committed
-- 'cancelled'. The row is delivered to the loop body regardless, and the OLD
-- code called tpa.free_slot_seat(v_slot) unconditionally — freeing a seat and
-- (if the slot was booking-set and this looked like the last booking)
-- reverting a slot that still has another player's LIVE booking on it.
-- Reviewer-verified end state: training_type NULL, booked_count 0, 1 live
-- booking still present.
--
-- FIX — make the booking-cancel the arbiter, exactly as it already is inside
-- cancel_booking itself: the guarded UPDATE `... WHERE status = 'booked'`
-- always does a FRESH, statement-time read (never the stale cursor snapshot),
-- so if a concurrent cancel_booking already flipped this exact booking to
-- 'cancelled', this UPDATE matches zero rows. Checked via FOUND (PL/pgSQL's
-- standard idiom, used identically elsewhere in this file, e.g. book_slot's
-- credit-decrement guard). Only when the cancel genuinely landed here do we
-- free the seat, under the SAME already-held slot lock — no new lock, no new
-- acquisition order, and the "slot before booking" order is preserved (the
-- loop's cursor already holds the slot lock before this UPDATE runs).
--
-- TASK 2 — tpa.free_slot_seat itself is left THIN, no new internal guard,
-- beyond the greatest(0, ...) floor it already has. Justification:
--   * The bug was never in the seat-freeing arithmetic (shared, correct,
--     unchanged) — it was in WHEN a caller decided to invoke it. An internal
--     guard can't reconstruct "did MY specific booking-cancel actually land"
--     from v_slot alone; that fact is caller-local and the caller already has
--     it for free via FOUND, right where the guarded UPDATE runs.
--   * A defensive internal check would mean either a redundant COUNT query
--     against bookings on every call (book_slot's cancel path is hot) or
--     trusting a flag the caller passes anyway — no real safety added, just
--     cost and a second place for the same invariant to drift out of sync.
--   * greatest(0, ...) exists to stop a legitimate last decrement going
--     negative, not to silently absorb "this call didn't correspond to a
--     real freed seat" — making the helper MORE defensive would have made
--     THIS bug harder to notice (booked_count would still look plausible
--     while training_type/gender/level corrupted quietly). We want loud,
--     provable-in-tests correctness at the call site instead: fix the
--     caller, add the race to concurrency.sh (Scenario L) so any future
--     regression of this kind is DETECTED, not absorbed.
--   * tpa is not client-exposed surface (S7a) — the "validate defensively at
--     a trust boundary" argument that applies to RLS/RPC inputs doesn't apply
--     to an internal helper only three already-reviewed callers can reach.
--
-- NON-BLOCKING — admin_book_player's `overridden` field was computed from the
-- UNLOCKED PEEK-time gender (v_slot.gender, read before the guarded UPDATE),
-- which can be stale under contention: an untyped slot's gender is still null
-- at peek time regardless of what a racing booking commits before this one's
-- guarded UPDATE runs. Fixed by capturing the COMMITTED gender in the SAME
-- RETURNING clause as booked_count/capacity, and computing v_mismatch from
-- THAT (the row as it actually exists at the moment this booking lands), not
-- the pre-lock snapshot. Existing behaviour for the already-tested
-- non-racing cases (open_type_slots_test.sql's M/N scenario) is unchanged —
-- this only corrects the race window.
--
-- NON-BLOCKING — tpa.free_slot_seat gains an explicit revoke from public, for
-- defense-in-depth consistency (the schema-level lockout is already the real
-- control; this is a zero-cost belt-and-braces addition scoped to the one
-- function actually named in review, not retrofitted onto refund_booking/
-- mint_credits_for_purchase, which are out of this fix's scope).
--
-- FILED, NOT FIXED — reschedule_session does not validate p_capacity against
-- the slot's training_type (an admin could reschedule an 'individual'-typed
-- slot's capacity to 5, breaking the "individual = capacity 1" invariant
-- rule 5 relies on). Pre-existing, separate from this session's scope —
-- noted here so it is not lost, not addressed in this migration.
-- ============================================================================

revoke all on function tpa.free_slot_seat(public.session_slots) from public;

create or replace function public.delete_account()
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_player text;
  v_slot   public.session_slots;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  -- Resolve + lock the caller's OWN player row. No argument path exists, so a caller
  -- can only ever reach their own row. The lock serialises a double-submit.
  select id into v_player from public.players where auth_user_id = v_uid for update;
  if not found then
    return jsonb_build_object('ok', true, 'already_deleted', true);
  end if;

  -- Free the seat of every FUTURE booked session, one slot at a time (uniform
  -- lock order: session_slots — locked here via FOR UPDATE OF — then
  -- bookings, same as book_slot/cancel_session/cancel_booking).
  for v_slot in
    select s.* from public.session_slots s
    join public.bookings b on b.slot_id = s.id
    where b.player_id = v_player and b.status = 'booked' and s.starts_at > now()
    order by s.id
    for update of s
  loop
    -- The booking-cancel is the arbiter (mirrors cancel_booking's own
    -- guarded logic): this UPDATE always reads live, so a booking a
    -- concurrent cancel_booking already cancelled matches zero rows here —
    -- FOUND is false, and we skip the seat-free entirely. There is nothing
    -- left to do for a booking someone else already resolved; freeing the
    -- seat again would double-decrement (or wrongly revert a slot that
    -- still has another player's live booking on it).
    update public.bookings
       set status = 'cancelled', cancelled_at = now()
     where player_id = v_player and status = 'booked' and slot_id = v_slot.id;
    if found then
      perform tpa.free_slot_seat(v_slot);
    end if;
  end loop;

  -- Anonymise the tombstone. Credits are LEFT as-is (abandoned, not refunded — a
  -- refund to a wallet nobody can reach is meaningless). Purchases untouched.
  update public.players
     set name         = 'Deleted player',
         phone        = 'deleted:' || id,   -- unique (id is the PK), no PII
         deleted_at   = now(),
         auth_user_id = null                -- satisfies RESTRICT; auth row can now go
   where id = v_player;

  return jsonb_build_object('ok', true, 'already_deleted', false, 'player_id', v_player);
end;
$$;

-- admin_book_player: 'overridden' now reflects the COMMITTED gender (captured
-- in the same RETURNING as booked_count/capacity), not the unlocked peek.
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
          capacity = case when training_type is null and v_effective_type = 'individual'
                          then 1 else capacity end,
          pre_booking_capacity = case when training_type is null and v_effective_type = 'individual'
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
