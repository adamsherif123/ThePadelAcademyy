-- ============================================================================
-- S7b — admin + money RPC proof (pgTAP, single session).
--
-- Every admin RPC's happy path + rejections, the full SECURITY MATRIX negative
-- cases (a player calling an admin RPC → not_admin; a player calling
-- settle_purchase → 42501), and settle_purchase double-delivery minting once.
-- The book_slot-vs-cancel_session race is concurrency.sh, not here.
--
-- Run with:  supabase test db
-- ============================================================================
begin;
select plan(71);

-- ── seed as postgres ─────────────────────────────────────────────────────────
-- S8: auth_user_id now FK-references auth.users — seed the linked auth rows first.
insert into auth.users (id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff');

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_a',   '+201000000001', 'Ali', 'men', 'beginner', now(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('pl_b',   '+201000000002', 'Bea', 'men', 'beginner', now(), 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('pl_c',   '+201000000003', 'Cy',  'men', 'beginner', now(), 'cccccccc-cccc-cccc-cccc-cccccccccccc');

-- A1: the admin is NOT a player — an auth user linked to an admins row, no player row.
-- The tests set claims to this uid to act as admin; is_admin() reads admins.
insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('adm_test', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'Adm', now());

insert into public.coaches (id, name, bio, is_active) values
  ('co_cs','C','b',true),('co_rb','C','b',true),('co_gl','C','b',true),('co_gi','C','b',true),
  ('co_full','C','b',true),('co_nc','C','b',true),('co_cxl','C','b',true);

insert into public.packages (id, training_type, session_count, price, name, is_active) values
  ('pk_g4','group',4,160000,'Group 4',true),
  ('pk_hidden','group',8,280000,'Hidden',false),
  ('pk_trial','trial',2,0,'Trial',true),
  ('pk_d4','duo',4,220000,'Duo 4',true);

insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status) values
  ('sl_cs',    'co_cs',   now()+interval '1 day', now()+interval '1 day 1 hour', 'trial', 4, 2, null, null, 'published'),
  ('sl_rb',    'co_rb',   now()+interval '1 day', now()+interval '1 day 1 hour', 'trial', 4, 2, null, null, 'published'),
  ('sl_gl',    'co_gl',   now()+interval '1 day', now()+interval '1 day 1 hour', 'group', 4, 0, 'ladies', 'beginner',     'published'),
  ('sl_gi',    'co_gi',   now()+interval '1 day', now()+interval '1 day 1 hour', 'group', 4, 0, 'men',    'intermediate', 'published'),
  ('sl_full',  'co_full', now()+interval '1 day', now()+interval '1 day 1 hour', 'group', 1, 1, 'ladies', 'beginner',     'published'),
  ('sl_nc',    'co_nc',   now()+interval '1 day', now()+interval '1 day 1 hour', 'group', 4, 0, 'ladies', 'beginner',     'published'),
  ('sl_cxl',   'co_cxl',  now()+interval '1 day', now()+interval '1 day 1 hour', 'trial', 4, 0, null, null, 'published');

-- One signup_grant per player (the partial index). The extra group batches are
-- admin_grants. cb_a2 expires LATER than cb_a_grp so admin_book deterministically
-- spends cb_a_grp (earliest-expiring wins).
insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at) values
  ('cb_a',     'pl_a', 'signup_grant', null, 'trial', 2, 1, now()+interval '30 day', now()),
  ('cb_b',     'pl_b', 'signup_grant', null, 'trial', 2, 1, now()+interval '30 day', now()),
  ('cb_a2',    'pl_a', 'admin_grant',  null, 'group', 2, 1, now()+interval '40 day', now()),
  ('cb_b2',    'pl_b', 'admin_grant',  null, 'group', 2, 1, now()+interval '40 day', now()),
  ('cb_a_grp', 'pl_a', 'admin_grant',  null, 'group', 3, 3, now()+interval '30 day', now());

-- Active bookings for cancel_session (sl_cs) and remove_booking (sl_rb).
insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at) values
  ('bk_cs1', 'sl_cs', 'pl_a', 'cb_a',  'booked', now()),
  ('bk_cs2', 'sl_cs', 'pl_b', 'cb_b',  'booked', now()),
  ('bk_rb1', 'sl_rb', 'pl_a', 'cb_a2', 'booked', now()),
  ('bk_rb2', 'sl_rb', 'pl_b', 'cb_b2', 'booked', now());

-- Pending paymob purchases: pu_s for settle_purchase, pu_f for fail_purchase (S6.1).
insert into public.purchases (id, player_id, package_id, status, amount, created_at, payment_method, gateway_order_id) values
  ('pu_s', 'pl_a', 'pk_d4', 'pending', 220000, now(), 'paymob', 'ord_s'),
  ('pu_f', 'pl_a', 'pk_d4', 'pending', 220000, now(), 'paymob', 'ord_f');

-- ════════════════════════════════════════════════════════════════════════════
-- AS ADMIN
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ffffffff-ffff-ffff-ffff-ffffffffffff","role":"authenticated"}', true);

-- grant_credits (mirror of buildAdminGrant)
select is(public.grant_credits('pl_a','individual',3,'Rained-out Jul 10')->>'ok', 'true', 'grant_credits → ok');
select is((select source from public.credit_batches where note='Rained-out Jul 10'), 'admin_grant', 'granted batch source = admin_grant');
select is((select purchase_id from public.credit_batches where note='Rained-out Jul 10'), null, 'granted batch purchase_id is null');
select is((select quantity_remaining from public.credit_batches where note='Rained-out Jul 10'), 3, 'granted quantity = 3');
select is((select expires_at - created_at from public.credit_batches where note='Rained-out Jul 10'), interval '30 days', 'grant expiry = now() + tpa.credit_expiry() (30d, no extra time)');
select is(public.grant_credits('pl_a','group',3,'   ')->>'reason', 'reason_required', 'grant rejects a blank note');
select is(public.grant_credits('pl_a','group',3,null)->>'reason', 'reason_required', 'grant rejects a null note (DB requires the why, like the UI)');
select is(public.grant_credits('pl_a','group',0,'x')->>'reason', 'quantity_below_one', 'grant rejects quantity < 1');
select is(public.grant_credits('pl_nope','group',1,'x')->>'reason', 'player_missing', 'grant rejects an unknown player');

-- record_cash_purchase (mirror of buildCashPurchase + mint), with a discount.
-- A DUO package (its minted credit can't compete with the group admin_book pick).
select is(public.record_cash_purchase('pl_a','pk_d4',150000)->>'ok', 'true', 'record_cash_purchase → ok (150,000 < list 220,000: a discount)');
select is((select status from public.purchases where payment_method='cash'), 'succeeded', 'cash purchase is succeeded');
select is((select amount from public.purchases where payment_method='cash'), 150000, 'cash amount is the captured (discounted) amount, not list');
select is((select coalesce(gateway_order_id,'')||coalesce(gateway_transaction_id,'') from public.purchases where payment_method='cash'), '', 'cash purchase carries no gateway refs');
select is((select c.source from public.purchases p join public.credit_batches c on c.purchase_id=p.id where p.payment_method='cash'), 'purchase', 'cash credits are ordinary purchase-backed credits');
select is((select c.quantity_remaining from public.purchases p join public.credit_batches c on c.purchase_id=p.id where p.payment_method='cash'), 4, 'cash mint grants the package session_count');
select is(public.record_cash_purchase('pl_a','pk_trial',10000)->>'ok', 'true', 'cash CAN sell a trial package now (A5 — trial is a one-time purchasable package)');
select is(public.record_cash_purchase('pl_a','pk_hidden',280000)->>'reason', 'package_inactive', 'cash rejects an INACTIVE package (not looser than the player path)');
select is(public.record_cash_purchase('pl_a','pk_g4',0)->>'reason', 'amount_below_one', 'cash rejects amount < 1');
select is(public.record_cash_purchase('pl_a','pk_nope',1)->>'reason', 'package_missing', 'cash rejects an unknown package');
select is(public.record_cash_purchase('pl_nope','pk_g4',1)->>'reason', 'player_missing', 'cash rejects an unknown player');

-- admin_book_player (override = gender/level ONLY; hard blocks still win)
select is(public.admin_book_player('sl_gl','pl_a',false)->>'reason', 'gender_mismatch', 'admin_book no-override: gender mismatch blocks');
select is(public.admin_book_player('sl_gi','pl_a',false)->>'reason', 'level_mismatch',  'admin_book no-override: level mismatch blocks');
select is(public.admin_book_player('sl_gl','pl_a',true)->>'ok', 'true', 'admin_book override: gender mismatch waived → ok');
select is(public.admin_book_player('sl_gl','pl_a',true)->>'reason', 'already_booked', 'admin_book: a second live booking → already_booked (constraint, not override)');
select is((select booked_count from public.session_slots where id='sl_gl'), 1, 'override booking took exactly one seat');
select is((select quantity_remaining from public.credit_batches where id='cb_a_grp'), 2, 'override booking spent one group credit (3 → 2)');
select is(public.admin_book_player('sl_full','pl_a',true)->>'reason', 'slot_full', 'HARD BLOCK WINS: full + mismatch + override → slot_full, not ok');
select is(public.admin_book_player('sl_nc','pl_c',true)->>'reason', 'no_usable_credit', 'HARD BLOCK WINS: no-credit + mismatch + override → no_usable_credit');
select is(public.admin_book_player('sl_gl','pl_nope',true)->>'reason', 'player_missing', 'admin_book rejects an unknown player');
select is(public.admin_book_player('sl_nope','pl_a',true)->>'reason', 'slot_missing', 'admin_book rejects an unknown slot');

-- cancel_session (unconditional refund, idempotent)
select is(public.cancel_session('sl_cs')->>'refunded_count', '2', 'cancel_session refunds all 2 booked players');
select is((select status from public.session_slots where id='sl_cs'), 'cancelled', 'cancelled session → status cancelled');
select is((select booked_count from public.session_slots where id='sl_cs'), 0, 'cancelled session → booked_count 0');
select is((select quantity_remaining from public.credit_batches where id='cb_a'), 2, 'cancel_session refunded pl_a regardless of the window (1 → 2)');
select is((select quantity_remaining from public.credit_batches where id='cb_b'), 2, 'cancel_session refunded pl_b (1 → 2)');
select is((select count(*)::int from public.bookings where slot_id='sl_cs' and status='cancelled'), 2, 'both bookings on the slot are cancelled');
select is(public.cancel_session('sl_cs')->>'reason', 'already_cancelled', 'cancel_session is idempotent (no double refund)');
select is(public.cancel_session('sl_nope')->>'reason', 'slot_missing', 'cancel_session rejects an unknown slot');

-- remove_booking (explicit refund flag)
select is(public.remove_booking('bk_rb1', true)->>'refunded', 'true', 'remove_booking(refund=true) → refunded');
select is((select quantity_remaining from public.credit_batches where id='cb_a2'), 2, 'remove with refund returned the credit (1 → 2)');
select is(public.remove_booking('bk_rb2', false)->>'refunded', 'false', 'remove_booking(refund=false) → forfeit');
select is((select quantity_remaining from public.credit_batches where id='cb_b2'), 1, 'remove without refund kept the credit spent (stays 1)');
select is((select booked_count from public.session_slots where id='sl_rb'), 0, 'both seats freed regardless of refund');
select is(public.remove_booking('bk_rb1', true)->>'reason', 'already_cancelled', 'remove_booking is idempotent');
select is(public.remove_booking('bk_nope', true)->>'reason', 'booking_missing', 'remove_booking rejects an unknown booking');

-- Task 0 reason path: an admin-cancelled slot books as slot_cancelled (the new
-- follow-up SELECT distinguishes it from slot_full).
select is(public.cancel_session('sl_cxl')->>'ok', 'true', 'admin cancels sl_cxl for the race-reason check');

-- ════════════════════════════════════════════════════════════════════════════
-- SECURITY MATRIX — a player calling admin RPCs → not_admin (as data)
-- ════════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
select is(public.cancel_session('sl_rb')->>'reason',                'not_admin', 'player → cancel_session denied (not_admin)');
select is(public.remove_booking('bk_cs1', true)->>'reason',        'not_admin', 'player → remove_booking denied (not_admin)');
select is(public.admin_book_player('sl_gl','pl_a',true)->>'reason','not_admin', 'player → admin_book_player denied (not_admin)');
select is(public.grant_credits('pl_a','group',1,'x')->>'reason',   'not_admin', 'player → grant_credits denied (not_admin)');
select is(public.record_cash_purchase('pl_a','pk_g4',1)->>'reason','not_admin', 'player → record_cash_purchase denied (not_admin)');
-- Task 0: booking a slot cancelled out from under you reports slot_cancelled.
select is(public.book_slot('sl_cxl')->>'reason', 'slot_cancelled', 'book_slot on a cancelled slot → slot_cancelled (guarded WHERE + follow-up reason)');
-- A player may NOT execute settle_purchase / fail_purchase at all (privilege layer).
select throws_ok($$ select public.settle_purchase('pu_s','x') $$, '42501', null, 'player → settle_purchase DENIED at the privilege layer (42501)');
select throws_ok($$ select public.fail_purchase('pu_f','x') $$, '42501', null, 'player → fail_purchase DENIED at the privilege layer (42501)');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- settle_purchase — service_role only; idempotent double-delivery
-- ════════════════════════════════════════════════════════════════════════════
set local role service_role;
select is(public.settle_purchase('pu_s','txn_s')->>'already_settled', 'false', 'settle_purchase #1 → mints (already_settled=false)');
select is(public.settle_purchase('pu_s','txn_s')->>'already_settled', 'true',  'settle_purchase #2 (redelivery) → already_settled, no second mint');
select is(public.settle_purchase('pu_nope','x')->>'reason', 'purchase_missing', 'settle_purchase rejects an unknown purchase');

-- ── fail_purchase (S6.1) — a declined callback records failed, mints nothing ──
select is(public.fail_purchase('pu_f','txn_f')->>'already_failed', 'false', 'fail_purchase #1 → records failed (already_failed=false)');
select is(public.fail_purchase('pu_f','txn_f2')->>'already_failed', 'true',  'fail_purchase #2 (redelivery) → already_failed, a no-op');
select is(public.fail_purchase('pu_nope','x')->>'reason', 'purchase_missing', 'fail_purchase rejects an unknown purchase');
-- TERMINAL-STATE RULE, both directions:
select is(public.settle_purchase('pu_f','x')->>'reason', 'not_pending', 'a FAILED purchase can never be settled (not_pending, mints nothing)');
select is(public.fail_purchase('pu_s','x')->>'reason', 'already_succeeded', 'a SUCCEEDED purchase can never be failed (already_succeeded)');
reset role;

select is((select count(*)::int from public.credit_batches where purchase_id='pu_s'), 1, 'double-delivery minted EXACTLY ONE batch');
select is((select status from public.purchases where id='pu_s'), 'succeeded', 'settled purchase → succeeded');
select is((select gateway_transaction_id from public.purchases where id='pu_s'), 'txn_s', 'settle recorded the gateway transaction id');
-- fail_purchase outcomes: pu_f is terminally failed, minted nothing, and the
-- redelivery (txn_f2) did NOT overwrite the recorded transaction id.
select is((select status from public.purchases where id='pu_f'), 'failed', 'declined purchase → failed');
select is((select gateway_transaction_id from public.purchases where id='pu_f'), 'txn_f', 'fail recorded the gateway txn id; redelivery did not overwrite it (guarded)');
select is((select count(*)::int from public.credit_batches where purchase_id='pu_f'), 0, 'a declined purchase minted ZERO credit batches');

-- anon is denied settle_purchase / fail_purchase too (privilege layer).
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select public.settle_purchase('pu_s','x') $$, '42501', null, 'anon → settle_purchase DENIED at the privilege layer (42501)');
select throws_ok($$ select public.fail_purchase('pu_f','x') $$, '42501', null, 'anon → fail_purchase DENIED at the privilege layer (42501)');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- S7b.1 INVARIANT GUARD — mechanical, so the ABBA deadlock can't silently return.
-- cancel_session is the ONLY RPC that locks MULTIPLE credit_batches at once (it
-- refunds every booking on a slot), which is why it MUST lock them in
-- credit_batch_id order (20260720000007_s7b1). If a future RPC adds an explicit
-- `from … credit_batches … for update` lock, this set_eq FAILS — forcing the author
-- to confirm it uses the same ordered discipline (or it reopens the deadlock).
-- (Single-row `update credit_batches` in book_slot etc. locks one row and is fine.)
select set_eq(
  $$ select p.proname
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prosrc ~* 'from\s+public\.credit_batches[^;]*for\s+update' $$,
  $$ values ('cancel_session') $$,
  'cancel_session is the ONLY function locking credit_batches FOR UPDATE (S7b.1 ordered-lock invariant)'
);

select * from finish();
rollback;
