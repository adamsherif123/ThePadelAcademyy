-- ============================================================================
-- 071 — the refund feature is gone, and what it sat next to is not (pgTAP).
--
-- A removal needs a test for the same reason an addition does: without one,
-- nothing stops a later migration quietly bringing the columns back, and nothing
-- notices if the removal took a neighbour with it.
--
-- The feature existed for one situation — Paymob captured money that could not be
-- turned into credits. There is no Paymob integration, so the situation cannot
-- arise, and the columns, the CHECKs, the RPC and the admin page that served it
-- are all removed. What it was interleaved with — credit transfers (067), the
-- transfer notification on `credits_granted` (068), the 066 trial-checkout policy
-- — stays, and is asserted here precisely because 071 could have taken it.
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(18);

-- ── 1. gone ─────────────────────────────────────────────────────────────────
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'purchases'
      and column_name in ('refund_required_at', 'refunded_at')),
  0, 'purchases has neither refund column');
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.purchases'::regclass
      and conname in ('purchases_refund_required_shape', 'purchases_refunded_needs_required')),
  0, 'and neither of their CHECK constraints');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'mark_purchase_refunded'),
  0, 'mark_purchase_refunded does not exist, under any signature');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'tpa') and p.prosrc like '%refund_required%'),
  0, 'no function anywhere still mentions refund_required');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'tpa') and p.prosrc like '%Refund required%'),
  0, 'and the owner "Refund required" copy is gone with it');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'tpa') and p.prosrc like '%Refund recorded%'),
  0, 'as is "Refund recorded"');

-- ── 2. the legacy vocabulary is exactly what 1.2/1.3 can render ─────────────
-- This is the hard constraint, checked as a value rather than trusted: 067 added
-- a fourth status and 068 had to take it back out, so the CHECK is the place
-- where that mistake would show up again.
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.purchases'::regclass and conname = 'purchases_status_check'),
  'CHECK ((status = ANY (ARRAY[''pending''::text, ''succeeded''::text, ''failed''::text])))',
  'purchases.status is the three values the un-updatable builds can render');
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.notifications'::regclass and conname = 'notifications_type_check'
      and pg_get_constraintdef(oid) like '%owner_refund_required%'),
  0, 'no owner_refund_required notification type (068 removed it; 071 keeps it out)');

-- ── 3. the three purchase functions are back to their pre-067 shape ─────────
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'settle_purchase'
      and p.prosrc like '%mint_credits_for_purchase%' and p.prosrc not like '%exception%'),
  1, 'settle_purchase mints and no longer catches anything — its pre-067 body');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('fail_purchase', 'set_purchase_paid')
      and p.prosrc like '%refund%'),
  0, 'fail_purchase and set_purchase_paid mention refunds nowhere');

-- ── 4. what 071 must NOT have taken with it ─────────────────────────────────
select isnt(to_regprocedure('public.transfer_credit_batch(text,text,integer,text)')::text, null,
  'transfer_credit_batch survives — transfers are a live feature');
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.credit_batches'::regclass
      and conname in ('credit_batches_transfer_link', 'credit_batches_note_shape')),
  2, 'and both constraints 067 added for it');
select ok(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.credit_batches'::regclass and conname = 'credit_batches_source_check')
    like '%transfer%',
  'credit_batches.source still allows ''transfer''');
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.credit_batches'::regclass and conname = 'credit_batches_transfer_link'),
  1, 'transferred_from is still linked to its source');
select isnt(to_regprocedure('public.delete_credit_batch(text)')::text, null,
  'delete_credit_batch survives, with its batch_has_transfers guard');
select ok(
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'delete_credit_batch') like '%batch_has_transfers%',
  'and that guard is still in it');
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'purchases' and policyname = 'purchases_insert_own_pending'),
  1, 'the 066 policy refusing a second trial checkout is untouched');
select ok(
  (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'transfer_credit_batch') like '%credits_granted%',
  'and the transfer notification still rides the credits_granted type (068)');

select * from finish();
rollback;
