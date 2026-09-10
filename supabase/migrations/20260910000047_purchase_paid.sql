-- ============================================================================
-- purchases.paid — revenue counts only money the academy has actually COLLECTED.
--
-- ── the separation this introduces ──
-- Approving a credit request or recording a cash sale used to count as revenue the
-- instant it happened. Now there are two independent facts about a purchase:
--   • CREDITS GRANTED — unchanged. The player gets their credits the moment the
--     admin approves / records the sale, exactly as before.
--   • MONEY COLLECTED — new. `paid`, false until the admin confirms they have the
--     money in hand, and toggleable both ways.
-- Revenue is now the sum of succeeded purchases WHERE paid. Toggling never creates
-- or deletes a row: the purchase is the audit trail and it always survives.
--
-- ── new purchases are unpaid; existing ones are grandfathered ──
-- The column defaults to false, so every purchase created from now on starts
-- unpaid. Every SUCCEEDED purchase that exists when this runs is set paid = true:
-- they are already counted in live revenue, and the figure must not drop the
-- moment this deploys. Pending/failed rows are left false deliberately — they
-- never counted toward revenue, and a failed card attempt was never collected, so
-- marking them paid would put a false statement in the ledger. (A pending Paymob
-- row that later settles is set paid by settle_purchase below.) The revenue
-- figure is identical either way; only the truthfulness of those rows differs.
--
-- ── approve_credit_request and record_cash_purchase are NOT redefined ──
-- Both insert with an explicit column list that doesn't mention `paid`, so the
-- column default makes their purchases unpaid with no edit at all. Neither
-- function appears in this migration, so their credit minting, amounts and
-- {ok,reason} paths are untouched by construction rather than by care.
--
-- ── settle_purchase gets one line ──
-- The Paymob path was the case the brief didn't name. A card payment is inserted
-- pending and flipped to succeeded by the webhook; with a false default it would
-- have been excluded from revenue forever, although the gateway collected it.
-- One additive update on the settled path marks it paid.
--
-- ── revenue lives client-side ──
-- There is no SQL revenue aggregate: the admin Dashboard sums purchases in
-- apps/admin/src/data/dashboard.ts. That file changes alongside this migration.
-- ============================================================================

-- ── 1. the column ─────────────────────────────────────────────────────────────
alter table public.purchases add column paid boolean not null default false;

comment on column public.purchases.paid is
  'Has the academy confirmed it COLLECTED this money? Revenue = succeeded AND paid. Set via set_purchase_paid; independent of credits, which are granted on approval regardless.';

update public.purchases set paid = true where status = 'succeeded';

-- ── 2. the sanctioned write path ──────────────────────────────────────────────
-- The admin has no direct write on purchases (no UPDATE grant, no admin policy —
-- the S5.2 line), so marking paid is a SECURITY DEFINER RPC like every other
-- money write. Only a SUCCEEDED purchase can be marked paid: nothing was collected
-- on a pending or failed one. Idempotent — setting the value it already has
-- returns ok with changed = false and writes nothing.
create or replace function public.set_purchase_paid(p_purchase_id text, p_paid boolean)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_status text;
  v_paid   boolean;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;
  if p_paid is null then return jsonb_build_object('ok', false, 'reason', 'invalid_paid'); end if;

  select status, paid into v_status, v_paid from public.purchases where id = p_purchase_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'purchase_missing'); end if;
  if v_status <> 'succeeded' then return jsonb_build_object('ok', false, 'reason', 'not_succeeded'); end if;

  if v_paid = p_paid then
    return jsonb_build_object('ok', true, 'paid', p_paid, 'changed', false);
  end if;

  update public.purchases set paid = p_paid where id = p_purchase_id;
  return jsonb_build_object('ok', true, 'paid', p_paid, 'changed', true);
end;
$$;

revoke all on function public.set_purchase_paid(text, boolean) from public;
grant execute on function public.set_purchase_paid(text, boolean) to authenticated;

-- ── 3. settle_purchase — unchanged except one line on the settled path ────────
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

  -- ADDITIVE (047): a gateway settlement IS collected money — Paymob has already
  -- taken the card payment, so there is nothing for the academy to confirm by hand.
  -- Only reached on the path where the guarded update above actually advanced the
  -- row; the redelivery and not_pending branches return before this line.
  update public.purchases set paid = true where id = p_purchase_id;

  v_batch_id := tpa.mint_credits_for_purchase(p_purchase_id);
  return jsonb_build_object('ok', true, 'already_settled', false, 'credit_batch_id', v_batch_id);
end;
$$;
revoke all on function public.settle_purchase(text, text) from public, anon, authenticated;
grant execute on function public.settle_purchase(text, text) to service_role;

-- ── 4. the player insert policy — unchanged except the paid pin ───────────────
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
    -- LOAD-BEARING — DO NOT "simplify" the amount subselect. It is RLS-filtered:
    -- an INACTIVE package is invisible to the player, so the subselect yields
    -- NULL → amount = NULL → NULL → WITH CHECK fails. This is the only thing
    -- stopping a player from purchasing a hidden/inactive package (rls_test 23).
    and amount = (select price from public.packages where id = package_id)
  );
