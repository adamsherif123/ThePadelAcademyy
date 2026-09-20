-- ============================================================================
-- Coach mode, phase 2 — the data a coach app reads, and the guard that makes a
-- coach account coach-only.
--
-- Phase 1 (049) linked a login to a coaches record. This adds:
--   1. coach_hours_coached — widened so a coach reads their OWN row.
--   2. coach_session_roster — who is booked on one of the caller's own sessions.
--   3. a refusal on the two self-service money paths, plus the one that is not an
--      RPC at all: the direct Paymob purchase INSERT.
--
-- ── the schedule needs nothing ──
-- A coach reading their own sessions is already allowed: session_slots carries
-- `session_slots_select_published_public` (status = 'published', to anon and
-- authenticated), so `select … from session_slots where coach_id = <theirs>` works
-- today with no new policy. Phase 3 simply queries it. Deliberately unchanged.
--
-- ── why the roster is an RPC and not a policy ──
-- RLS is row-level. A `players` SELECT policy scoped to "booked on my session"
-- would hand the coach the WHOLE row — email, phone, auth_user_id, gender. The
-- roster needs a name and a level. An RPC with an explicit column list is the only
-- shape that can express that, so the privilege granted is exactly two columns.
-- ============================================================================

-- ── 1. hours: self-read for a coach, unchanged for an admin ──────────────────
create or replace function public.coach_hours_coached(p_month date default null)
  returns table (coach_id text, hours numeric)
  language sql
  security definer
  set search_path = ''
  stable
as $$
  with local_start as (
    -- Cairo wall-clock midnight on the 1st of the requested month (default: the
    -- month Cairo is in right now). Still a naive timestamp at this point.
    select date_trunc('month',
             coalesce(p_month::timestamp, now() at time zone 'Africa/Cairo')
           ) as m
  ),
  win as (
    select (m at time zone 'Africa/Cairo')                        as month_start,
           ((m + interval '1 month') at time zone 'Africa/Cairo') as next_month_start
    from local_start
  )
  select s.coach_id,
         sum(extract(epoch from (s.ends_at - s.starts_at)) / 3600.0)::numeric as hours
  -- win is exactly one row, so this cross join cannot multiply a slot's
  -- contribution — the once-per-slot guarantee below is untouched by it.
  from public.session_slots s
  cross join win w
  -- WIDENED (050): an admin still sees every coach (short-circuit, byte-identical
  -- behaviour); a linked coach additionally sees EXACTLY their own row. For a player
  -- with no link current_coach_id() is null, so `s.coach_id = null` is NULL, not
  -- true — a non-coach gets nothing, which is what the admin-only gate gave them.
  where ((select public.is_admin()) or s.coach_id = (select public.current_coach_id()))
    and s.status = 'published'
    and s.ends_at >= w.month_start
    and s.ends_at <  w.next_month_start
    and s.ends_at <= now()
    -- EXISTS, never a JOIN: a semi-join selects a qualifying slot ONCE however
    -- many attended bookings sit on it (042's correctness crux, preserved).
    and exists (
      select 1 from public.bookings b
      where b.slot_id = s.id and b.status = 'attended'
    )
  group by s.coach_id
$$;
revoke all on function public.coach_hours_coached(date) from public;
grant execute on function public.coach_hours_coached(date) to authenticated;

-- ── 2. the roster ────────────────────────────────────────────────────────────
-- Name and level ONLY. A coach needs to know who is on court and roughly where
-- they are; they have no business with a player's email, phone or account.
--
-- Scoped to the caller's own session by `s.coach_id = current_coach_id()`. For a
-- player with no link that reads `= null`, which is NULL rather than true, so a
-- non-coach gets an empty set. Another coach's slot likewise returns EMPTY rather
-- than raising — a roster nobody is entitled to and a session that does not exist
-- are the same answer from outside, which is one less thing to probe with.
--
-- Cancelled bookings are excluded: a seat that was given up is not someone the
-- coach should expect on court.
--
-- The admin does NOT use this. The admin's SlotModal already reads bookings and
-- players directly under its own is_admin() policies, and it needs far more than
-- two columns, so widening this for admins would buy nothing.
create or replace function public.coach_session_roster(p_slot_id text)
  returns table (name text, level text)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select p.name, p.level
  from public.bookings b
  join public.session_slots s on s.id = b.slot_id
  join public.players p on p.id = b.player_id
  where s.id = p_slot_id
    and s.coach_id = (select public.current_coach_id())
    and b.status <> 'cancelled'
  order by p.name
$$;

revoke all on function public.coach_session_roster(text) from public, anon;
grant execute on function public.coach_session_roster(text) to authenticated;

-- ── 3a. book_slot — the 048 body with ONE early refusal ──────────────────────
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
  v_who           text;   -- ADDITIVE (owner ping)
  v_coach         text;   -- ADDITIVE (owner ping)
begin
  v_player := public.current_player_id();
  if v_player is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  -- ADDITIVE (050): a coach account is a COACH, not a player who also books. The
  -- refusal sits here, immediately after identity and before the slot is even read,
  -- so a coach-caller never reaches the guarded UPDATE, never touches a credit
  -- batch, and never emits a notification. Nothing below this line changed.
  if (select public.current_coach_id()) is not null then
    return jsonb_build_object('ok', false, 'reason', 'coach_cannot_book');
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

  -- ── ADDITIVE: remind the owners to go look at the admin ──────────────────
  -- Emitted only here, on the success return, AFTER the guarded UPDATE has taken
  -- the seat, the credit is decremented and the booking row exists. Every
  -- rejection above returns earlier and notifies nobody. Nothing in the guarded
  -- block, the lock order, or any {ok,reason} is touched.
  -- v_slot is the row read BEFORE the update; starts_at and coach_id are not
  -- among the columns that update can change, so both are still correct here.
  select name into v_who from public.players where id = v_player;
  select name into v_coach from public.coaches where id = v_slot.coach_id;
  perform tpa.notify_owners(
    'owner_booking',
    'New booking',
    coalesce(v_who, 'A player') || ' booked ' || tpa.cairo_time_short(v_slot.starts_at)
      || ' slot with ' || coalesce(split_part(v_coach, ' ', 1), 'a coach'),
    v_player,
    p_slot_id);

  -- ── ADDITIVE (048): the booker's own confirmation ────────────────────────
  -- Same placement and the same preconditions as the owner ping directly above:
  -- the seat is taken, the credit is spent and the booking row exists, so a
  -- rejected booking can never reach this line. It goes to the BOOKER alone —
  -- `session_confirmed` above goes to the OTHER players when the slot fills
  -- (`player_id <> v_player`), so the two never double up on one person.
  -- v_coach is already resolved by the owner ping; v_effective_type is the type
  -- the booking actually took (the open-slot case resolves it from p_training_type).
  perform tpa.notify(
    v_player,
    'booking_confirmation',
    'You''re booked!',
    'Your ' || initcap(v_effective_type) || ' session on ' || tpa.cairo_when(v_slot.starts_at)
      || ' with ' || coalesce(split_part(v_coach, ' ', 1), 'your coach') || ' is booked.',
    p_slot_id,
    v_booking_id);

  return jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'credit_batch_id', v_batch_id);
end;
$$;
revoke all on function public.book_slot(text, text) from public;
grant execute on function public.book_slot(text, text) to authenticated;

-- ── 3b. request_credits — the 044 body with the same early refusal ───────────
create or replace function public.request_credits(p_package_id text, p_payment_method text, p_proof_path text default null)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_player     text := public.current_player_id();
  v_pkg        public.packages;
  v_id         text := 'cr_' || gen_random_uuid();
  v_is_trial   boolean;
  v_constraint text;
  v_who        text;   -- ADDITIVE (owner ping)
begin
  if v_player is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  -- ADDITIVE (050): a coach account never acquires credits for itself.
  if (select public.current_coach_id()) is not null then
    return jsonb_build_object('ok', false, 'reason', 'coach_cannot_buy');
  end if;
  if p_payment_method not in ('instapay', 'cash') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payment_method');
  end if;
  if exists (select 1 from public.credit_requests where player_id = v_player and status = 'pending') then
    return jsonb_build_object('ok', false, 'reason', 'already_pending');
  end if;
  select * into v_pkg from public.packages where id = p_package_id;
  if not found then           return jsonb_build_object('ok', false, 'reason', 'package_missing');  end if;
  if not v_pkg.is_active then  return jsonb_build_object('ok', false, 'reason', 'package_inactive'); end if;

  v_is_trial := (v_pkg.training_type = 'trial');
  -- A trial is once-per-player, ever (A5). Reject a second cleanly, never as a crash.
  if v_is_trial and tpa.trial_used(v_player) then
    return jsonb_build_object('ok', false, 'reason', 'trial_already_used');
  end if;

  if p_proof_path is not null and split_part(p_proof_path, '/', 1) <> v_player then
    return jsonb_build_object('ok', false, 'reason', 'invalid_proof_path');
  end if;

  begin
    insert into public.credit_requests (id, player_id, package_id, payment_method, proof_path, status, created_at, is_trial)
      values (v_id, v_player, p_package_id, p_payment_method, p_proof_path, 'pending', now(), v_is_trial);
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'credit_requests_one_trial_per_player' then
        return jsonb_build_object('ok', false, 'reason', 'trial_already_used');
      end if;
      return jsonb_build_object('ok', false, 'reason', 'already_pending');
    when foreign_key_violation then
      -- The package was deleted (delete_package's hard-delete) between our read
      -- above and this insert — same clean reason as "no such package".
      return jsonb_build_object('ok', false, 'reason', 'package_missing');
  end;
  -- ── ADDITIVE: remind the owners to go look at the admin ──────────────────
  -- Emitted only here, on the success return, AFTER the request row is committed.
  -- Every early return above is a rejection and reaches none of this.
  select name into v_who from public.players where id = v_player;
  perform tpa.notify_owners(
    'owner_credit_request',
    'New credit request',
    coalesce(v_who, 'A player') || ' requested ' || v_pkg.session_count || ' '
      || initcap(v_pkg.training_type) || ' Credits',
    v_player,
    null);

  return jsonb_build_object('ok', true, 'request_id', v_id);
end;
$$;
revoke all on function public.request_credits(text, text, text) from public;
grant execute on function public.request_credits(text, text, text) to authenticated;

-- ── 3c. the Paymob checkout — the credit path that is NOT an RPC ─────────────
-- Guarding only the two RPCs would have left this open: the client INSERTs its own
-- pending purchase directly (apps/mobile/src/lib/api.ts), the gateway settles it,
-- and settle_purchase mints the credits. A coach could have bought credits without
-- ever calling a guarded function.
--
-- The policy is reproduced verbatim from 047 — every pin, including the
-- LOAD-BEARING amount subselect — with ONE conjunct added.
drop policy purchases_insert_own_pending on public.purchases;
create policy purchases_insert_own_pending on public.purchases
  for insert to authenticated
  with check (
    player_id = (select public.current_player_id())
    and status = 'pending'
    -- A player opens only their own Paymob checkout — never a cash sale.
    and payment_method = 'paymob'
    and gateway_order_id is null
    and gateway_transaction_id is null
    -- ADDITIVE (047): a player can never open a checkout pre-marked PAID. Not
    -- exploitable without this (only a real gateway settlement moves a row to
    -- succeeded, and settle_purchase sets paid itself), but the money surface gets
    -- explicit pins by convention — see the amount pin below.
    and paid = false
    -- ADDITIVE (050): a coach account cannot open a checkout for itself. An ADMIN
    -- recording a cash sale is untouched — record_cash_purchase is a SECURITY
    -- DEFINER RPC gated on is_admin() and does not pass through this policy.
    and (select public.current_coach_id()) is null
    -- LOAD-BEARING — DO NOT "simplify" the amount subselect. It is RLS-filtered:
    -- an INACTIVE package is invisible to the player, so the subselect yields
    -- NULL → amount = NULL → NULL → WITH CHECK fails. This is the only thing
    -- stopping a player from purchasing a hidden/inactive package (rls_test 23).
    and amount = (select price from public.packages where id = package_id)
  );
