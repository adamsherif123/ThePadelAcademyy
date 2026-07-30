-- ============================================================================
-- delete_package: hard-delete a genuinely unused package, retire (deleted_at,
-- is_active forced false, row + history intact) one with any purchase OR
-- credit_request history, block the trial package outright.
--
-- Proves: an unused package hard-deletes (row gone); a package with a
-- PURCHASE retires with the purchase intact; a package with only a PENDING
-- CREDIT_REQUEST (zero purchases) ALSO retires, not hard-deletes — the
-- catch-fallback decision is exhaustive across BOTH FK-referencing tables,
-- not just purchases; the trial package is blocked outright whether or not
-- it's ever been sold; a non-admin and an unknown package are rejected
-- cleanly; a second call on an already-deleted/retired package is a clean
-- idempotent no-op; the money RPCs (request_credits, record_cash_purchase)
-- reject a retired package as package_inactive (same as any hidden package)
-- and a hard-deleted one as package_missing, including through the NEW
-- foreign_key_violation guard those two RPCs needed once packages could
-- disappear out from under a concurrent purchase/request (see the real,
-- multi-connection race proof in concurrency.sh Scenario M — pgTAP is
-- single-session and cannot exercise the actual lock/race window itself).
--
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(31);

-- ── seed as postgres ─────────────────────────────────────────────────────────
insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'), -- admin
  ('22222222-2222-2222-2222-222222222222'), -- a non-admin player
  ('33333333-3333-3333-3333-333333333333'), -- pl_dp_purch (buys the purchased package)
  ('44444444-4444-4444-4444-444444444444'), -- pl_dp_req (requests the request-only package)
  ('55555555-5555-5555-5555-555555555555'); -- pl_dp_trial (buys the trial package)

insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('adm_dp', '11111111-1111-1111-1111-111111111111', 'AdmDp', now());

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_dp_a',     '+201900002001', 'DpA',     'men', 'beginner', now(), '22222222-2222-2222-2222-222222222222'),
  ('pl_dp_purch', '+201900002002', 'DpPurch', 'men', 'beginner', now(), '33333333-3333-3333-3333-333333333333'),
  ('pl_dp_req',   '+201900002003', 'DpReq',   'men', 'beginner', now(), '44444444-4444-4444-4444-444444444444'),
  ('pl_dp_trial', '+201900002004', 'DpTrial', 'men', 'beginner', now(), '55555555-5555-5555-5555-555555555555');

-- Five packages: unused (hard-delete candidate), purchased (retire via
-- purchases), request-only (retire via credit_requests, zero purchases),
-- an unused trial, and a PURCHASED trial (the guard blocks both the same way).
insert into public.packages (id, training_type, session_count, price, name, is_active) values
  ('pk_dp_unused',  'group',      4, 160000, 'DP unused',       true),
  ('pk_dp_purch',   'group',      8, 280000, 'DP purchased',    true),
  ('pk_dp_req',     'duo',        4, 200000, 'DP requested',    true),
  ('pk_dp_trial',   'trial',      1,  50000, 'DP trial unused', true),
  ('pk_dp_trialbuy','trial',      1,  50000, 'DP trial bought', true);

insert into public.purchases (id, player_id, package_id, status, amount, created_at, payment_method) values
  ('pu_dp_a', 'pl_dp_purch', 'pk_dp_purch',    'succeeded', 280000, now(), 'cash'),
  ('pu_dp_b', 'pl_dp_trial', 'pk_dp_trialbuy', 'succeeded',  50000, now(), 'cash');

insert into public.credit_requests (id, player_id, package_id, payment_method, status, created_at) values
  ('cr_dp_a', 'pl_dp_req', 'pk_dp_req', 'instapay', 'pending', now());

-- ════════════════════════════════════════════════════════════════════════════
-- Guards: not_admin, package_missing
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select is(public.delete_package('pk_dp_unused')->>'reason', 'not_admin', 'a non-admin player cannot delete a package');

select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select is(public.delete_package('pk_dp_nope')->>'reason', 'package_missing', 'an unknown package is rejected');

-- ════════════════════════════════════════════════════════════════════════════
-- Hard-delete: a genuinely unused package
-- ════════════════════════════════════════════════════════════════════════════
create temporary table tmp_dp_unused as select public.delete_package('pk_dp_unused') as v;
select is((select v->>'ok' from tmp_dp_unused), 'true', 'delete_package on an unused package succeeds');
select is((select v->>'action' from tmp_dp_unused), 'deleted', 'action is "deleted" — hard-deleted, not retired');
drop table tmp_dp_unused;
select is((select count(*)::int from public.packages where id = 'pk_dp_unused'), 0, 'the unused package row is genuinely GONE');

-- ════════════════════════════════════════════════════════════════════════════
-- Retire via PURCHASE history — row + purchase both intact
-- ════════════════════════════════════════════════════════════════════════════
create temporary table tmp_dp_purch as select public.delete_package('pk_dp_purch') as v;
select is((select v->>'ok' from tmp_dp_purch), 'true', 'delete_package on a purchased package succeeds');
select is((select v->>'action' from tmp_dp_purch), 'retired', 'action is "retired", not "deleted" — a purchase references it');
drop table tmp_dp_purch;
select is((select count(*)::int from public.packages where id = 'pk_dp_purch'), 1, 'the purchased package row still EXISTS — retired, not hard-deleted');
select isnt((select deleted_at from public.packages where id = 'pk_dp_purch'), null, 'deleted_at is set');
select is((select is_active from public.packages where id = 'pk_dp_purch'), false, 'is_active forced false — never mistaken for a mere Hidden toggle');
select is((select count(*)::int from public.purchases where id = 'pu_dp_a'), 1, 'the purchase row is completely untouched — money history is sacred');
select is((select package_id from public.purchases where id = 'pu_dp_a'), 'pk_dp_purch', 'the purchase still references the (retired) package by id — no orphan');

-- ════════════════════════════════════════════════════════════════════════════
-- Retire via CREDIT_REQUEST-only history (ZERO purchases) — the crux of the
-- catch-fallback decision: a naive "count(*) from purchases = 0 → hard-delete"
-- check would have wrongly tried to hard-delete this one.
-- ════════════════════════════════════════════════════════════════════════════
select is((select count(*)::int from public.purchases where package_id = 'pk_dp_req'), 0, 'precondition: pk_dp_req has ZERO purchases');
create temporary table tmp_dp_req as select public.delete_package('pk_dp_req') as v;
select is((select v->>'ok' from tmp_dp_req), 'true', 'delete_package on a request-only (never purchased) package succeeds');
select is((select v->>'action' from tmp_dp_req), 'retired',
  'action is "retired" even with ZERO purchases — a pending credit_request alone is enough; a purchases-only count would have wrongly hard-deleted this');
drop table tmp_dp_req;
select is((select count(*)::int from public.packages where id = 'pk_dp_req'), 1, 'the request-only package row still EXISTS');
select is((select count(*)::int from public.credit_requests where id = 'cr_dp_a'), 1, 'the pending credit_request is completely untouched');
select is((select package_id from public.credit_requests where id = 'cr_dp_a'), 'pk_dp_req', 'the credit_request still references the (retired) package by id — no orphan');

-- ════════════════════════════════════════════════════════════════════════════
-- The trial package: blocked outright, unused or not — never auto-retired
-- ════════════════════════════════════════════════════════════════════════════
select is(public.delete_package('pk_dp_trial')->>'ok', 'false', 'the (unused) trial package cannot be deleted');
select is(public.delete_package('pk_dp_trial')->>'reason', 'trial_package_protected', 'reason is trial_package_protected');
select is((select is_active from public.packages where id = 'pk_dp_trial'), true, 'the unused trial package is completely untouched — still active');
select is((select deleted_at from public.packages where id = 'pk_dp_trial'), null, 'the unused trial package''s deleted_at is still null');

select is(public.delete_package('pk_dp_trialbuy')->>'reason', 'trial_package_protected',
  'a PURCHASED trial package is blocked the SAME way — history doesn''t change the trial guard''s answer');
select is((select count(*)::int from public.purchases where id = 'pu_dp_b'), 1, 'the trial purchase is untouched (the guard never even reaches the delete/retire branch)');

-- ════════════════════════════════════════════════════════════════════════════
-- Idempotency — a second call on an already-retired package is a clean no-op
-- ════════════════════════════════════════════════════════════════════════════
select is(public.delete_package('pk_dp_purch')->>'action', 'already_deleted', 'a second call on the retired package reports already_deleted');
select is(public.delete_package('pk_dp_purch')->>'ok', 'true', 'the idempotent no-op is still ok:true, not an error');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- The money RPCs reject a deleted/retired package cleanly — no purchase can
-- ever be recorded against one, and a hard-deleted id never crashes either
-- RPC (the new foreign_key_violation guard's non-raced counterpart: the
-- plain "package missing" read already catches this case before any insert
-- is attempted in the NON-concurrent path exercised here).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select is(public.request_credits('pk_dp_purch', 'instapay')->>'reason', 'package_inactive',
  'request_credits rejects a RETIRED package as package_inactive (retire always forces is_active=false)');
select is(public.request_credits('pk_dp_unused', 'instapay')->>'reason', 'package_missing',
  'request_credits rejects a HARD-DELETED package id as package_missing, cleanly (no crash)');

select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select is(public.record_cash_purchase('pl_dp_a', 'pk_dp_purch', 5000)->>'reason', 'package_inactive',
  'record_cash_purchase rejects a RETIRED package as package_inactive');
select is(public.record_cash_purchase('pl_dp_a', 'pk_dp_unused', 5000)->>'reason', 'package_missing',
  'record_cash_purchase rejects a HARD-DELETED package id as package_missing, cleanly (no crash)');
reset role;

select is((select count(*)::int from public.purchases where package_id in ('pk_dp_purch', 'pk_dp_req', 'pk_dp_unused') and id not in ('pu_dp_a')),
  0, 'no NEW purchase was ever recorded against a retired or deleted package');

select * from finish();
rollback;
