-- ============================================================================
-- 070 — the credit notifications name their branch too
--
-- WHY
-- 065 gave grant_credits "…for Oro Plaza Hotel." and 067 gave the transfer
-- "…moved to Sheikh Zayed." 069 did the same for every message about a SESSION.
-- This is the gap between them: the messages about CREDITS that still did not
-- say where those credits work.
--
-- Credits are spendable at exactly one branch (065). A player reading "You
-- received 4 Group credits." cannot tell whether they can use them tonight, and
-- an owner reading "Mona requested 4 Group Credits" cannot grant them without
-- first going to look up which branch — while grant_credits, the function they
-- are about to call, requires a branch as an argument.
--
-- The declined message is here for a different reason. 066 made the pending
-- limit PER BRANCH, so a player may hold one live request at each. From that
-- change onward "Your credit request was declined" stopped identifying which
-- request was refused, and the branch is the only thing that distinguishes them.
--
-- COPY ONLY — the hard constraint
-- No notification type, no enum value, no column. notifications.type is
-- untouched; all three changes are a longer string inside an existing body, so a
-- 1.2 (99541ff) or 1.3 (255b73f) client renders them exactly as it renders
-- today's — to it they are the same thing, text.
--
-- HOW EACH BODY WAS BUILT
-- Not retyped. Each was extracted from the definition LIVE ON DEV
-- (`supabase db dump --linked`) and only these hunks applied:
--
--   approve_credit_request   3 hunks   declare, one assignment, 1 message string
--   request_credits          3 hunks   declare, one assignment, 1 message string
--   reject_credit_request    3 hunks   declare, one assignment, 1 message string
--
-- Applying the INVERSE reproduces the live definition byte-for-byte — proven
-- mechanically, not asserted. No guard, lock order, {ok, reason}, return shape or
-- grant moved. The headers are restyled to this repo's lowercase form; the
-- attributes they replace are identical and the body is verbatim but for the
-- hunks.
--
-- WHY IT CANNOT PRODUCE A NULL BODY
-- notifications.body is NOT NULL and `'a' || null` is NULL, so an unresolved
-- branch would take the whole message down and with it the money path it hangs
-- off. tpa.location_name coalesces a missing row to 'the academy' (066), and each
-- function resolves it ONCE above the message that reads it.
--
-- WHERE THE BRANCH COMES FROM, AND WHY
--   approve_credit_request  v_pkg.location_id    — the package is what the minted
--                             batch's branch is forced from (tpa.
--                             force_location_from_package), so this is the branch
--                             the credits will actually work at, not a guess.
--   request_credits         v_pkg.location_id    — same package, before anything
--                             is minted.
--   reject_credit_request   v_req.location_id    — the REQUEST's own stamp (065),
--                             because the request is the row being declined and it
--                             is the row the per-branch limit counts.
--
-- AUDITED AND NOT CHANGED
--   grant_credits, transfer_credit_batch     — already name the branch (065, 067).
--   settle_purchase (refund-required) and
--   mark_purchase_refunded                   — owner alerts about MONEY OWED. No
--     credits exist to be usable anywhere (settle_purchase's whole point there is
--     that none could be issued), and the action they prompt — refund in Paymob —
--     is the same at every branch. A branch name would be noise on an alert whose
--     job is to be acted on fast.
--   record_cash_purchase, settle_purchase (success)
--                                            — emit NO notification at all. Both
--     mint credits and tell the player nothing. That is a real gap, but filling it
--     means a NEW emit, which is not copy-only and not this migration.
--   set_purchase_paid, fail_purchase, fail_stale_purchases, delete_credit_batch,
--   delete_account                           — notify nobody.
-- ============================================================================

-- approve_credit_request — MONEY PATH (mints a credit batch). The player's
-- 'Credits added'. grant_credits, the other route to this exact outcome, has named
-- the branch since 065; this one did not, so the same event read two different ways
-- depending on which button the admin pressed.
create or replace function public.approve_credit_request(p_request_id text, p_granted_quantity integer default null, p_amount integer default null)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $fn$
declare
  v_admin       text;
  v_req         public.credit_requests;
  v_pkg         public.packages;
  v_qty         int;
  v_amount      int;
  v_purchase_id text := 'pu_' || gen_random_uuid();
  v_batch_id    text;
  v_constraint  text;
  v_loc_name    text;   -- ADDITIVE (070, branch in credit copy)
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

  -- ADDITIVE (070): resolved ONCE, above the message that reads it.
  -- tpa.location_name coalesces a missing row to 'the academy' (066), so a
  -- concatenated body can never become NULL and violate notifications.body.
  v_loc_name := tpa.location_name(v_pkg.location_id);

  perform tpa.notify(
    v_req.player_id, 'credits_granted', 'Credits added',
    'You received ' || v_qty || ' ' || initcap(v_pkg.training_type) || ' credit'
      || case when v_qty = 1 then '' else 's' end
      || ' for ' || v_loc_name || '.',
    null, null);

  return jsonb_build_object('ok', true, 'purchase_id', v_purchase_id, 'credit_batch_id', v_batch_id);
end;
$fn$;


-- request_credits — MONEY PATH (writes the request the approval spends against).
-- The owners' 'New credit request'. Their next action is grant_credits, which
-- REQUIRES a branch — and the alert that sends them there did not name one.
create or replace function public.request_credits(p_package_id text, p_payment_method text, p_proof_path text default null)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $fn$
declare
  v_player     text := public.current_player_id();
  v_pkg        public.packages;
  v_id         text := 'cr_' || gen_random_uuid();
  v_is_trial   boolean;
  v_constraint text;
  v_who        text;   -- ADDITIVE (owner ping)
  v_loc_name   text;   -- ADDITIVE (070, branch in credit copy)
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
  select * into v_pkg from public.packages where id = p_package_id;
  if not found then           return jsonb_build_object('ok', false, 'reason', 'package_missing');  end if;
  if not v_pkg.is_active then  return jsonb_build_object('ok', false, 'reason', 'package_inactive'); end if;

  -- ADDITIVE (063): a pre-1.4 client cannot buy outside the default branch.
  -- Placed after the package is resolved so the answer distinguishes "no such
  -- package" from "a real package you are too old to buy", and before anything
  -- is written.
  -- 065: `is distinct from`, not `<>`. With no default row `<>` yields NULL, the
  -- AND yields NULL, the IF does not fire and the guard fails OPEN — while the
  -- RLS policies using the same value fail CLOSED. Same condition, opposite
  -- directions, which is the shape of a latent hole.
  if v_pkg.location_id is distinct from tpa.default_location_id()
     and not tpa.client_is_location_aware() then
    return jsonb_build_object('ok', false, 'reason', 'update_required');
  end if;

  -- ADDITIVE (066): one pending request per player PER BRANCH, matching the
  -- unique index 065 installed. This check used to sit above, before the package
  -- was resolved, where it had no branch to compare against and so enforced one
  -- pending request GLOBALLY — refusing a second branch that the index allows.
  -- It also fired before the 063 guard, which meant a legacy client with a
  -- pending request was told 'already_pending' when the honest answer was
  -- 'update_required'. Moving it below the package read fixes both.
  if exists (select 1 from public.credit_requests
              where player_id = v_player and status = 'pending'
                and location_id = v_pkg.location_id) then
    return jsonb_build_object('ok', false, 'reason', 'already_pending');
  end if;

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
    when not_null_violation then
      -- ADDITIVE (065): the SAME race, now surfacing one constraint earlier.
      -- tpa.force_location_from_package copies location_id from the package; if
      -- the package has just been hard-deleted the copy is NULL and location_id
      -- NOT NULL fires before the foreign key ever gets a chance. Concurrency
      -- scenario M caught this as a raw error where it used to be a clean reason.
      return jsonb_build_object('ok', false, 'reason', 'package_missing');
  end;
  -- ── ADDITIVE: remind the owners to go look at the admin ──────────────────
  -- Emitted only here, on the success return, AFTER the request row is committed.
  -- Every early return above is a rejection and reaches none of this.
  -- ADDITIVE (070): resolved ONCE, above the message that reads it.
  -- tpa.location_name coalesces a missing row to 'the academy' (066), so a
  -- concatenated body can never become NULL and violate notifications.body.
  v_loc_name := tpa.location_name(v_pkg.location_id);

  select name into v_who from public.players where id = v_player;
  perform tpa.notify_owners(
    'owner_credit_request',
    'New credit request',
    coalesce(v_who, 'A player') || ' requested ' || v_pkg.session_count || ' '
      || initcap(v_pkg.training_type) || ' Credits for ' || v_loc_name,
    v_player,
    null);

  return jsonb_build_object('ok', true, 'request_id', v_id);
end;
$fn$;


-- reject_credit_request — the player's 'Credit request declined'. 066 made the
-- pending limit PER BRANCH, so a player can hold one live request at each; from that
-- moment this message stopped identifying WHICH request was refused.
create or replace function public.reject_credit_request(p_request_id text, p_reason text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $fn$
declare
  v_admin text;
  v_req   public.credit_requests;
  v_loc_name text;   -- ADDITIVE (070, branch in credit copy)
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;
  v_admin := (select id from public.admins where auth_user_id = (select auth.uid()));

  select * into v_req from public.credit_requests where id = p_request_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'request_missing'); end if;

  if v_req.status <> 'pending' then
    if v_req.status = 'rejected' then
      return jsonb_build_object('ok', true, 'already_resolved', true);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'not_pending');  -- already approved
  end if;

  update public.credit_requests
     set status = 'rejected', resolved_at = now(), resolved_by = v_admin, reject_reason = btrim(p_reason)
   where id = p_request_id;

  -- ADDITIVE (070): resolved ONCE, above the message that reads it.
  -- tpa.location_name coalesces a missing row to 'the academy' (066), so a
  -- concatenated body can never become NULL and violate notifications.body.
  v_loc_name := tpa.location_name(v_req.location_id);

  perform tpa.notify(
    v_req.player_id, 'credit_request_rejected', 'Credit request declined',
    'Your credit request for ' || v_loc_name || ' was declined: ' || btrim(p_reason),
    null, null);

  return jsonb_build_object('ok', true, 'rejected', true);
end;
$fn$;
