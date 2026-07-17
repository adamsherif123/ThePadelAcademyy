-- ============================================================================
-- S7b — the admin + money RPCs. After this, no money moves without the database
-- enforcing it. Every mutation on bookings / credit_batches / purchases that isn't
-- book_slot or cancel_booking lives here as a SECURITY DEFINER RPC.
--
-- Authorisation model (see the session report's matrix):
--   * player self-service (book_slot, cancel_booking) → current_player_id().
--   * admin actions (cancel_session, remove_booking, admin_book_player,
--     grant_credits, record_cash_purchase) → is_admin() checked IN THE BODY,
--     returning {ok:false, reason:'not_admin'} as data. EXECUTE is granted to
--     `authenticated`; the row-level authority is the is_admin() gate, so a
--     non-admin holds the privilege but every call short-circuits.
--   * settle_purchase → service_role ONLY (EXECUTE revoked from everyone else). If
--     a player could run it they'd settle their own pending purchase and mint free
--     credits — the entire gateway bypassed.
--
-- Lock order is UNIFORM across every RPC — session_slots → bookings →
-- credit_batches — so no two of them can deadlock (they always grab shared rows in
-- the same sequence).
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- TASK 1 — shared primitives. Five RPCs refund a booking or mint from a purchase;
-- the RULE lives once, here, so the 3-hour window and the 30-day expiry can never
-- come to mean two different things in two copies.
-- ─────────────────────────────────────────────────────────────────────────────

-- THE refund rule: +1 back to the booking's ORIGINAL batch, keeping its ORIGINAL
-- expiry (we touch only quantity_remaining, never mint or extend). An already-
-- expired batch still increments — the ledger tells the truth; expires_at rejects
-- it downstream. Callers: cancel_booking, cancel_session, remove_booking.
create or replace function tpa.refund_booking(p_booking_id text)
  returns void
  language sql
  set search_path = ''
as $$
  update public.credit_batches c
     set quantity_remaining = c.quantity_remaining + 1
    from public.bookings b
   where b.id = p_booking_id
     and c.id = b.credit_batch_id;
$$;

-- THE purchase-mint rule: one purchase-backed batch for a succeeded purchase, typed
-- and sized from its package, expiring now() + tpa.credit_expiry() (a purchase buys
-- no extra time either). Callers: settle_purchase, record_cash_purchase. Returns
-- the new batch id.
create or replace function tpa.mint_credits_for_purchase(p_purchase_id text)
  returns text
  language plpgsql
  set search_path = ''
as $$
declare
  v_batch_id text := 'cb_' || gen_random_uuid();
  v_pu       public.purchases;
  v_pkg      public.packages;
begin
  select * into v_pu  from public.purchases where id = p_purchase_id;
  select * into v_pkg from public.packages  where id = v_pu.package_id;
  insert into public.credit_batches
    (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at, note)
  values
    (v_batch_id, v_pu.player_id, 'purchase', p_purchase_id, v_pkg.training_type,
     v_pkg.session_count, v_pkg.session_count, now() + tpa.credit_expiry(), now(), null);
  return v_batch_id;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TASK 0 — the status race in book_slot (fixing my own S7a §7 finding, which was
-- WRONG that it self-heals). Ordering that bites: cancel_session commits first
-- (refunds everyone it can see), then this player's guarded increment re-evaluates
-- under EvalPlanQual — and because status was NOT in the WHERE it still matched,
-- incrementing and inserting a booking AFTER the refund pass. Orphaned booking:
-- credit spent, session cancelled, nobody refunds it.
--
-- Fix: put status='published' AND starts_at>now() IN the guarded WHERE, so a slot
-- cancelled (or started) between the pre-check and the increment yields zero rows.
-- A follow-up SELECT then names the reason, keeping the result union identical.
-- Proven by supabase/tests/concurrency.sh (book_slot vs cancel_session race).
-- ─────────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────────
-- cancel_booking — refactored to use the shared refund primitive, and to lock in
-- the uniform order (slot → booking → batch) so it can't deadlock cancel_session.
-- Behaviour is unchanged from S7a.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.cancel_booking(p_booking_id text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_player  text;
  v_slot_id text;
  v_booking public.bookings;
  v_slot    public.session_slots;
  v_refund  boolean;
begin
  v_player := public.current_player_id();
  if v_player is null then return jsonb_build_object('ok', false, 'reason', 'not_authenticated'); end if;

  -- Unlocked peek to learn the slot, so we can take the SLOT lock first (uniform
  -- order); the authoritative booking read + validation happens under lock below.
  select slot_id into v_slot_id from public.bookings where id = p_booking_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'booking_missing'); end if;

  select * into v_slot from public.session_slots where id = v_slot_id for update;   -- lock slot first
  if not found then return jsonb_build_object('ok', false, 'reason', 'slot_missing'); end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;   -- then the booking
  if v_booking.player_id <> v_player then return jsonb_build_object('ok', false, 'reason', 'not_owner');         end if;
  if v_booking.status = 'cancelled'  then return jsonb_build_object('ok', false, 'reason', 'already_cancelled'); end if;
  if v_booking.status <> 'booked'    then return jsonb_build_object('ok', false, 'reason', 'not_cancellable');   end if;
  if v_slot.starts_at <= now()       then return jsonb_build_object('ok', false, 'reason', 'not_cancellable');   end if;

  v_refund := (v_slot.starts_at - now()) > tpa.cancellation_window();

  update public.session_slots set booked_count = greatest(0, booked_count - 1) where id = v_slot.id;
  update public.bookings set status = 'cancelled', cancelled_at = now() where id = v_booking.id;
  if v_refund then perform tpa.refund_booking(v_booking.id); end if;

  return jsonb_build_object('ok', true, 'refunded', v_refund,
    'credit_batch_id', case when v_refund then v_booking.credit_batch_id else null end);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TASK 2 — cancel_session(slot_id) — ADMIN. The academy (not the player) cancels a
-- session. Slot → cancelled; every ACTIVE booking → cancelled; EVERY booked player
-- refunded regardless of the 3-hour window — the forfeit rule exists because the
-- player chose to bail, and a sick coach doesn't make them blameless-but-poorer.
-- tpa.cancellation_window() is NEVER consulted here. Idempotent (already-cancelled
-- slot rejected). Returns the refunded count.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.cancel_session(p_slot_id text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_slot  public.session_slots;
  v_bk    record;
  v_count int := 0;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;

  select * into v_slot from public.session_slots where id = p_slot_id for update;
  if not found then                       return jsonb_build_object('ok', false, 'reason', 'slot_missing');      end if;
  if v_slot.status = 'cancelled' then     return jsonb_build_object('ok', false, 'reason', 'already_cancelled'); end if;

  -- Refund + cancel every active booking (unconditional refund).
  for v_bk in
    select id from public.bookings where slot_id = p_slot_id and status = 'booked' for update
  loop
    perform tpa.refund_booking(v_bk.id);
    update public.bookings set status = 'cancelled', cancelled_at = now() where id = v_bk.id;
    v_count := v_count + 1;
  end loop;

  update public.session_slots set status = 'cancelled', booked_count = 0 where id = p_slot_id;

  return jsonb_build_object('ok', true, 'refunded_count', v_count);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TASK 3 — remove_booking(booking_id, refund) — ADMIN. cancel_session scoped to one
-- booking. The refund is an EXPLICIT argument, precisely so an always-refund rule
-- can't quietly become an admin route around the 3-hour window (player rings an
-- hour before → owner removes them → refund the app would have denied). Seat freed
-- regardless; refund only when refund=true, original expiry, expired-increments-
-- anyway. Reject an already-cancelled booking.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.remove_booking(p_booking_id text, p_refund boolean)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_slot_id text;
  v_booking public.bookings;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;

  select slot_id into v_slot_id from public.bookings where id = p_booking_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'booking_missing'); end if;

  perform 1 from public.session_slots where id = v_slot_id for update;   -- slot lock first
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if v_booking.status <> 'booked' then return jsonb_build_object('ok', false, 'reason', 'already_cancelled'); end if;

  update public.session_slots set booked_count = greatest(0, booked_count - 1) where id = v_slot_id;
  update public.bookings set status = 'cancelled', cancelled_at = now() where id = p_booking_id;
  if p_refund then perform tpa.refund_booking(p_booking_id); end if;

  return jsonb_build_object('ok', true, 'refunded', p_refund);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TASK 4 — admin_book_player(slot_id, player_id, override) — ADMIN. Unlike
-- book_slot, player_id IS an argument (WhatsApp is the real booking channel).
-- Same guarded increment, same earliest-expiring batch, same credit_batch_id.
--
-- override covers gender/level mismatch ONLY. It is a SKIP of those two checks, not
-- a short-circuit: every other rule (published, not-started, capacity, credit,
-- uniqueness) runs identically, so a hard block hiding behind a mismatch still
-- wins — a full+mismatched slot with override=true returns slot_full, a
-- no-credit+mismatched one returns no_usable_credit.
-- ─────────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────────
-- TASK 5 — grant_credits(player_id, training_type, quantity, note) — ADMIN. The
-- SQL mirror of @tpa/core buildAdminGrant: source 'admin_grant', purchase_id NULL,
-- expires_at = now() + tpa.credit_expiry() (a comp buys no extra time).
--
-- The note is REQUIRED — null or empty is rejected. An unexplained free credit
-- reads as fraud in an audit; the CHECK (note IS NULL OR source='admin_grant')
-- exists to protect exactly this story, and the DB now enforces the "why" too.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.grant_credits(p_player_id text, p_training_type text, p_quantity int, p_note text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_batch_id text := 'cb_' || gen_random_uuid();
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;
  if not exists (select 1 from public.players where id = p_player_id) then
    return jsonb_build_object('ok', false, 'reason', 'player_missing');
  end if;
  if p_note is null or btrim(p_note) = '' then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;
  if p_quantity < 1 then return jsonb_build_object('ok', false, 'reason', 'quantity_below_one'); end if;

  insert into public.credit_batches
    (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at, note)
  values
    (v_batch_id, p_player_id, 'admin_grant', null, p_training_type, p_quantity, p_quantity,
     now() + tpa.credit_expiry(), now(), btrim(p_note));

  return jsonb_build_object('ok', true, 'credit_batch_id', v_batch_id);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TASK 6 — record_cash_purchase(player_id, package_id, amount) — ADMIN. Egypt runs
-- on cash. One transaction: insert a succeeded cash purchase, then mint via the
-- shared primitive. amount comes from the caller (discounts are real; purchase.
-- amount is captured so liability values them correctly), guarded >= 1.
--
-- Never looser than the player path: reject trial (structurally unsellable) and an
-- INACTIVE package. The player path can't buy an inactive package (the RLS amount
-- pin yields NULL against a hidden package); the admin path matches that — a Hidden
-- package is not for sale through any door, and the record-cash UI only offers
-- active, non-trial packages.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.record_cash_purchase(p_player_id text, p_package_id text, p_amount int)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_pkg         public.packages;
  v_purchase_id text := 'pu_' || gen_random_uuid();
  v_batch_id    text;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;
  if not exists (select 1 from public.players where id = p_player_id) then
    return jsonb_build_object('ok', false, 'reason', 'player_missing');
  end if;
  select * into v_pkg from public.packages where id = p_package_id;
  if not found then                          return jsonb_build_object('ok', false, 'reason', 'package_missing');    end if;
  if v_pkg.training_type = 'trial' then      return jsonb_build_object('ok', false, 'reason', 'trial_not_sellable'); end if;
  if not v_pkg.is_active then                return jsonb_build_object('ok', false, 'reason', 'package_inactive');   end if;
  if p_amount < 1 then                       return jsonb_build_object('ok', false, 'reason', 'amount_below_one');   end if;

  insert into public.purchases
    (id, player_id, package_id, status, amount, created_at, payment_method, gateway_order_id, gateway_transaction_id)
  values
    (v_purchase_id, p_player_id, p_package_id, 'succeeded', p_amount, now(), 'cash', null, null);

  v_batch_id := tpa.mint_credits_for_purchase(v_purchase_id);

  return jsonb_build_object('ok', true, 'purchase_id', v_purchase_id, 'credit_batch_id', v_batch_id);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TASK 7 — settle_purchase(purchase_id, gateway_transaction_id) — 🔒 service_role
-- ONLY. S6's webhook calls this after verifying the Paymob HMAC. Flip pending →
-- succeeded, record the gateway txn, mint — ATOMICALLY (a half-settled purchase is
-- money taken with no credits, the worst bug in the system).
--
-- Idempotent for webhook double-delivery: the guarded UPDATE
-- (…WHERE status='pending') mints exactly once; a redelivery matches zero rows and
-- returns success WITHOUT minting again (a 500 would make Paymob retry forever).
--
-- SECURITY: EXECUTE is revoked from public/anon/authenticated below. If a player
-- could run this they'd settle their own pending purchase — free credits, no
-- payment, the whole gateway bypassed. The role IS the authorisation here.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.settle_purchase(p_purchase_id text, p_gateway_transaction_id text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_status   text;
  v_batch_id text;
begin
  select status into v_status from public.purchases where id = p_purchase_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'purchase_missing'); end if;

  -- Guarded settle: only a PENDING purchase advances (and only once).
  update public.purchases
    set status = 'succeeded', gateway_transaction_id = p_gateway_transaction_id
    where id = p_purchase_id and status = 'pending';
  if not found then
    -- Already advanced. Redelivery of an already-succeeded webhook → success, no
    -- second mint. A 'failed' purchase can't be settled.
    if v_status = 'succeeded' then return jsonb_build_object('ok', true, 'already_settled', true); end if;
    return jsonb_build_object('ok', false, 'reason', 'not_pending');
  end if;

  v_batch_id := tpa.mint_credits_for_purchase(p_purchase_id);
  return jsonb_build_object('ok', true, 'already_settled', false, 'credit_batch_id', v_batch_id);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTS. Admin RPCs: EXECUTE to authenticated (the is_admin() body gate is the
-- real authority). settle_purchase: service_role ONLY.
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on function public.cancel_session(text)                 from public;
revoke all on function public.remove_booking(text, boolean)        from public;
revoke all on function public.admin_book_player(text, text, boolean) from public;
revoke all on function public.grant_credits(text, text, int, text) from public;
revoke all on function public.record_cash_purchase(text, text, int) from public;
grant execute on function public.cancel_session(text)                 to authenticated;
grant execute on function public.remove_booking(text, boolean)        to authenticated;
grant execute on function public.admin_book_player(text, text, boolean) to authenticated;
grant execute on function public.grant_credits(text, text, int, text) to authenticated;
grant execute on function public.record_cash_purchase(text, text, int) to authenticated;

-- 🔒 settle_purchase — no client role may execute it. Only the S6 webhook, as
-- service_role, does. anon/authenticated are denied at the privilege layer (42501).
revoke all on function public.settle_purchase(text, text) from public, anon, authenticated;
grant execute on function public.settle_purchase(text, text) to service_role;
