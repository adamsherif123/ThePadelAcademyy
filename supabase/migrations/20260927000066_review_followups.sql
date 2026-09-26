-- ============================================================================
-- Session 4 review follow-ups: the three defects the independent review found
-- in 065, plus the one it found underneath 065.
--
-- 1. request_credits enforced one pending request per player GLOBALLY while the
--    index 065 installed allows one PER BRANCH. The check ran before the package
--    was resolved, so it had no branch to compare against — and it fired before
--    063's legacy guard, masking update_required.
-- 2. tpa.location_name could return NULL. Unreachable today (locations.name is
--    NOT NULL and every caller passes an FK-backed id), but every notification
--    concatenates it unguarded, so a NULL would make the whole body NULL and
--    abort a booking that had already spent a credit.
-- 3. A player whose trial is already used could still open a Paymob checkout for
--    a SECOND trial package. They pay; settle_purchase then hits
--    credit_batches_one_trial_purchase_per_player and raises 23505. Money taken,
--    nothing minted. 065 made this easy to reach by giving every branch its own
--    trial package.
-- ============================================================================

-- ── 1. tpa.location_name: NULL-safe ─────────────────────────────────────────
-- A missing row now reads as a name rather than poisoning a concatenation. The
-- FK and locations.name NOT NULL still make the miss unreachable; this is the
-- belt to that pair of braces, so a future branch-deletion path can never turn a
-- notification into a 23502 AFTER the credit has been decremented.
create or replace function tpa.location_name(p_location_id text)
  returns text
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coalesce((select name from public.locations where id = p_location_id), 'the academy')
$$;

revoke all on function tpa.location_name(text) from public, anon, authenticated;

comment on function tpa.location_name(text) is
  'Branch display name for notification copy. NULL-safe (066): a missing row reads as ''the academy'' so a concatenated body can never become NULL.';


-- ── 2. request_credits: one pending request per player PER BRANCH ───────────
-- Composed from the definition live on dev, with exactly two hunks: the unscoped
-- pre-check removed from above the package read, and a branch-scoped one added
-- below it. Reverting both restores the prior body byte-for-byte.
--
-- Reason precedence changes as a result. package_missing, package_inactive and
-- update_required now answer BEFORE already_pending, where previously
-- already_pending answered first for every one of them.
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
$fn$;

-- ── 3. a second trial can no longer be PAID FOR ─────────────────────────────
-- The once-per-player trial has always been enforced at the mint:
-- credit_batches_one_trial_purchase_per_player, UNIQUE (player_id) WHERE
-- training_type = 'trial' AND source = 'purchase'. That invariant holds — a
-- player can never end up holding two purchased trial batches.
--
-- What it does NOT do is stop the player paying. Measured on dev:
--
--   trial already used (source='purchase')
--   → player INSERTs a pending paymob purchase for the OTHER branch's trial  ACCEPTED
--   → player pays Paymob
--   → webhook calls settle_purchase                                          raises 23505
--   → purchase stays pending/paid=false, zero credits minted
--
-- The unique index is the right last line of defence, but it fires one step too
-- late: after the money. settle_purchase is service_role-only and has no trial
-- guard of its own, and adding one there would still be after the payment. The
-- only place to refuse is where the checkout is opened.
--
-- Not new in 065 — the same sequence worked against a single trial package. 065
-- made it reachable by ordinary means, because every branch now has its own
-- trial package to buy.
-- Takes NO player argument on purpose. It could read the player from the NEW row,
-- but this function is EXECUTE-able by authenticated (see the grant below), and a
-- player-id parameter would let anyone ask "has THAT player used their trial?".
-- Deriving the caller internally makes the question unaskable about anyone else,
-- and the policy already pins player_id = current_player_id() alongside it.
create or replace function tpa.trial_purchase_blocked(p_package_id text)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (select 1 from public.packages pk
                  where pk.id = p_package_id and pk.training_type = 'trial')
     and tpa.trial_used(public.current_player_id())
$$;

-- SECURITY DEFINER because the body names tpa.trial_used and tpa.* is not on any
-- client role's search path or grants.
--
-- ── the grant is LOAD-BEARING, and the reason is not the obvious one ──
-- A policy expression resolves its SCHEMA qualification with the table owner's
-- privileges — `tpa.foo()` inside a policy does not raise "permission denied for
-- schema tpa" the way the same call raises it typed directly by `authenticated`.
-- EXECUTE, however, is still checked against the QUERYING role. Revoking it here
-- (which is this repo's reflex for a tpa helper) makes every insert fail with
--
--     42501  permission denied for function trial_purchase_blocked
--
-- including every ordinary non-trial checkout. That is why 063's
-- tpa.default_location_id() and tpa.client_is_location_aware() carry grants to
-- anon/authenticated while tpa.location_name() and tpa.trial_used() do not: the
-- first two are named by policies, the second two only by SECURITY DEFINER RPCs.
-- anon is not granted because this policy is `for insert to authenticated`.
revoke all on function tpa.trial_purchase_blocked(text) from public, anon, authenticated;
grant execute on function tpa.trial_purchase_blocked(text) to authenticated;

comment on function tpa.trial_purchase_blocked(text) is
  'True when p_package_id is a trial package AND the CALLING player already used their trial. Named by purchases_insert_own_pending (066) to refuse the checkout before money moves, so EXECUTE must stay granted to authenticated.';

-- Reproduced verbatim from 050 — every pin, including the LOAD-BEARING amount
-- subselect — with ONE conjunct added, the same way 050 added its coach conjunct.
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
    -- ADDITIVE (066): and a second trial cannot be paid for. Legacy-safe: for any
    -- non-trial package the conjunct is false-and-therefore-absent, so the 1.2/1.3
    -- checkout is untouched. ADMIN trial grants stay allowed ON PURPOSE —
    -- grant_credits writes source='admin_grant', which is outside both this policy
    -- and the once-per-player index, so an owner can still comp a trial.
    and not tpa.trial_purchase_blocked(package_id)
  );
