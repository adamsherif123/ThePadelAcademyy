-- ============================================================================
-- A3 — credit_requests rail: table shape, RLS, RPCs, Storage (pgTAP).
--
-- The request is a CLAIM; the approval is the TRUTH. This proves: a player creates
-- exactly one pending request (not for a hidden/trial package, not two); approval mints
-- the right credits (default AND overridden), records a SUCCEEDED purchase (real revenue,
-- right method, no gateway refs — not a comp), notifies, and is idempotent; rejection
-- mints nothing, needs a reason, notifies, is idempotent; a player is refused both admin
-- RPCs; and the Storage policies are own-scoped with admin read-all.
-- Run with:  supabase test db
-- ============================================================================
begin;
select plan(56);

-- ── seed as postgres ─────────────────────────────────────────────────────────
insert into auth.users (id) values
  ('ffffffff-ffff-ffff-ffff-ffffffffffff'),   -- admin
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),   -- player A
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),   -- player B
  ('cccccccc-cccc-cccc-cccc-cccccccccccc'),   -- player C
  ('dddddddd-dddd-dddd-dddd-dddddddddddd');   -- player D

insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('adm_1', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'Adm', now());

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_A', '+201000000001', 'Ali', 'men',    'beginner', now(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('pl_B', '+201000000002', 'Bea', 'ladies', 'beginner', now(), 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('pl_C', '+201000000003', 'Cy',  'men',    'beginner', now(), 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('pl_D', '+201000000004', 'Dia', 'men',    'beginner', now(), 'dddddddd-dddd-dddd-dddd-dddddddddddd');

insert into public.packages (id, training_type, session_count, price, name, is_active) values
  ('pk_grp', 'group', 8, 280000, '8-pack',  true),
  ('pk_off', 'group', 4, 140000, 'Hidden',  false),   -- inactive/hidden
  ('pk_trl', 'trial', 1, 0,      'Trial',   true);     -- structurally unsellable

-- ── resolution_shape CHECK (as postgres, RLS bypassed) ──────────────────────
select throws_ok(
  $$ insert into public.credit_requests (id,player_id,package_id,payment_method,status,created_at,reject_reason)
       values ('cr_bad1','pl_A','pk_grp','instapay','pending',now(),'x') $$,
  '23514', null, 'CHECK: a pending request carries no resolution fields');
select throws_ok(
  $$ insert into public.credit_requests (id,player_id,package_id,payment_method,status,created_at,resolved_at,resolved_by)
       values ('cr_bad2','pl_A','pk_grp','instapay','rejected',now(),now(),'adm_1') $$,
  '23514', null, 'CHECK: a rejected request must carry a reason');

-- ════════════════════════════════════════════════════════════════════════════
-- AS PLAYER A — create one pending request
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
select is(public.request_credits('pk_grp','instapay','pl_A/receipt.jpg')->>'ok', 'true', 'A creates a pending request');
select is((select count(*)::int from public.credit_requests where player_id='pl_A' and status='pending'), 1, 'exactly one pending row for A');
select is(public.request_credits('pk_grp','instapay',null)->>'reason', 'already_pending', 'A cannot open a SECOND pending request');

-- RLS direct-insert pins (A bypassing request_credits): all CHECK-valid rows, RLS-tripped.
select throws_ok(
  $$ insert into public.credit_requests (id,player_id,package_id,payment_method,status,created_at)
       values ('cr_x1','pl_B','pk_grp','instapay','pending',now()) $$,
  '42501', null, 'A cannot insert a request for ANOTHER player (player_id pin)');
select throws_ok(
  $$ insert into public.credit_requests (id,player_id,package_id,payment_method,status,created_at)
       values ('cr_x2','pl_A','pk_off','instapay','pending',now()) $$,
  '42501', null, 'A cannot request a HIDDEN package (RLS-filtered exists-pin)');
select throws_ok(
  $$ insert into public.credit_requests (id,player_id,package_id,payment_method,status,created_at)
       values ('cr_x3','pl_A','pk_trl','cash','pending',now()) $$,
  '42501', null, 'A cannot request a TRIAL package (non-trial pin)');
select throws_ok(
  $$ insert into public.credit_requests (id,player_id,package_id,payment_method,status,created_at,resolved_by)
       values ('cr_x4','pl_A','pk_grp','instapay','pending',now(),'adm_1') $$,
  '42501', null, 'A cannot set a resolution field on insert (RLS pins them empty)');
select throws_ok(
  $$ update public.credit_requests set status='approved' where player_id='pl_A' $$,
  '42501', null, 'A cannot UPDATE a request at all (no update grant)');
select throws_ok(
  $$ delete from public.credit_requests where player_id='pl_A' $$,
  '42501', null, 'A cannot DELETE a request (no delete grant)');

-- ════════════════════════════════════════════════════════════════════════════
-- AS PLAYER B — the request-rejection reasons (B has no pending yet)
-- ════════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}', true);
-- (trial is SELLABLE since A5 — the once-per-player trial rules live in a5_trial_test.)
select is(public.request_credits('pk_off','instapay',null)->>'reason', 'package_inactive', 'cannot request a hidden/inactive package');
select is(public.request_credits('pk_grp','venmo',null)->>'reason', 'invalid_payment_method', 'rejects an unknown payment method');
select is(public.request_credits('pk_nope','cash',null)->>'reason', 'package_missing', 'rejects a missing package');
select is(public.request_credits('pk_grp','instapay','pl_A/steal.jpg')->>'reason', 'invalid_proof_path', 'rejects a proof path outside the caller''s own folder');
select is(public.request_credits('pk_grp','instapay','pl_B/receipt.jpg')->>'ok', 'true', 'B creates a valid pending request (own proof path)');

-- ════════════════════════════════════════════════════════════════════════════
-- AS PLAYER C / D — set up a reject case and a guard case
-- ════════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}', true);
select is(public.request_credits('pk_grp','cash',null)->>'ok', 'true', 'C creates a pending request (to be rejected)');
select set_config('request.jwt.claims', '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}', true);
select is(public.request_credits('pk_grp','instapay',null)->>'ok', 'true', 'D creates a pending request (for the guard tests)');

-- player refused on BOTH admin RPCs (as D, a non-admin)
select is(public.approve_credit_request((select id from public.credit_requests where player_id='pl_A'))->>'reason', 'not_admin', 'a player cannot approve');
select is(public.reject_credit_request((select id from public.credit_requests where player_id='pl_A'), 'nope')->>'reason', 'not_admin', 'a player cannot reject');

-- ════════════════════════════════════════════════════════════════════════════
-- AS ADMIN — approve (default), then idempotency; approve (override); reject; guards
-- Read side-effects as postgres (RLS bypassed): the emitted notifications belong to the
-- PLAYERS, and notifications RLS has no is_admin branch (the s12 lesson). The admin RPCs
-- authorise via is_admin() on the JWT claim, not the session role, so this works.
-- ════════════════════════════════════════════════════════════════════════════
reset role;
select set_config('request.jwt.claims', '{"sub":"ffffffff-ffff-ffff-ffff-ffffffffffff","role":"authenticated"}', true);

-- A: default approve → package's 8 credits, amount = price
select is(public.approve_credit_request((select id from public.credit_requests where player_id='pl_A'))->>'ok', 'true', 'admin approves A (defaults)');
select is((select status from public.credit_requests where player_id='pl_A'), 'approved', 'A''s request is approved');
select is((select resolved_by from public.credit_requests where player_id='pl_A'), 'adm_1', 'resolved_by records the admin');
select isnt((select purchase_id from public.credit_requests where player_id='pl_A'), null, 'the request links to its purchase');
select is(
  (select status||'/'||payment_method||'/'||amount::text||'/'||coalesce(gateway_order_id,'-')||coalesce(gateway_transaction_id,'-')
     from public.purchases where id = (select purchase_id from public.credit_requests where player_id='pl_A')),
  'succeeded/instapay/280000/--', 'a SUCCEEDED instapay purchase, real amount, NO gateway refs');
select is(
  (select source||'/'||quantity_total::text||'/'||quantity_remaining::text
     from public.credit_batches where purchase_id = (select purchase_id from public.credit_requests where player_id='pl_A')),
  'purchase/8/8', 'the mint is a purchase-backed batch of the package''s 8 credits');
select is((select sum(amount)::int from public.purchases where status='succeeded' and player_id='pl_A'), 280000, 'approval counts toward revenue');
select is((select count(*)::int from public.credit_batches where player_id='pl_A' and source='admin_grant'), 0, 'NOT a comp: no admin_grant batch');
select is((select count(*)::int from public.credit_batches where player_id='pl_A' and source='purchase'), 1, 'exactly one purchase-backed (revenue) batch');
select is((select count(*)::int from public.notifications where player_id='pl_A' and type='credits_granted'), 1, 'the player is notified of the credits');
-- idempotent approve: mints once
select is(public.approve_credit_request((select id from public.credit_requests where player_id='pl_A'))->>'already_resolved', 'true', 'approving twice is idempotent');
select is((select count(*)::int from public.credit_batches where player_id='pl_A' and source='purchase'), 1, '…still exactly ONE batch (mints once)');
select is((select count(*)::int from public.purchases where player_id='pl_A'), 1, '…still exactly ONE purchase');

-- B: override quantity + amount (payment didn't match the pack)
select is(public.approve_credit_request((select id from public.credit_requests where player_id='pl_B'), 7, 260000)->>'ok', 'true', 'admin approves B with overrides');
select is((select quantity_total from public.credit_batches where purchase_id = (select purchase_id from public.credit_requests where player_id='pl_B')), 7, 'the OVERRIDE quantity (7) is minted, not the package''s 8');
select is((select amount from public.purchases where id = (select purchase_id from public.credit_requests where player_id='pl_B')), 260000, 'the OVERRIDE amount (260000) is recorded on the purchase');

-- C: reject
select is(public.reject_credit_request((select id from public.credit_requests where player_id='pl_C'), '')->>'reason', 'reason_required', 'reject requires a non-empty reason');
select is(public.reject_credit_request((select id from public.credit_requests where player_id='pl_C'), 'Payment not received')->>'ok', 'true', 'admin rejects C with a reason');
select is((select status||'/'||reject_reason from public.credit_requests where player_id='pl_C'), 'rejected/Payment not received', 'C is rejected, reason stored');
select is((select count(*)::int from public.credit_batches where player_id='pl_C'), 0, 'reject mints NOTHING');
select is((select count(*)::int from public.purchases where player_id='pl_C'), 0, 'reject creates no purchase');
select is((select count(*)::int from public.notifications where player_id='pl_C' and type='credit_request_rejected'), 1, 'the player is notified of the rejection');
select is(public.reject_credit_request((select id from public.credit_requests where player_id='pl_C'), 'again')->>'already_resolved', 'true', 'rejecting twice is idempotent');

-- D: override guards (positive, sane bounds) — a bad override mints nothing, leaves it pending
select is(public.approve_credit_request((select id from public.credit_requests where player_id='pl_D'), 0)->>'reason', 'invalid_quantity', 'a granted quantity below 1 → invalid_quantity');
select is(public.approve_credit_request((select id from public.credit_requests where player_id='pl_D'), 8, 0)->>'reason', 'invalid_amount', 'an amount below 1 → invalid_amount');
select is((select status from public.credit_requests where player_id='pl_D'), 'pending', 'a rejected-override approve leaves the request pending');
select is((select count(*)::int from public.purchases where player_id='pl_D'), 0, '…and mints no purchase');

-- ════════════════════════════════════════════════════════════════════════════
-- Storage: payment-proofs is own-scoped, admin reads all
-- These MUST run as the authenticated role so the storage.objects RLS actually applies
-- (the admin read-all is a real is_admin() policy branch, unlike notifications).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('payment-proofs', 'pl_A/proof.jpg') $$,
  'A uploads a proof into their OWN folder');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('payment-proofs', 'pl_B/sneak.jpg') $$,
  '42501', null, 'A cannot upload into ANOTHER player''s folder');

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}', true);
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('payment-proofs', 'pl_B/proof.jpg') $$,
  'B uploads a proof into their own folder');
select is((select count(*)::int from storage.objects where bucket_id='payment-proofs' and name='pl_A/proof.jpg'), 0, 'B CANNOT read A''s proof');
select is((select count(*)::int from storage.objects where bucket_id='payment-proofs' and name='pl_B/proof.jpg'), 1, 'B reads their OWN proof');

select set_config('request.jwt.claims', '{"sub":"ffffffff-ffff-ffff-ffff-ffffffffffff","role":"authenticated"}', true);
select is((select count(*)::int from storage.objects where bucket_id='payment-proofs'), 2, 'the admin reads ALL proofs (to review them)');

reset role;
select is((select public from storage.buckets where id='payment-proofs'), false, 'the payment-proofs bucket is PRIVATE');
select is((select file_size_limit from storage.buckets where id='payment-proofs')::int, 5242880, 'bucket file size limit is 5 MiB');
select is((select allowed_mime_types from storage.buckets where id='payment-proofs'), array['image/jpeg','image/png','image/webp'], 'bucket allows only image MIME types');

select * from finish();
rollback;
