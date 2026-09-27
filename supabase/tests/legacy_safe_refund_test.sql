-- ============================================================================
-- 068 — the refund-required state in words the shipped apps know, and the exit
-- from it. Every client-triggered path runs as the real role.
--
-- The invariant this file exists to defend: purchases.status never takes a value
-- outside pending|succeeded|failed, because 1.2 (99541ff) and 1.3 (255b73f) index
-- STATUS_META[purchase.status] with no fallback (purchase-history.tsx:113 in
-- both) and can never be updated.
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(36);

insert into auth.users (id) values
  ('0c3c3c01-0000-0000-0000-0000000c3c01'),   -- admin
  ('0c3c3c02-0000-0000-0000-0000000c3c02'),   -- player
  ('0c3c3c03-0000-0000-0000-0000000c3c03');   -- owner

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id, is_owner) values
  ('pl_lr_adm', '+201900680001', 'Admin', 'men', 'beginner', now(), '0c3c3c01-0000-0000-0000-0000000c3c01', false),
  ('pl_lr_p1',  '+201900680002', 'Yara',  'men', 'beginner', now(), '0c3c3c02-0000-0000-0000-0000000c3c02', false),
  ('pl_lr_own', '+201900680003', 'Owner', 'men', 'beginner', now(), '0c3c3c03-0000-0000-0000-0000000c3c03', true);
insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('ad_lr', '0c3c3c01-0000-0000-0000-0000000c3c01', 'Hala', now());

insert into public.locations (id, name, address, maps_url, hours_text, sort_order, is_active, is_default) values
  ('loc_lr_b', 'QA Branch', 'x', 'https://a.b', 'h', 60, true, false);
insert into public.packages (id, training_type, session_count, price, name, is_active, location_id) values
  ('pk_lr_t_def', 'trial', 1,   5000, 'Trial Oro',  true, 'loc_oro_plaza'),
  ('pk_lr_t_b',   'trial', 1,   5000, 'Trial QA',   true, 'loc_lr_b'),
  ('pk_lr_grp',   'group', 4, 100000, 'Oro 4-pack', true, 'loc_oro_plaza');

-- ════════════════════════════════════════════════════════════════════════════
-- Shape: three statuses, two new columns, and the CHECKs that tie them together
-- ════════════════════════════════════════════════════════════════════════════
select has_column('public', 'purchases', 'refund_required_at', 'purchases.refund_required_at exists');
select has_column('public', 'purchases', 'refunded_at',        'purchases.refunded_at exists');

-- A real row to test the CHECKs against: an UPDATE matching zero rows never
-- evaluates them, which is a way to write a test that always passes.
insert into public.purchases (id, player_id, package_id, status, amount, created_at, payment_method, paid)
  values ('pu_lr_ok', 'pl_lr_p1', 'pk_lr_grp', 'succeeded', 100000, now(), 'paymob', true);

select throws_ok(
  $$ update public.purchases set status = 'refund_required' where id = 'pu_lr_ok' $$,
  '23514', null,
  'refund_required is GONE from the status CHECK — 1.2/1.3 could not render it');
select throws_ok(
  $$ update public.purchases set refund_required_at = now() where id = 'pu_lr_ok' $$,
  '23514', null,
  'refund_required_at cannot be set on a succeeded purchase — it means failed AND paid');
select throws_ok(
  $$ update public.purchases set refunded_at = now() where id = 'pu_lr_ok' $$,
  '23514', null,
  'and a refund cannot be recorded against something that never needed one');

-- ════════════════════════════════════════════════════════════════════════════
-- Grants: a player READS their own, and no client can write either column
-- ════════════════════════════════════════════════════════════════════════════
select ok(
  has_table_privilege('authenticated', 'public.purchases', 'SELECT')
  and not has_table_privilege('authenticated', 'public.purchases', 'UPDATE'),
  'purchases is SELECT + INSERT for authenticated, never UPDATE — the columns are read-only to clients');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0c3c3c02-0000-0000-0000-0000000c3c02"}', true);
select set_config('request.headers', '{"x-tpa-client":"mobile/1.4.0"}', true);
select throws_ok(
  $$ insert into public.purchases (id, player_id, package_id, status, amount, created_at, payment_method, paid, refund_required_at)
     values ('pu_lr_forge', 'pl_lr_p1', 'pk_lr_grp', 'pending', 100000, now(), 'paymob', false, now()) $$,
  '23514', null,
  'a player cannot forge refund_required_at at INSERT — the CHECK makes it unsatisfiable there');
select throws_ok(
  $$ insert into public.purchases (id, player_id, package_id, status, amount, created_at, payment_method, paid, refunded_at)
     values ('pu_lr_forge2', 'pl_lr_p1', 'pk_lr_grp', 'pending', 100000, now(), 'paymob', false, now()) $$,
  '23514', null,
  'nor refunded_at');
select is((select count(*)::int from public.purchases where id = 'pu_lr_ok'), 1,
  'but they can READ their own purchase, new columns included');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- settle_purchase parks the second trial as failed + paid + refund_required_at
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0c3c3c02-0000-0000-0000-0000000c3c02"}', true);
select set_config('request.headers', '{"x-tpa-client":"mobile/1.4.0"}', true);
select lives_ok(
  $$ insert into public.purchases (id, player_id, package_id, status, amount, created_at, payment_method, paid)
     values ('pu_lr_a', 'pl_lr_p1', 'pk_lr_t_def', 'pending', 5000, now(), 'paymob', false) $$,
  'both trial checkouts open before either is paid — 066 sees nothing wrong yet');
select lives_ok(
  $$ insert into public.purchases (id, player_id, package_id, status, amount, created_at, payment_method, paid)
     values ('pu_lr_b', 'pl_lr_p1', 'pk_lr_t_b', 'pending', 5000, now(), 'paymob', false) $$,
  'the second opens too');
reset role;

select isnt(public.settle_purchase('pu_lr_a', 'tx_lr_a')->>'credit_batch_id', null,
  'the first settle mints the trial');
select is(public.settle_purchase('pu_lr_b', 'tx_lr_b')->>'refund_required', 'true',
  'the second reports refund_required instead of raising');

select is((select status from public.purchases where id = 'pu_lr_b'), 'failed',
  'and is stored as FAILED — one of the three statuses 1.2/1.3 can render');
select is((select paid from public.purchases where id = 'pu_lr_b'), true,
  'paid stays true, because the card really was charged');
select isnt((select refund_required_at from public.purchases where id = 'pu_lr_b'), null,
  'refund_required_at is what tells a held payment from an ordinary decline');
select is((select refunded_at from public.purchases where id = 'pu_lr_b'), null,
  'and it is not refunded yet');
select is((select count(*)::int from public.credit_batches
            where player_id = 'pl_lr_p1' and training_type = 'trial'), 1,
  'the player still holds exactly one trial');

-- The owner ping uses a type the legacy apps have an icon and a route for.
select is((select type from public.notifications where title = 'Refund required'), 'owner_credit_request',
  'the owners are pinged as owner_credit_request — cash-outline and /notifications in both 1.2 and 1.3');
select ok((select body like '%Yara%' and body like '%50.00 EGP%'
             from public.notifications where title = 'Refund required'),
  'and the body carries the player name and the amount');

-- ════════════════════════════════════════════════════════════════════════════
-- The other three writers answer clearly for a held payment
-- ════════════════════════════════════════════════════════════════════════════
select is(public.fail_purchase('pu_lr_b', 'tx_again')->>'already_failed', 'true',
  'fail_purchase is an idempotent no-op — no longer the misleading already_succeeded (review #5)');
select is(public.fail_purchase('pu_lr_b', 'tx_again')->>'refund_required', 'true',
  'and it flags that this is money being held, not an ordinary decline');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0c3c3c01-0000-0000-0000-0000000c3c01"}', true);
select is(public.set_purchase_paid('pu_lr_b', false)->>'reason', 'refund_required',
  'set_purchase_paid says WHY rather than not_succeeded, and will not un-mark captured money');
reset role;

select lives_ok($$ select public.fail_stale_purchases() $$, 'fail_stale_purchases runs');
select is((select status from public.purchases where id = 'pu_lr_b'), 'failed',
  'and leaves the held payment exactly where it was (it only touches pending)');
select isnt((select refund_required_at from public.purchases where id = 'pu_lr_b'), null,
  'refund_required_at survives it');

-- ════════════════════════════════════════════════════════════════════════════
-- mark_purchase_refunded — the exit the review found missing
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0c3c3c02-0000-0000-0000-0000000c3c02"}', true);
select is(public.mark_purchase_refunded('pu_lr_b', 'done')->>'reason', 'not_admin',
  'a PLAYER cannot mark their own purchase refunded');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0c3c3c01-0000-0000-0000-0000000c3c01"}', true);
select is(public.mark_purchase_refunded('pu_lr_b', '  ')->>'reason', 'reason_required',
  'a blank note is refused — a refund with no account of it is not a record');
select is(public.mark_purchase_refunded('pu_nope', 'x')->>'reason', 'purchase_missing',
  'a missing purchase');
select is(public.mark_purchase_refunded('pu_lr_a', 'x')->>'reason', 'not_refund_required',
  'a purchase that never needed refunding');
select is(public.mark_purchase_refunded('pu_lr_b', 'refunded in Paymob, ref 12345')->>'ok', 'true',
  'the admin records the refund');
select is(public.mark_purchase_refunded('pu_lr_b', 'again')->>'reason', 'already_refunded',
  'and a second attempt is refused rather than silently overwriting when it happened');
reset role;

select isnt((select refunded_at from public.purchases where id = 'pu_lr_b'), null,
  'refunded_at is set');
select is((select status from public.purchases where id = 'pu_lr_b'), 'failed',
  'the status is untouched — still a value the legacy apps render');
select ok((select body like '%Hala%' and body like '%ref 12345%'
             from public.notifications where title = 'Refund recorded'),
  'and the note is recorded as an owner notification, naming the admin who did it');
select is((select count(*)::int from public.purchases
            where refund_required_at is not null and refunded_at is null), 0,
  'the Session 6 queue is now empty — which is the whole point of having an exit');

select * from finish();
rollback;
