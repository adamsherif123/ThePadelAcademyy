-- ============================================================================
-- 067 — credit transfer between branches, and the trial settle race.
-- Every client-triggered path runs as the real role.
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(41);

insert into auth.users (id) values
  ('0a7a7a01-0000-0000-0000-0000000a7a01'),   -- admin
  ('0a7a7a02-0000-0000-0000-0000000a7a02'),   -- player
  ('0a7a7a03-0000-0000-0000-0000000a7a03');   -- owner

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id, is_owner) values
  ('pl_ct_adm', '+201900670001', 'Admin',  'men', 'beginner', now(), '0a7a7a01-0000-0000-0000-0000000a7a01', false),
  ('pl_ct_p1',  '+201900670002', 'Farida', 'men', 'beginner', now(), '0a7a7a02-0000-0000-0000-0000000a7a02', false),
  ('pl_ct_own', '+201900670003', 'Owner',  'men', 'beginner', now(), '0a7a7a03-0000-0000-0000-0000000a7a03', true);
insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('ad_ct', '0a7a7a01-0000-0000-0000-0000000a7a01', 'Admin', now());
insert into public.coaches (id, name, bio, is_active) values ('co_ct', 'Coach', 'b', true);

insert into public.locations (id, name, address, maps_url, hours_text, sort_order, is_active, is_default) values
  ('loc_ct_b',    'QA Branch', 'x', 'https://a.b', 'h', 20, true,  false),
  ('loc_ct_shut', 'Closed',    'x', 'https://a.b', 'h', 21, false, false);

insert into public.packages (id, training_type, session_count, price, name, is_active, location_id) values
  ('pk_ct_t_def', 'trial', 1, 5000, 'Trial Oro', true, 'loc_oro_plaza'),
  ('pk_ct_t_b',   'trial', 1, 5000, 'Trial QA',  true, 'loc_ct_b');

insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, status, gender, level, location_id) values
  ('sl_ct_b', 'co_ct', now() + interval '4 days', now() + interval '4 days 1 hour', 'group', 4, 'published', 'men', 'beginner', 'loc_ct_b');

insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at, note, location_id) values
  ('cb_ct',     'pl_ct_p1', 'admin_grant', null, 'group', 6, 5, now() + interval '40 days', now(), 'seed', 'loc_oro_plaza'),
  ('cb_ct_exp', 'pl_ct_p1', 'admin_grant', null, 'group', 2, 2, now() - interval '1 day',   now(), 'old',  'loc_oro_plaza');

-- ════════════════════════════════════════════════════════════════════════════
-- Shape and grants
-- ════════════════════════════════════════════════════════════════════════════
select has_column('public', 'credit_batches', 'transferred_from', 'credit_batches.transferred_from exists');
select col_is_null('public', 'credit_batches', 'transferred_from', 'it is nullable — only a transfer sets it');
select ok(
  has_table_privilege('authenticated', 'public.credit_batches', 'SELECT'),
  'the SELECT grant is TABLE-level, so transferred_from needs no column grant of its own');
select ok(
  not has_table_privilege('authenticated', 'public.credit_batches', 'INSERT')
  and not has_table_privilege('authenticated', 'public.credit_batches', 'UPDATE'),
  'and no client holds INSERT/UPDATE — every write still goes through a definer RPC');

-- ════════════════════════════════════════════════════════════════════════════
-- Refusals  (AS THE REAL ROLE)
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0a7a7a02-0000-0000-0000-0000000a7a02"}', true);
select is(public.transfer_credit_batch('cb_ct', 'loc_ct_b', 1, 'nice try')->>'reason', 'not_admin',
  'a PLAYER cannot move their own credits between branches');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0a7a7a01-0000-0000-0000-0000000a7a01"}', true);
select is(public.transfer_credit_batch('cb_ct', 'loc_ct_b', 1, '   ')->>'reason', 'reason_required',
  'a blank note is refused — a branch move without a stated reason is a mistake');
select is(public.transfer_credit_batch('cb_ct', 'loc_ct_b', 0, 'n')->>'reason', 'quantity_below_one',
  'zero is not a transfer');
select is(public.transfer_credit_batch('cb_nope', 'loc_ct_b', 1, 'n')->>'reason', 'batch_missing',
  'a missing batch');
select is(public.transfer_credit_batch('cb_ct_exp', 'loc_ct_b', 1, 'n')->>'reason', 'expired',
  'an EXPIRED batch cannot be moved — a transfer must never resurrect dead credits');
select is(public.transfer_credit_batch('cb_ct', 'loc_oro_plaza', 1, 'n')->>'reason', 'same_location',
  'moving to the branch it is already at');
select is(public.transfer_credit_batch('cb_ct', 'loc_nope', 1, 'n')->>'reason', 'location_missing',
  'a branch that does not exist');
select is(public.transfer_credit_batch('cb_ct', 'loc_ct_shut', 1, 'n')->>'reason', 'location_inactive',
  'a CLOSED branch — credits nobody could spend');
select is(public.transfer_credit_batch('cb_ct', 'loc_ct_b', 99, 'n')->>'reason', 'quantity_above_remaining',
  'more than remains');

-- ════════════════════════════════════════════════════════════════════════════
-- The move itself
-- ════════════════════════════════════════════════════════════════════════════
select is(public.transfer_credit_batch('cb_ct', 'loc_ct_b', 3, 'goodwill: court closed')->>'ok', 'true',
  'an admin moves 3 of the 5 remaining to the QA branch');
reset role;

select is((select quantity_remaining from public.credit_batches where id = 'cb_ct'), 2,
  'the source batch is decremented');
select is((select quantity_total from public.credit_batches where id = 'cb_ct'), 6,
  'and its TOTAL is untouched — the history of what was granted does not change');
select is((select location_id from public.credit_batches where id = 'cb_ct'), 'loc_oro_plaza',
  'the source batch keeps its own branch — a transfer never edits it');
select is((select count(*)::int from public.credit_batches where transferred_from = 'cb_ct'), 1,
  'exactly one child batch');
select is((select source from public.credit_batches where transferred_from = 'cb_ct'), 'transfer',
  'the child is source=transfer');
select is((select location_id from public.credit_batches where transferred_from = 'cb_ct'), 'loc_ct_b',
  'at the target branch');
select is((select quantity_total from public.credit_batches where transferred_from = 'cb_ct'), 3,
  'its total is what was moved, so "how many moved" stays legible after some are spent');
select is(
  (select expires_at from public.credit_batches where transferred_from = 'cb_ct'),
  (select expires_at from public.credit_batches where id = 'cb_ct'),
  'EXPIRY IS PRESERVED — a transfer is a move, never a renewal');
select is((select training_type from public.credit_batches where transferred_from = 'cb_ct'), 'group',
  'and the training type carries over');

-- Conservation: 5 remaining before, 5 remaining after, split across the pair.
select is(
  (select sum(quantity_remaining)::int from public.credit_batches
    where player_id = 'pl_ct_p1' and id <> 'cb_ct_exp'),
  5, 'CONSERVATION: the player has exactly as many credits as before, in two places');

-- 068: credits_granted, not a new type — it is the only wallet-icon,
-- wallet-deep-linking type the un-updatable 1.2/1.3 builds already render
-- (notifications.tsx:21, deepLink.ts:23 in both).
select is((select count(*)::int from public.notifications
            where player_id = 'pl_ct_p1' and type = 'credits_granted'), 1,
  'the player is told, via a type the legacy apps render');
select is((select body from public.notifications where type = 'credits_granted'),
  '3 Group credits moved to QA Branch.', 'and the message still says MOVED, and names the branch');

-- ════════════════════════════════════════════════════════════════════════════
-- The moved credits actually work at the target branch
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0a7a7a02-0000-0000-0000-0000000a7a02"}', true);
select set_config('request.headers', '{"x-tpa-client":"mobile/1.4.0"}', true);
select is(public.book_slot('sl_ct_b', null)->>'ok', 'true',
  'the player books at the TARGET branch with the moved credits');
reset role;
select is((select b.location_id from public.bookings b where b.player_id = 'pl_ct_p1'), 'loc_ct_b',
  'and the booking carries that branch — the composite FKs to slot and batch both hold');
select is((select cb.source from public.bookings b join public.credit_batches cb on cb.id = b.credit_batch_id
            where b.player_id = 'pl_ct_p1'), 'transfer',
  'it spent the TRANSFERRED batch, not the source one at the other branch');

-- A refund goes back to the batch that was actually spent — the transferred one.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0a7a7a02-0000-0000-0000-0000000a7a02"}', true);
select is(public.cancel_booking((select id from public.bookings where player_id = 'pl_ct_p1'))->>'ok', 'true',
  'the player cancels in time');
reset role;
select is((select quantity_remaining from public.credit_batches where transferred_from = 'cb_ct'), 3,
  'and the refund lands on the TRANSFERRED batch, at its own branch');

-- ════════════════════════════════════════════════════════════════════════════
-- delete_credit_batch REFUSES a parent that credits were moved out of
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0a7a7a01-0000-0000-0000-0000000a7a01"}', true);
select is(public.delete_credit_batch('cb_ct')->>'reason', 'batch_has_transfers',
  'deleting the parent is refused by NAME, not by a generic batch_in_use');
-- The child above cannot be deleted here: the cancelled booking still references
-- it, so the pre-existing batch_has_bookings guard answers first (correctly — a
-- cancelled booking is still history). A clean pair proves the ordering instead.
select is(public.delete_credit_batch((select id from public.credit_batches where transferred_from = 'cb_ct'))->>'reason',
  'batch_has_bookings',
  'the child is held by its own (cancelled) booking — that guard still answers first');
reset role;

insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at, note, location_id) values
  ('cb_ct2', 'pl_ct_p1', 'admin_grant', null, 'duo', 2, 2, now() + interval '40 days', now(), 'clean', 'loc_oro_plaza');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0a7a7a01-0000-0000-0000-0000000a7a01"}', true);
select is(public.transfer_credit_batch('cb_ct2', 'loc_ct_b', 1, 'clean pair')->>'ok', 'true',
  'a second, booking-free pair');
select is(public.delete_credit_batch('cb_ct2')->>'reason', 'batch_has_transfers',
  'its parent is refused too');
select is(public.delete_credit_batch((select id from public.credit_batches where transferred_from = 'cb_ct2'))->>'ok', 'true',
  'the child deletes fine on its own — the owner just has to say so explicitly');
select is(public.delete_credit_batch('cb_ct2')->>'ok', 'true',
  'and with the child gone the parent deletes too');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- A transferred TRIAL does not make trial_used misfire
-- ════════════════════════════════════════════════════════════════════════════
-- The once-ever rule keys on source='purchase'. Moving a trial produces a
-- source='transfer' batch, which must neither count as a second trial nor
-- restore eligibility by moving the original's credits away.
insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at, note, location_id)
  values ('cb_ct_trial', 'pl_ct_p1', 'admin_grant', null, 'trial', 1, 1, now() + interval '30 days', now(), 'comp', 'loc_oro_plaza');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0a7a7a01-0000-0000-0000-0000000a7a01"}', true);
select is(public.transfer_credit_batch('cb_ct_trial', 'loc_ct_b', 1, 'moved trial')->>'ok', 'true',
  'a trial-type batch CAN be moved — the once-ever rule is about minting, not moving');
reset role;
select is(tpa.trial_used('pl_ct_p1'), false,
  'and moving it does not invent a used trial (source=transfer is not source=purchase)');

-- ════════════════════════════════════════════════════════════════════════════
-- PART B — the 066 trial-CHECKOUT policy, which 071 kept
-- ════════════════════════════════════════════════════════════════════════════
-- What used to be here was the trial SETTLE race: two trial checkouts opened
-- before either was paid, both settling, the second parked as refund-required.
-- 071 removed that feature with the Paymob integration it existed for, so what
-- remains to prove is the guard that still runs — 066's policy refusing a second
-- trial checkout once the player already holds a purchased trial.
insert into public.purchases (id, player_id, package_id, status, amount, created_at, payment_method, paid)
  values ('pu_ct_used', 'pl_ct_p1', 'pk_ct_t_def', 'succeeded', 5000, now(), 'cash', true);
insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at, location_id)
  values ('cb_ct_used', 'pl_ct_p1', 'purchase', 'pu_ct_used', 'trial', 1, 1, now() + interval '30 days', now(), 'loc_oro_plaza');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0a7a7a02-0000-0000-0000-0000000a7a02"}', true);
select set_config('request.headers', '{"x-tpa-client":"mobile/1.4.0"}', true);
select throws_ok(
  $$ insert into public.purchases (id, player_id, package_id, status, amount, created_at, payment_method, paid)
     values ('pu_ct_second', 'pl_ct_p1', 'pk_ct_t_b', 'pending', 5000, now(), 'paymob', false) $$,
  '42501', null,
  '066 still refuses a SECOND trial checkout once one is purchased — at another branch too');
reset role;
select is(tpa.trial_used('pl_ct_p1'), true,
  'and trial_used agrees, which is what that policy reads');

select * from finish();
rollback;
