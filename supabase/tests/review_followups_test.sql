-- ============================================================================
-- 066 — the Session 4 review follow-ups, asserted as real client roles.
--
-- Covers the two fixes that are not already pinned in
-- location_locked_credits_test.sql (which grew the request_credits behaviour
-- assertions): tpa.location_name's NULL-safety, and the purchases policy that
-- stops a player PAYING for a second trial.
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(15);

insert into auth.users (id) values
  ('0f0f0f01-0000-0000-0000-0000000f0f01'),   -- admin
  ('0f0f0f02-0000-0000-0000-0000000f0f02');   -- player

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_rf_adm', '+201900660001', 'Admin',  'men', 'beginner', now(), '0f0f0f01-0000-0000-0000-0000000f0f01'),
  ('pl_rf_p1',  '+201900660002', 'Player', 'men', 'beginner', now(), '0f0f0f02-0000-0000-0000-0000000f0f02');
insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('ad_rf', '0f0f0f01-0000-0000-0000-0000000f0f01', 'Admin', now());
insert into public.coaches (id, name, bio, is_active) values ('co_rf', 'Coach', 'b', true);

insert into public.locations (id, name, address, maps_url, hours_text, sort_order, is_active, is_default) values
  ('loc_rf_b', 'QA Branch', 'x', 'https://a.b', 'h', 9, true, false);

insert into public.packages (id, training_type, session_count, price, name, is_active, location_id) values
  ('pk_rf_t_def', 'trial', 1,    5000, 'Trial Oro',  true, 'loc_oro_plaza'),
  ('pk_rf_t_b',   'trial', 1,    5000, 'Trial QA',   true, 'loc_rf_b'),
  ('pk_rf_grp',   'group', 4,  100000, 'Oro 4-pack', true, 'loc_oro_plaza');

-- ════════════════════════════════════════════════════════════════════════════
-- tpa.location_name is NULL-safe
-- ════════════════════════════════════════════════════════════════════════════
select is(tpa.location_name('loc_oro_plaza'), 'Oro Plaza Hotel',
  'a real branch still resolves to its own name');
select is(tpa.location_name('loc_does_not_exist'), 'the academy',
  'a MISSING branch reads as a name, never NULL');
select isnt(tpa.location_name(null), null,
  'even a null id cannot produce a null name');

-- The property that matters is not the string — it is that no notification body
-- can be made NULL by it. Proven by shadowing the lookup so it always misses,
-- then booking for real: the credit is already decremented by the time the
-- notifications are written, so a NULL body would abort a paid-for booking.
insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, status, gender, level, location_id) values
  ('sl_rf', 'co_rf', now() + interval '5 days', now() + interval '5 days 1 hour', 'group', 1, 'published', 'men', 'beginner', 'loc_oro_plaza');
insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at, note, location_id) values
  ('cb_rf', 'pl_rf_p1', 'admin_grant', null, 'group', 2, 2, now() + interval '60 days', now(), 'seed', 'loc_oro_plaza');

create or replace function tpa.location_name(p_location_id text) returns text
  language sql stable security definer set search_path = '' as
  $$ select coalesce((select name from public.locations where id = 'never_matches'), 'the academy') $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0f0f0f02-0000-0000-0000-0000000f0f02"}', true);
select is(public.book_slot('sl_rf', null)->>'ok', 'true',
  'book_slot still succeeds when the branch lookup misses entirely');
reset role;
select is((select count(*)::int from public.notifications where body is null), 0,
  'and not one notification body is NULL');
select isnt((select count(*)::int from public.notifications), 0,
  'notifications were actually written (the assertion above is not vacuous)');

-- ════════════════════════════════════════════════════════════════════════════
-- a second trial cannot be PAID FOR  (AS THE PLAYER)
-- ════════════════════════════════════════════════════════════════════════════
-- Before 066 the mint was the only guard: the player reached Paymob, paid, and
-- settle_purchase then raised 23505 on
-- credit_batches_one_trial_purchase_per_player. Money taken, nothing minted.
select is(tpa.trial_used('pl_rf_p1'), false, 'precondition: the trial is unused');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0f0f0f02-0000-0000-0000-0000000f0f02"}', true);
select set_config('request.headers', '{"x-tpa-client":"mobile/1.4.0"}', true);
select lives_ok(
  $$ insert into public.purchases (id, player_id, package_id, status, amount, created_at, payment_method, paid)
     values ('pu_rf_1', 'pl_rf_p1', 'pk_rf_t_def', 'pending', 5000, now(), 'paymob', false) $$,
  'the FIRST trial checkout opens normally');
reset role;

select is(public.settle_purchase('pu_rf_1', 'tx_rf_1')->>'ok', 'true',
  'the gateway settles it and the trial is minted');
select is((select source from public.credit_batches where player_id = 'pl_rf_p1' and training_type = 'trial'),
  'purchase', 'every paid route mints source=purchase — that is what the once-ever index keys on');
select is(tpa.trial_used('pl_rf_p1'), true, 'the trial is now used');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0f0f0f02-0000-0000-0000-0000000f0f02"}', true);
select set_config('request.headers', '{"x-tpa-client":"mobile/1.4.0"}', true);
select throws_ok(
  $$ insert into public.purchases (id, player_id, package_id, status, amount, created_at, payment_method, paid)
     values ('pu_rf_2', 'pl_rf_p1', 'pk_rf_t_b', 'pending', 5000, now(), 'paymob', false) $$,
  '42501', null,
  'a SECOND trial checkout at the other branch is refused BEFORE any money moves');

-- Legacy safety: the 1.2/1.3 shape is a non-trial package, no header, no
-- location_id column. The new conjunct must be invisible to it.
select set_config('request.headers', '{}', true);
select lives_ok(
  $$ insert into public.purchases (id, player_id, package_id, status, amount, created_at, payment_method, paid)
     values ('pu_rf_3', 'pl_rf_p1', 'pk_rf_grp', 'pending', 100000, now(), 'paymob', false) $$,
  'an ordinary 1.2/1.3 non-trial checkout is untouched');
reset role;

-- The admin comp stays open ON PURPOSE: grant_credits writes source=admin_grant,
-- which is outside both this policy and the once-per-player index.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0f0f0f01-0000-0000-0000-0000000f0f01"}', true);
select is(public.grant_credits('pl_rf_p1', 'trial', 1, 'comp', 'loc_rf_b')->>'ok', 'true',
  'an admin can still comp a trial after the paid one is used');
reset role;

-- The grant is load-bearing: a policy resolves tpa.* as the table owner but
-- still checks EXECUTE as the caller, so revoking this breaks every checkout.
select ok(
  has_function_privilege('authenticated', 'tpa.trial_purchase_blocked(text)', 'EXECUTE'),
  'authenticated keeps EXECUTE on the policy helper — without it, ALL purchases fail 42501');

select * from finish();
rollback;
