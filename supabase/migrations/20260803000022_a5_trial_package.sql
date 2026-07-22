-- ============================================================================
-- A5 — Trial becomes a one-time PURCHASABLE package; no free credits at signup.
--
-- Business rule change: the academy no longer gives 2 free trial credits at signup. A new
-- player may BUY one discounted trial session (1 credit) — once, ever. Signup now asks
-- whether they've trained at TPA before (self-reported, trusted) to shape onboarding.
--
-- This migration: (1) removes the signup grant from complete_signup — keeping the
-- 'signup_grant' source/CHECK/index intact so HISTORICAL batches still validate and render;
-- (2) captures players.trained_before; (3) hard-locks trial to once-per-player with two
-- partial unique indexes + a helper; (4) makes trial sellable through the money RPCs with a
-- clean trial_already_used reason; (5) exposes trial_eligible() for the store.
-- ============================================================================

-- ── players.trained_before (Task 4): self-reported new-vs-returning ─────────
-- Nullable: unknown for players created before A5; set by complete_signup going forward.
alter table public.players add column trained_before boolean;

-- ── credit_requests.is_trial (Task 2): denormalised so a partial index can lock trial ──
-- training_type lives on packages, not the request, and a partial index is table-local — so
-- request_credits stamps this from the package at insert. Existing rows are non-trial
-- (trial was unsellable pre-A5), so the default is correct for history.
alter table public.credit_requests add column is_trial boolean not null default false;

-- ── the once-per-player trial locks (two facts live in two tables) ──────────
-- (A) At most one LIVE trial REQUEST (pending or approved) per player — the "can't queue two
-- trial requests" lock. 'rejected' is excluded so a declined attempt can be retried.
create unique index credit_requests_one_trial_per_player
  on public.credit_requests (player_id)
  where is_trial and status <> 'rejected';

-- (B) At most one TRIAL PURCHASE batch per player, EVER — the hard money lock. Native
-- columns; every mint path (approve_credit_request, record_cash_purchase, a future paymob
-- settle) produces exactly one such batch, so this covers a succeeded trial purchase however
-- it arose. The direct analog of the signup-grant index this migration stops feeding.
create unique index credit_batches_one_trial_purchase_per_player
  on public.credit_batches (player_id)
  where training_type = 'trial' and source = 'purchase';

-- ── trial_used / trial_eligible ────────────────────────────────────────────
-- The single "has this player used their trial?" truth: a purchased trial batch, OR a live
-- (pending/approved) trial request. Called only from SECURITY DEFINER RPCs (runs as owner,
-- past RLS); not exposed to clients.
create or replace function tpa.trial_used(p_player_id text)
  returns boolean
  language sql
  stable
  set search_path = ''
as $$
  select exists (
           select 1 from public.credit_batches
            where player_id = p_player_id and training_type = 'trial' and source = 'purchase'
         )
      or exists (
           select 1 from public.credit_requests
            where player_id = p_player_id and is_trial and status in ('pending', 'approved')
         )
$$;
revoke all on function tpa.trial_used(text) from public, anon, authenticated;

-- The store asks this: can the CURRENT player still get a trial? One bit, server-computed.
create or replace function public.trial_eligible()
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select public.current_player_id() is not null
     and not tpa.trial_used(public.current_player_id())
$$;
revoke all on function public.trial_eligible() from public, anon;
grant execute on function public.trial_eligible() to authenticated;

-- ── complete_signup: NO credits at signup; captures trained_before (Tasks 1, 4) ──
-- Byte-identical to the A2.1 version EXCEPT: the signup_grant credit_batches insert is gone
-- (no credits, full stop), and a trusted p_trained_before is stored. 'signup_grant' stays a
-- valid source for the historical batches already on cloud dev.
drop function public.complete_signup(text, text, text, text);
create function public.complete_signup(
  p_name text, p_gender text, p_level text, p_phone text default null, p_trained_before boolean default null
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_player_id  text;
  v_email      text;
  v_phone      text;
  v_constraint text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;
  if public.is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'is_admin');
  end if;
  select id into v_player_id from public.players where auth_user_id = v_uid;
  if found then
    return jsonb_build_object('ok', true, 'already_completed', true, 'player_id', v_player_id);
  end if;
  if p_name is null or btrim(p_name) = '' then
    return jsonb_build_object('ok', false, 'reason', 'name_required');
  end if;
  if p_gender not in ('men', 'ladies') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_gender');
  end if;
  if p_level not in ('beginner', 'adv_beginner', 'intermediate') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_level');
  end if;

  select email into v_email from auth.users where id = v_uid;

  if p_phone is not null and btrim(p_phone) <> '' then
    v_phone := regexp_replace(p_phone, '[^0-9]', '', 'g');
    v_phone := regexp_replace(v_phone, '^0+', '');
    if left(v_phone, 2) <> '20' then
      v_phone := '20' || v_phone;
    end if;
    v_phone := '+' || v_phone;
    if v_phone !~ '^\+201[0-9]{9}$' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_phone');
    end if;
  end if;

  v_player_id := 'pl_' || gen_random_uuid();

  begin
    -- A5: NO credits are minted at signup. A new player starts with zero and buys a trial.
    insert into public.players (id, email, phone, name, gender, level, created_at, auth_user_id, trained_before)
      values (v_player_id, v_email, v_phone, btrim(p_name), p_gender, p_level, now(), v_uid, p_trained_before);
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'players_phone_key' then
        return jsonb_build_object('ok', false, 'reason', 'phone_taken');
      end if;
      select id into v_player_id from public.players where auth_user_id = v_uid;
      return jsonb_build_object('ok', true, 'already_completed', true, 'player_id', v_player_id);
  end;

  return jsonb_build_object('ok', true, 'already_completed', false, 'player_id', v_player_id);
end;
$$;
revoke all on function public.complete_signup(text, text, text, text, boolean) from public;
grant execute on function public.complete_signup(text, text, text, text, boolean) to authenticated;

-- ── request_credits: trial is sellable now, but once-per-player (Task 2) ────
-- Replaces the A3 'trial_not_sellable' block with the once-ever lock: a trial request when
-- the player has already used theirs → clean trial_already_used (index A backstops races).
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
begin
  if v_player is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
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
  end;
  return jsonb_build_object('ok', true, 'request_id', v_id);
end;
$$;

-- ── approve_credit_request: re-check trial at approval time (Task 2) ────────
-- A seam never trusts its caller: re-check the once-ever trial rule (a race, or an admin
-- cash-recording a trial for a player who already has a pending trial request). The mint's
-- index B is the ultimate backstop → mapped to a clean trial_already_used.
create or replace function public.approve_credit_request(p_request_id text, p_granted_quantity int default null, p_amount int default null)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_admin       text;
  v_req         public.credit_requests;
  v_pkg         public.packages;
  v_qty         int;
  v_amount      int;
  v_purchase_id text := 'pu_' || gen_random_uuid();
  v_batch_id    text;
  v_constraint  text;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;
  v_admin := (select id from public.admins where auth_user_id = (select auth.uid()));

  select * into v_req from public.credit_requests where id = p_request_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'request_missing'); end if;

  if v_req.status <> 'pending' then
    if v_req.status = 'approved' then
      return jsonb_build_object('ok', true, 'already_resolved', true, 'purchase_id', v_req.purchase_id);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'not_pending');
  end if;

  select * into v_pkg from public.packages where id = v_req.package_id;

  -- Once-per-player trial re-check (A5): if this player already has a trial purchase, refuse.
  if v_pkg.training_type = 'trial'
     and exists (select 1 from public.credit_batches
                  where player_id = v_req.player_id and training_type = 'trial' and source = 'purchase') then
    return jsonb_build_object('ok', false, 'reason', 'trial_already_used');
  end if;

  v_qty    := coalesce(p_granted_quantity, v_pkg.session_count);
  v_amount := coalesce(p_amount, v_pkg.price);
  if v_qty < 1 or v_qty > 1000 then return jsonb_build_object('ok', false, 'reason', 'invalid_quantity'); end if;
  if v_amount < 1 then              return jsonb_build_object('ok', false, 'reason', 'invalid_amount');   end if;

  begin
    insert into public.purchases
      (id, player_id, package_id, status, amount, created_at, payment_method, gateway_order_id, gateway_transaction_id)
    values
      (v_purchase_id, v_req.player_id, v_req.package_id, 'succeeded', v_amount, now(), v_req.payment_method, null, null);
    v_batch_id := tpa.mint_credits_for_purchase(v_purchase_id, v_qty);
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      -- The trial-purchase index fired under a race → a clean business reason, not a 500.
      if v_constraint = 'credit_batches_one_trial_purchase_per_player' then
        return jsonb_build_object('ok', false, 'reason', 'trial_already_used');
      end if;
      raise;
  end;

  update public.credit_requests
     set status = 'approved', resolved_at = now(), resolved_by = v_admin, purchase_id = v_purchase_id
   where id = p_request_id;

  perform tpa.notify(
    v_req.player_id, 'credits_granted', 'Credits added',
    'You received ' || v_qty || ' ' || initcap(v_pkg.training_type) || ' credit'
      || case when v_qty = 1 then '' else 's' end || '.',
    null, null);

  return jsonb_build_object('ok', true, 'purchase_id', v_purchase_id, 'credit_batch_id', v_batch_id);
end;
$$;

-- ── record_cash_purchase: trial is sellable, once-per-player (Task 2) ───────
-- Replaces the 'trial_not_sellable' block with the once-ever check; index B backstops races.
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
  v_constraint  text;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;
  if not exists (select 1 from public.players where id = p_player_id) then
    return jsonb_build_object('ok', false, 'reason', 'player_missing');
  end if;
  select * into v_pkg from public.packages where id = p_package_id;
  if not found then           return jsonb_build_object('ok', false, 'reason', 'package_missing');  end if;
  if not v_pkg.is_active then  return jsonb_build_object('ok', false, 'reason', 'package_inactive'); end if;
  if p_amount < 1 then         return jsonb_build_object('ok', false, 'reason', 'amount_below_one'); end if;

  -- Once-per-player trial (A5): reject a second trial (a purchased batch or a live request).
  if v_pkg.training_type = 'trial' and tpa.trial_used(p_player_id) then
    return jsonb_build_object('ok', false, 'reason', 'trial_already_used');
  end if;

  begin
    insert into public.purchases
      (id, player_id, package_id, status, amount, created_at, payment_method, gateway_order_id, gateway_transaction_id)
    values
      (v_purchase_id, p_player_id, p_package_id, 'succeeded', p_amount, now(), 'cash', null, null);
    v_batch_id := tpa.mint_credits_for_purchase(v_purchase_id);
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'credit_batches_one_trial_purchase_per_player' then
        return jsonb_build_object('ok', false, 'reason', 'trial_already_used');
      end if;
      raise;
  end;

  return jsonb_build_object('ok', true, 'purchase_id', v_purchase_id, 'credit_batch_id', v_batch_id);
end;
$$;
