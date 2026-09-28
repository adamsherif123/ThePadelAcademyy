-- ============================================================================
-- 071 — remove the refund feature (Sessions 5 and 5.5) entirely
--
-- WHY
-- The refund feature exists to handle one situation: Paymob captured a card
-- payment and the credits could not be minted. There is no Paymob integration in
-- this release and there will not be one — every credit comes from a credit
-- request an admin approves, an admin grant, or a recorded cash purchase. None of
-- those can take money without issuing credits, because the money and the credits
-- are the same admin action.
--
-- So settle_purchase's refund branch cannot fire, the Refunds page can never have
-- a row, and refund_required_at can never be set. Carrying two columns, two CHECK
-- constraints, an RPC, an admin page and two owner notifications for a state that
-- cannot occur is worse than carrying nothing: it is code nobody exercises and
-- everybody has to reason about.
--
-- WHAT IS KEPT, DELIBERATELY
--   • Every credit-transfer object from 067 — the source value, transferred_from,
--     credit_batches_note_shape, transfer_credit_batch, delete_credit_batch's
--     batch_has_transfers. Transfers are a live feature.
--   • The transfer notification riding on `credits_granted` (068).
--   • The 066 purchases policy that refuses a second trial checkout.
--   • tpa.refund_booking and the p_refund paths in cancel_booking /
--     remove_booking / cancel_session. Those return a CREDIT to a wallet when a
--     session is cancelled. They share a word with this feature and nothing else.
--
-- WHAT COMES BACK
-- settle_purchase, fail_purchase and set_purchase_paid are restored to their
-- definitions from BEFORE 067 — the text of 20260910000047 and 20260725000012,
-- unmodified. Restoring settle_purchase also removes 067's catch of the trial
-- unique violation, and that is correct rather than a regression: that catch had
-- no behaviour of its own, it existed ONLY to produce the refund-required state.
-- Its race needs two card checkouts settling at once, which nothing can now do.
--
-- HARD CONSTRAINT
-- Nothing a 1.2 (99541ff) or 1.3 (255b73f) client cannot render may survive.
-- After this migration purchases.status is back to exactly the three they know
-- ('pending', 'succeeded', 'failed') — 068 already restored that CHECK and this
-- migration asserts it rather than re-stating it — and notifications.type is
-- untouched. Removing two columns is invisible to them: neither build reads a
-- column it does not know about, and both mappers stop sending them.
-- ============================================================================

-- ── 1. refuse to run if the state this removes actually exists ──────────────
-- A destructive migration that silently discards rows is not a migration, it is
-- a data loss with a version number. Proven zero on dev before writing this
-- (read-only); this is the guard that makes the claim hold wherever it runs next.
do $$
declare
  v_required int;
  v_refunded int;
begin
  select count(*) into v_required from public.purchases where refund_required_at is not null;
  select count(*) into v_refunded from public.purchases where refunded_at is not null;
  if v_required > 0 or v_refunded > 0 then
    raise exception
      '071 refuses to run: % purchase(s) have refund_required_at and % have refunded_at. '
      'Those rows are money owed to a player. Settle them before removing the feature.',
      v_required, v_refunded;
  end if;
  raise notice '071: no refund-bearing purchase rows — safe to remove';
end;
$$;

-- ── 2. the RPC goes ─────────────────────────────────────────────────────────
-- DROP takes its grants and its comment with it. No IF EXISTS: if it is already
-- gone, something else has been editing this database and the migration should
-- say so rather than shrug.
drop function public.mark_purchase_refunded(text, text);

-- ── 3. the three purchase functions, restored to their pre-067 text ─────────
-- Copied verbatim from the migrations that last defined them before 067
-- (20260910000047 for settle_purchase and set_purchase_paid, 20260725000012 for
-- fail_purchase). Proven by capturing pg_get_functiondef on a database built to
-- exactly 066 and again after this migration: the three are identical.

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

create or replace function public.fail_purchase(p_purchase_id text, p_gateway_transaction_id text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status from public.purchases where id = p_purchase_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'purchase_missing'); end if;

  -- Guarded fail: only a PENDING purchase advances (and only once). We record the
  -- gateway transaction id even on a decline — the ledger tells the whole truth.
  update public.purchases
    set status = 'failed', gateway_transaction_id = p_gateway_transaction_id
    where id = p_purchase_id and status = 'pending';
  if not found then
    -- Already terminal. A redelivered decline is a no-op; a succeeded purchase is
    -- NEVER flipped to failed (terminal-state rule) — and no credits are touched.
    if v_status = 'failed' then return jsonb_build_object('ok', true, 'already_failed', true); end if;
    return jsonb_build_object('ok', false, 'reason', 'already_succeeded');
  end if;

  -- No mint. Ever. A decline produces no credits.
  return jsonb_build_object('ok', true, 'already_failed', false);
end;
$$;

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

-- `create or replace` preserves existing grants, so these are the grants the
-- functions already carried. Restated because the restore is the point: the
-- webhook roles (service_role) for the two it calls, `authenticated` for the one
-- the admin app calls.
revoke all on function public.settle_purchase(text, text)   from public, anon, authenticated;
grant execute on function public.settle_purchase(text, text)   to service_role;
revoke all on function public.fail_purchase(text, text)     from public, anon, authenticated;
grant execute on function public.fail_purchase(text, text)     to service_role;
revoke all on function public.set_purchase_paid(text, boolean) from public, anon, service_role;
grant execute on function public.set_purchase_paid(text, boolean) to authenticated;

-- ── 4. the columns and their CHECKs ─────────────────────────────────────────
-- Constraints first and by name, so a rename upstream fails loudly here instead
-- of being swallowed by a cascade.
alter table public.purchases drop constraint purchases_refunded_needs_required;
alter table public.purchases drop constraint purchases_refund_required_shape;
alter table public.purchases drop column refunded_at;
alter table public.purchases drop column refund_required_at;

-- ── 5. what must still be true afterwards ───────────────────────────────────
-- Asserted, not assumed. Each of these is something this migration could
-- plausibly have broken, and the cost of being wrong is a client that cannot
-- render a row it is handed.
do $$
begin
  -- The status CHECK is the legacy three. 068 restored it; 071 must not disturb it.
  if (select pg_get_constraintdef(oid) from pg_constraint
       where conrelid = 'public.purchases'::regclass and conname = 'purchases_status_check')
     <> 'CHECK ((status = ANY (ARRAY[''pending''::text, ''succeeded''::text, ''failed''::text])))' then
    raise exception '071: purchases_status_check is not the legacy three';
  end if;

  -- The transfer feature is untouched.
  if to_regprocedure('public.transfer_credit_batch(text,text,integer,text)') is null then
    raise exception '071: transfer_credit_batch is missing';
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.credit_batches'::regclass
                    and conname in ('credit_batches_transfer_link', 'credit_batches_note_shape')
                  having count(*) = 2) then
    raise exception '071: a credit-transfer constraint is missing';
  end if;
  if (select pg_get_constraintdef(oid) from pg_constraint
       where conrelid = 'public.credit_batches'::regclass and conname = 'credit_batches_source_check')
      not like '%transfer%' then
    raise exception '071: credit_batches.source no longer allows transfer';
  end if;

  -- The 066 trial-checkout policy is untouched.
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'purchases'
                    and policyname = 'purchases_insert_own_pending') then
    raise exception '071: the trial-checkout purchases policy is missing';
  end if;

  -- And the refund feature is genuinely gone.
  if to_regprocedure('public.mark_purchase_refunded(text,text)') is not null then
    raise exception '071: mark_purchase_refunded still exists';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'purchases'
                and column_name in ('refund_required_at', 'refunded_at')) then
    raise exception '071: a refund column still exists';
  end if;
  raise notice '071: refund feature removed; transfers, the trial policy and the legacy statuses intact';
end;
$$;
