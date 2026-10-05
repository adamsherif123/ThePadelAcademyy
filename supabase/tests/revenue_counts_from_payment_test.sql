-- ============================================================================
-- 072 — revenue counts from the day the money was COLLECTED (pgTAP).
--
-- The scenario this exists for, stated once: a player requests credits on
-- 30 September, the admin takes the cash on 1 October and ticks Paid. That
-- 600 EGP belongs to OCTOBER. Before 072 it landed in September, because every
-- revenue figure bucketed on created_at.
--
-- The tests below cannot wait until next month, so they do the equivalent: a
-- purchase whose created_at is backdated well into the past, paid NOW, must end
-- up with a revenue_at of now — a different month from the one it was created
-- in. If that ever stops holding, revenue has gone back to being dated by the
-- sale rather than the payment.
--
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(22);

insert into auth.users (id) values
  ('0c7a0000-0000-0000-0000-00000000c7a0'),   -- admin
  ('0c7b0000-0000-0000-0000-00000000c7b0');   -- player

insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('adm_rv', '0c7a0000-0000-0000-0000-00000000c7a0', 'AdmRev', now());

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_rv', '+201900012001', 'Rev Player', 'men', 'beginner', now(), '0c7b0000-0000-0000-0000-00000000c7b0');

insert into public.packages (id, training_type, session_count, price, name, is_active) values
  ('pk_rv', 'group', 8, 280000, 'Revenue-test 8', true);

-- Created two months and a day ago: far enough back that "the month it was
-- created in" and "the month it is paid in" can never be the same month,
-- whatever day of the year this suite happens to run on.
insert into public.purchases
  (id, player_id, package_id, status, amount, created_at, payment_method, gateway_order_id, gateway_transaction_id)
values
  ('pu_rv_late', 'pl_rv', 'pk_rv', 'succeeded', 280000, now() - interval '2 months 1 day', 'instapay', null, null),
  ('pu_rv_open', 'pl_rv', 'pk_rv', 'succeeded', 280000, now() - interval '2 months 1 day', 'instapay', null, null);

-- ── the shape of the two columns ────────────────────────────────────────────
select is(
  (select is_nullable from information_schema.columns
    where table_schema='public' and table_name='purchases' and column_name='paid_at'),
  'YES', 'paid_at is nullable — "not collected yet" is a real state');

select is(
  (select is_generated from information_schema.columns
    where table_schema='public' and table_name='purchases' and column_name='revenue_at'),
  'ALWAYS', 'revenue_at is GENERATED — nothing can write it directly, so nothing can disagree about it');

select is(
  (select generation_expression from information_schema.columns
    where table_schema='public' and table_name='purchases' and column_name='revenue_at'),
  'COALESCE(paid_at, created_at)', 'and it is exactly coalesce(paid_at, created_at)');

select ok(
  exists (select 1 from pg_indexes where schemaname='public' and indexname='purchases_revenue_at_idx'),
  'revenue_at is indexed — the Dashboard filters a month on it server-side');

-- ── before payment: revenue_at is the sale date ─────────────────────────────
select is(
  (select paid_at from public.purchases where id='pu_rv_late'),
  null, 'an unpaid purchase has no paid_at');

select is(
  (select revenue_at from public.purchases where id='pu_rv_late'),
  (select created_at from public.purchases where id='pu_rv_late'),
  'and its revenue_at falls back to created_at — the latest-sales feed still sees it');

-- ════════════════════════════════════════════════════════════════════════════
-- THE WHOLE POINT: paid today, counted today
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0c7a0000-0000-0000-0000-00000000c7a0","role":"authenticated"}', true);

select is(
  (select (public.set_purchase_paid('pu_rv_late', true) ->> 'ok')::boolean),
  true, 'an admin marks the September sale paid');

select ok(
  (select paid_at from public.purchases where id='pu_rv_late') is not null,
  'paid_at is stamped');

select ok(
  (select paid_at from public.purchases where id='pu_rv_late') >= now() - interval '1 minute',
  'and it is stamped with NOW, not with the sale date');

select is(
  (select revenue_at from public.purchases where id='pu_rv_late'),
  (select paid_at from public.purchases where id='pu_rv_late'),
  'revenue_at follows paid_at the moment it is set');

select isnt(
  (select date_trunc('month', revenue_at at time zone 'Africa/Cairo') from public.purchases where id='pu_rv_late'),
  (select date_trunc('month', created_at at time zone 'Africa/Cairo') from public.purchases where id='pu_rv_late'),
  'THE SCENARIO: the purchase now counts in the month it was PAID, not the month it was requested');

select is(
  (select date_trunc('month', revenue_at at time zone 'Africa/Cairo') from public.purchases where id='pu_rv_late'),
  date_trunc('month', now() at time zone 'Africa/Cairo'),
  'and that month is this one');

-- ── un-paying takes the stamp away again ────────────────────────────────────
select is(
  (select (public.set_purchase_paid('pu_rv_late', false) ->> 'ok')::boolean),
  true, 'the admin un-ticks it (recorded against the wrong purchase)');

select is(
  (select paid_at from public.purchases where id='pu_rv_late'),
  null, 'paid_at is cleared — an uncollected purchase must not keep a collection date');

select is(
  (select revenue_at from public.purchases where id='pu_rv_late'),
  (select created_at from public.purchases where id='pu_rv_late'),
  'and revenue_at falls back to the sale date again');

-- ── re-paying stamps afresh, it does not restore the old date ───────────────
select is(
  (select (public.set_purchase_paid('pu_rv_late', true) ->> 'ok')::boolean),
  true, 're-ticking it');
select ok(
  (select paid_at from public.purchases where id='pu_rv_late') >= now() - interval '1 minute',
  'stamps the new collection date, not the one from the first tick');

-- ── a no-op toggle changes nothing ──────────────────────────────────────────
select is(
  (select (public.set_purchase_paid('pu_rv_late', true) ->> 'changed')::boolean),
  false, 'ticking an already-paid purchase reports no change');

-- ── the untouched purchase is genuinely untouched ───────────────────────────
select is(
  (select paid from public.purchases where id='pu_rv_open'),
  false, 'the other purchase is still unpaid');
select is(
  (select paid_at from public.purchases where id='pu_rv_open'),
  null, 'and still has no paid_at — one toggle moves exactly one row');

-- ── the invariant that keeps revenue honest ─────────────────────────────────
reset role;
select is(
  (select count(*)::int from public.purchases where paid and paid_at is null),
  0, 'no paid purchase anywhere is missing its paid_at');
select is(
  (select count(*)::int from public.purchases where not paid and paid_at is not null),
  0, 'and no unpaid purchase carries a stale one');

select * from finish();
rollback;
