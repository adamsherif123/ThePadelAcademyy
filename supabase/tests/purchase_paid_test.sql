-- ============================================================================
-- purchases.paid — revenue counts only COLLECTED money (pgTAP).
--
-- Proves the separation the migration introduces: an approval or a cash sale
-- grants credits IMMEDIATELY and creates an UNPAID purchase; revenue (succeeded
-- AND paid) moves only when the admin toggles paid, in both directions, without a
-- row ever being created or destroyed; the toggle never claws credits back; only
-- an admin can toggle it; a player can neither write the flag nor pre-mark their
-- own checkout paid; and a Paymob settlement — money the gateway already took —
-- is paid automatically.
--
-- The grandfathering UPDATE (existing succeeded rows → paid) can't be exercised
-- here: this suite runs on an empty database, so there are no pre-existing rows
-- when the migration applies. It's verified against real data on cloud dev and
-- prod, where the revenue total is compared before and after the push.
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(33);

insert into auth.users (id) values
  ('0f1a0000-0000-0000-0000-00000000f1a0'),   -- admin
  ('0a2a0000-0000-0000-0000-00000000a2a0'),   -- player A (InstaPay request)
  ('0b2b0000-0000-0000-0000-00000000b2b0');   -- player B (cash sale + the RLS probes)

insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('adm_pp', '0f1a0000-0000-0000-0000-00000000f1a0', 'AdmPP', now());

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_pa', '+201900011001', 'Payer A', 'men', 'beginner', now(), '0a2a0000-0000-0000-0000-00000000a2a0'),
  ('pl_pb', '+201900011002', 'Payer B', 'men', 'beginner', now(), '0b2b0000-0000-0000-0000-00000000b2b0');

insert into public.packages (id, training_type, session_count, price, name, is_active) values
  ('pk_pp8', 'group', 8, 280000, 'Paid-test 8', true);

-- A pending Paymob checkout, for the settle path.
insert into public.purchases
  (id, player_id, package_id, status, amount, created_at, payment_method, gateway_order_id, gateway_transaction_id)
values ('pu_pp_card', 'pl_pb', 'pk_pp8', 'pending', 280000, now(), 'paymob', 'ord_pp', null);

-- ── the column ──────────────────────────────────────────────────────────────
select is(
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'purchases' and column_name = 'paid'),
  'false', 'new purchases default to UNPAID');
select is(
  (select is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'purchases' and column_name = 'paid'),
  'NO', 'paid is NOT NULL — there is no "unknown" state');

-- ════════════════════════════════════════════════════════════════════════════
-- An APPROVAL: credits now, revenue only once paid
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0a2a0000-0000-0000-0000-00000000a2a0","role":"authenticated"}', true);
select is(public.request_credits('pk_pp8', 'instapay', null)->>'ok', 'true', 'player A submits an InstaPay credit request');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0f1a0000-0000-0000-0000-00000000f1a0","role":"authenticated"}', true);
select is(
  public.approve_credit_request((select id from public.credit_requests where player_id = 'pl_pa'))->>'ok',
  'true', 'the admin approves it — approve_credit_request is unchanged');
reset role;

select is(
  (select paid from public.purchases where id = (select purchase_id from public.credit_requests where player_id = 'pl_pa')),
  false, 'the approval created an UNPAID purchase');
select is(
  (select quantity_remaining from public.credit_batches
    where purchase_id = (select purchase_id from public.credit_requests where player_id = 'pl_pa')),
  8, 'the player STILL got all 8 credits on approval — credits granted is not money collected');
select is(
  (select coalesce(sum(amount), 0)::int from public.purchases where status = 'succeeded' and paid),
  0, 'an approved-but-unpaid purchase contributes NOTHING to revenue');

-- ════════════════════════════════════════════════════════════════════════════
-- A CASH SALE: same rule
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0f1a0000-0000-0000-0000-00000000f1a0","role":"authenticated"}', true);
select is(public.record_cash_purchase('pl_pb', 'pk_pp8', 250000)->>'ok', 'true', 'the admin records a cash sale — record_cash_purchase is unchanged');
reset role;

select is(
  (select paid from public.purchases where player_id = 'pl_pb' and payment_method = 'cash'),
  false, 'a recorded CASH purchase is also created unpaid');
select is(
  (select quantity_remaining from public.credit_batches
    where purchase_id = (select id from public.purchases where player_id = 'pl_pb' and payment_method = 'cash')),
  8, 'and its credits were granted immediately');
select is(
  (select coalesce(sum(amount), 0)::int from public.purchases where status = 'succeeded' and paid),
  0, 'still zero revenue — nothing has been marked paid');

-- ════════════════════════════════════════════════════════════════════════════
-- The TOGGLE: revenue follows it both ways; the row and the credits never move
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0f1a0000-0000-0000-0000-00000000f1a0","role":"authenticated"}', true);
select is(
  public.set_purchase_paid((select purchase_id from public.credit_requests where player_id = 'pl_pa'), true)->>'changed',
  'true', 'marking the approval paid changes it');
reset role;
select is(
  (select coalesce(sum(amount), 0)::int from public.purchases where status = 'succeeded' and paid),
  280000, 'marking it paid ADDS it to revenue');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0f1a0000-0000-0000-0000-00000000f1a0","role":"authenticated"}', true);
select is(
  public.set_purchase_paid((select purchase_id from public.credit_requests where player_id = 'pl_pa'), true)->>'changed',
  'false', 'marking it paid AGAIN is a no-op (idempotent)');
reset role;
select is(
  (select coalesce(sum(amount), 0)::int from public.purchases where status = 'succeeded' and paid),
  280000, '...and does not double-count');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0f1a0000-0000-0000-0000-00000000f1a0","role":"authenticated"}', true);
select is(
  public.set_purchase_paid((select id from public.purchases where player_id = 'pl_pb' and payment_method = 'cash'), true)->>'ok',
  'true', 'marking the cash sale paid');
reset role;
select is(
  (select coalesce(sum(amount), 0)::int from public.purchases where status = 'succeeded' and paid),
  530000, 'revenue is the sum of PAID purchases only (280000 + 250000)');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0f1a0000-0000-0000-0000-00000000f1a0","role":"authenticated"}', true);
select is(
  public.set_purchase_paid((select purchase_id from public.credit_requests where player_id = 'pl_pa'), false)->>'ok',
  'true', 'un-marking the approval paid');
reset role;
select is(
  (select coalesce(sum(amount), 0)::int from public.purchases where status = 'succeeded' and paid),
  250000, 'un-marking it REMOVES it from revenue');
select is(
  (select count(*)::int from public.purchases
    where id = (select purchase_id from public.credit_requests where player_id = 'pl_pa')),
  1, 'the purchase row SURVIVES every toggle — nothing is created or destroyed');
select is(
  (select quantity_remaining from public.credit_batches
    where purchase_id = (select purchase_id from public.credit_requests where player_id = 'pl_pa')),
  8, 'un-marking paid never claws back the credits');

-- ════════════════════════════════════════════════════════════════════════════
-- Guards
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0f1a0000-0000-0000-0000-00000000f1a0","role":"authenticated"}', true);
select is(public.set_purchase_paid('pu_nope', true)->>'reason', 'purchase_missing', 'an unknown purchase is refused cleanly');
select is(public.set_purchase_paid('pu_pp_card', true)->>'reason', 'not_succeeded',
  'a PENDING purchase cannot be marked paid — nothing was collected');
select is(
  public.set_purchase_paid((select purchase_id from public.credit_requests where player_id = 'pl_pa'), null)->>'reason',
  'invalid_paid', 'a null flag is refused, never coerced');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0b2b0000-0000-0000-0000-00000000b2b0","role":"authenticated"}', true);
select is(
  public.set_purchase_paid((select id from public.purchases where player_id = 'pl_pb' and payment_method = 'cash'), false)->>'reason',
  'not_admin', 'a player cannot call set_purchase_paid');
select throws_ok(
  $$ update public.purchases set paid = true where player_id = 'pl_pb' $$,
  '42501', null, 'a player cannot write purchases.paid directly (no UPDATE grant)');
select throws_ok(
  $$ insert into public.purchases
       (id, player_id, package_id, status, amount, created_at, payment_method, gateway_order_id, gateway_transaction_id, paid)
     values ('pu_self_paid', 'pl_pb', 'pk_pp8', 'pending', 280000, now(), 'paymob', null, null, true) $$,
  '42501', null, 'a player cannot open their own checkout pre-marked PAID (the new policy pin)');
select lives_ok(
  $$ insert into public.purchases
       (id, player_id, package_id, status, amount, created_at, payment_method, gateway_order_id, gateway_transaction_id)
     values ('pu_self_ok', 'pl_pb', 'pk_pp8', 'pending', 280000, now(), 'paymob', null, null) $$,
  '...while the same checkout WITHOUT the flag still works — the pin blocks only paid');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- A Paymob SETTLEMENT is collected money — paid automatically
-- ════════════════════════════════════════════════════════════════════════════
select is(public.settle_purchase('pu_pp_card', 'txn_pp')->>'ok', 'true', 'the Paymob webhook settles the card payment');
select is((select status from public.purchases where id = 'pu_pp_card'), 'succeeded',
  'settle_purchase still advances pending → succeeded (unchanged)');
select ok(exists (select 1 from public.credit_batches where purchase_id = 'pu_pp_card'),
  'and still mints the credits (unchanged)');
select is((select paid from public.purchases where id = 'pu_pp_card'), true,
  'a gateway-settled card payment is PAID — the gateway already collected it');
select is(
  (select coalesce(sum(amount), 0)::int from public.purchases where status = 'succeeded' and paid),
  530000, 'so it counts toward revenue with no admin action (250000 cash + 280000 card)');

select * from finish();
rollback;
