-- ============================================================================
-- A5 — trial is a once-per-player purchasable package; no signup grant (pgTAP).
--
-- Proves: complete_signup mints ZERO credits and stores trained_before; trial is sellable
-- through the RPCs; a player gets at most ONE trial ever (the two partial unique indexes fire,
-- and request_credits / approve / record_cash return a clean trial_already_used); trial_eligible
-- tracks it (pending counts as used); and a historical signup_grant batch still validates.
-- Run with:  supabase test db
-- ============================================================================
begin;
select plan(18);

-- ── seed as postgres ─────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'admin@thepadelacademy.eg'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a@players.eg'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b@players.eg'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'c@players.eg'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'd@players.eg'),
  ('99999999-9999-9999-9999-999999999999', 'g@players.eg');   -- G: complete_signup (no player yet)

insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('adm_1', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'Adm', now());

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_A', '+201000000001', 'Ali', 'men', 'beginner', now(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('pl_B', '+201000000002', 'Bea', 'men', 'beginner', now(), 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('pl_C', '+201000000003', 'Cy',  'men', 'beginner', now(), 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('pl_D', '+201000000004', 'Dia', 'men', 'beginner', now(), 'dddddddd-dddd-dddd-dddd-dddddddddddd');

insert into public.packages (id, training_type, session_count, price, name, is_active) values
  ('pk_trial', 'trial', 1, 50000,  'Trial session', true),
  ('pk_grp',   'group', 8, 280000, '8-pack',         true);

-- ── historical signup_grant batch still validates (source/CHECK/index kept) ──
select lives_ok(
  $$ insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at, note)
       values ('cb_hist', 'pl_A', 'signup_grant', null, 'trial', 2, 2, now()+interval '30 day', now(), null) $$,
  'a historical signup_grant batch still inserts (source/CHECK/index kept for history)');
delete from public.credit_batches where id = 'cb_hist';   -- keep pl_A clean for the flow below

-- ── the two once-per-player trial indexes fire ──────────────────────────────
-- Index B: one trial PURCHASE batch per player. Seed D one, a second must fail.
insert into public.purchases (id, player_id, package_id, status, amount, created_at, payment_method) values
  ('pu_d1', 'pl_D', 'pk_trial', 'succeeded', 50000, now(), 'cash'),
  ('pu_d2', 'pl_D', 'pk_trial', 'succeeded', 50000, now(), 'cash');
insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at, note)
  values ('cb_d1', 'pl_D', 'purchase', 'pu_d1', 'trial', 1, 1, now()+interval '30 day', now(), null);
select throws_ok(
  $$ insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at, note)
       values ('cb_d2', 'pl_D', 'purchase', 'pu_d2', 'trial', 1, 1, now()+interval '30 day', now(), null) $$,
  '23505', null, 'index B: a SECOND trial-purchase batch for a player is rejected');

-- Index A: at most one LIVE trial request. Seed D an APPROVED trial request; a PENDING one
-- must fail (proving the index covers pending alongside approved, not just two-pending).
insert into public.credit_requests (id, player_id, package_id, payment_method, status, created_at, is_trial, resolved_at, resolved_by, purchase_id)
  values ('cr_d1', 'pl_D', 'pk_trial', 'cash', 'approved', now(), true, now(), 'adm_1', 'pu_d1');
select throws_ok(
  $$ insert into public.credit_requests (id, player_id, package_id, payment_method, status, created_at, is_trial)
       values ('cr_d2', 'pl_D', 'pk_trial', 'instapay', 'pending', now(), true) $$,
  '23505', null, 'index A: a pending trial request is rejected while an approved one exists');

-- ── complete_signup: zero credits + trained_before stored (Tasks 1, 4) ──────
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}', true);
select is(public.complete_signup('Gina','ladies','beginner',null,true)->>'ok', 'true', 'complete_signup(G, trained_before=true) → ok');
select is((select trained_before from public.players where auth_user_id = '99999999-9999-9999-9999-999999999999'),
  true, 'trained_before is stored on the player (self-reported)');
select is((select count(*)::int from public.credit_batches c join public.players p on p.id=c.player_id
           where p.auth_user_id = '99999999-9999-9999-9999-999999999999'),
  0, 'A5: no credits minted at signup');

-- ── the trial buy flow, as player A ─────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
select is(public.trial_eligible(), true, 'a fresh player is trial-eligible');
select is(public.request_credits('pk_trial','instapay',null)->>'ok', 'true', 'trial is SELLABLE now — request_credits(trial) ok');
select is(public.trial_eligible(), false, 'a PENDING trial request makes the player ineligible (used)');

-- admin approves A's trial → 1 trial credit minted (real revenue)
select set_config('request.jwt.claims', '{"sub":"ffffffff-ffff-ffff-ffff-ffffffffffff","role":"authenticated"}', true);
select is(public.approve_credit_request((select id from public.credit_requests where player_id='pl_A'))->>'ok', 'true',
  'admin approves the trial request');
select is((select source||'/'||training_type||'/'||quantity_total::text from public.credit_batches where player_id='pl_A'),
  'purchase/trial/1', 'the minted batch is a purchase-backed trial credit');

-- back as A: no longer eligible; a second trial → trial_already_used; a non-trial is fine
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
select is(public.trial_eligible(), false, 'after buying, the player is no longer trial-eligible');
select is(public.request_credits('pk_trial','instapay',null)->>'reason', 'trial_already_used',
  'a SECOND trial request → trial_already_used (clean reason, not a crash)');
select is(public.request_credits('pk_grp','instapay',null)->>'ok', 'true', 'a non-trial request is unaffected');

-- ── record_cash_purchase: trial sellable + once-per-player, as admin ────────
select set_config('request.jwt.claims', '{"sub":"ffffffff-ffff-ffff-ffff-ffffffffffff","role":"authenticated"}', true);
select is(public.record_cash_purchase('pl_C','pk_trial',50000)->>'ok', 'true', 'record_cash_purchase(trial) ok — trial is sellable via cash too');
select is(public.record_cash_purchase('pl_C','pk_trial',50000)->>'reason', 'trial_already_used', 'a second cash trial → trial_already_used');

-- ── approve re-check: a trial purchase already exists (race / cash bypass) ───
-- D already has a trial batch (cb_d1) and a pending trial request would be blocked by index A,
-- so seed the pending directly bypassing it isn't possible; instead reuse cr_d1 (approved) —
-- re-approving is idempotent, so verify the re-check on a fresh PENDING request for a player
-- who ALREADY holds a trial batch: give C (who just cash-bought a trial) a pending trial request
-- inserted as postgres, then approve → trial_already_used, minting nothing.
reset role;
insert into public.credit_requests (id, player_id, package_id, payment_method, status, created_at, is_trial)
  values ('cr_c_race', 'pl_C', 'pk_trial', 'instapay', 'pending', now(), true)
  on conflict do nothing;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ffffffff-ffff-ffff-ffff-ffffffffffff","role":"authenticated"}', true);
select is(public.approve_credit_request('cr_c_race')->>'reason', 'trial_already_used',
  'approve RE-CHECKS: a trial request for a player who already has a trial → trial_already_used');
select is((select count(*)::int from public.credit_batches where player_id='pl_C' and training_type='trial'),
  1, '…and mints nothing (still exactly one trial batch for C)');

reset role;
select * from finish();
rollback;
