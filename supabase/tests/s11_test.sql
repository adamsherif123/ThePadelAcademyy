-- ============================================================================
-- S11 — session confirmation proof (pgTAP, single session).
--
-- The fill stamps confirmed_at (inside the guarded increment); confirm_session's
-- guards + idempotency + admin-only; capacity edits never confirm; and THE property
-- that makes this recorded-not-derived state: a cancellation that drops a confirmed
-- slot below capacity does NOT un-confirm it.
--
-- Run with:  supabase test db
-- ============================================================================
begin;
select plan(23);

-- ── seed as postgres ─────────────────────────────────────────────────────────
insert into auth.users (id) values
  ('ffffffff-ffff-ffff-ffff-ffffffffffff'),   -- admin
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),    -- player A
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');    -- player B

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id, is_admin) values
  ('pl_adm', '+201000000000', 'Adm', 'men', 'beginner', now(), 'ffffffff-ffff-ffff-ffff-ffffffffffff', true),
  ('pl_a',   '+201000000001', 'Ali', 'men', 'beginner', now(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false),
  ('pl_b',   '+201000000002', 'Bea', 'men', 'beginner', now(), 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);

insert into public.coaches (id, name, bio, is_active) values ('co1', 'Coach', 'b', true);

insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at, note) values
  ('cb_a_grp', 'pl_a', 'admin_grant', null, 'group',      5, 5, now() + interval '30 day', now(), 'seed'),
  ('cb_a_ind', 'pl_a', 'admin_grant', null, 'individual', 5, 5, now() + interval '30 day', now(), 'seed'),
  ('cb_a_cnf', 'pl_a', 'admin_grant', null, 'group',      5, 4, now() + interval '30 day', now(), 'seed'),
  ('cb_b_grp', 'pl_b', 'admin_grant', null, 'group',      5, 5, now() + interval '30 day', now(), 'seed'),
  ('cb_b_duo', 'pl_b', 'admin_grant', null, 'duo',        5, 5, now() + interval '30 day', now(), 'seed');

-- Slots (all future unless noted). confirmed_at seeded null except sl_confirmed.
-- Distinct time windows per slot: the coach-overlap exclusion forbids one coach
-- holding two overlapping PUBLISHED slots.
insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status, confirmed_at) values
  ('sl_grp',      'co1', now()+interval '2 day',        now()+interval '2 day 1 hour',  'group',      4, 3, 'men', 'beginner', 'published', null),
  ('sl_ind',      'co1', now()+interval '2 day 2 hour', now()+interval '2 day 3 hour',  'individual', 1, 0, null, null,        'published', null),
  ('sl_duo',      'co1', now()+interval '2 day 4 hour', now()+interval '2 day 5 hour',  'duo',        2, 1, null, null,        'published', null),
  ('sl_pending',  'co1', now()+interval '3 day',        now()+interval '3 day 1 hour',  'group',      4, 1, 'men', 'beginner', 'published', null),
  ('sl_confirmed','co1', now()+interval '4 day',        now()+interval '4 day 1 hour',  'group',      4, 4, 'men', 'beginner', 'published', now()),
  ('sl_cxl',      'co1', now()+interval '5 day',        now()+interval '5 day 1 hour',  'trial',      4, 0, null, null,        'cancelled', null),
  ('sl_past',     'co1', now()-interval '2 hour',       now()-interval '1 hour',        'trial',      4, 0, null, null,        'published', null),
  ('sl_capedit',  'co1', now()+interval '6 day',        now()+interval '6 day 1 hour',  'group',      4, 3, 'men', 'beginner', 'published', null);

-- One real booking on the confirmed slot, so a cancel can drop it below capacity.
insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at) values
  ('bk_conf', 'sl_confirmed', 'pl_a', 'cb_a_cnf', 'booked', now());

-- ════════════════════════════════════════════════════════════════════════════
-- AS ADMIN
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"ffffffff-ffff-ffff-ffff-ffffffffffff","role":"authenticated"}';

-- FILL via admin_book_player stamps confirmed_at (duo 1/2 → 2/2)
select is(public.admin_book_player('sl_duo','pl_b',false)->>'ok', 'true', 'admin_book fills the duo → ok');
select isnt((select confirmed_at from public.session_slots where id='sl_duo'), null, 'filling the duo (2/2) STAMPED confirmed_at');

-- A booking that does NOT fill leaves it pending (group 1/4 → 2/4)
select is(public.admin_book_player('sl_pending','pl_b',false)->>'ok', 'true', 'admin_book on a not-full group → ok');
select is((select confirmed_at from public.session_slots where id='sl_pending'), null, 'a non-filling booking leaves confirmed_at null (pending)');

-- confirm_session (manual): pending → confirmed, idempotent, guards
select is(public.confirm_session('sl_pending')->>'ok', 'true', 'confirm_session(pending) → ok');
select is(public.confirm_session('sl_pending')->>'already_confirmed', 'true', 'confirm_session is idempotent — 2nd call already_confirmed');
create temp table _cnf as select confirmed_at c from public.session_slots where id='sl_pending';
select isnt((select c from _cnf), null, 'pending is now confirmed (confirmed_at set)');
select is(public.confirm_session('sl_pending')->>'ok', 'true', 'a 3rd confirm is still a no-op success');
select is((select confirmed_at from public.session_slots where id='sl_pending'), (select c from _cnf), 'idempotent confirm does NOT re-stamp (audit time preserved)');

select is(public.confirm_session('sl_cxl')->>'reason',  'slot_cancelled', 'confirm_session rejects a cancelled slot');
select is(public.confirm_session('sl_past')->>'reason', 'slot_in_past',   'confirm_session rejects a PAST slot (forward-looking only)');
select is(public.confirm_session('sl_nope')->>'reason', 'slot_missing',   'confirm_session rejects a missing slot');

-- Capacity edits never confirm — and confirmed_at is not a grantable column
update public.session_slots set capacity = 3 where id = 'sl_capedit';   -- granted column, 3/4 → 3/3 (full)
select is((select confirmed_at from public.session_slots where id='sl_capedit'), null, 'lowering capacity to full does NOT confirm — still pending');
select throws_ok(
  $$ update public.session_slots set confirmed_at = now() where id = 'sl_capedit' $$,
  '42501', null, 'an admin CANNOT set confirmed_at directly (no column grant) — only the RPC/fill can');

-- THE STICKY PROPERTY: a cancel that drops a confirmed slot below capacity does NOT un-confirm
select isnt((select confirmed_at from public.session_slots where id='sl_confirmed'), null, 'sl_confirmed starts confirmed (4/4)');
select is(public.remove_booking('bk_conf', true)->>'ok', 'true', 'remove_booking on the confirmed slot → ok');
select is((select booked_count from public.session_slots where id='sl_confirmed'), 3, 'the cancel dropped it to 3/4');
select isnt((select confirmed_at from public.session_slots where id='sl_confirmed'), null,
  'STICKY: 4/4→3/4 stays CONFIRMED — the cancel did not un-confirm it');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AS PLAYER A — book_slot's fill also stamps confirmed_at
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

select is(public.book_slot('sl_ind')->>'ok', 'true', 'player books the individual → ok');
select isnt((select confirmed_at from public.session_slots where id='sl_ind'), null,
  'an individual (cap 1) confirms on the FIRST booking');
select is(public.book_slot('sl_grp')->>'ok', 'true', 'player books the group that was 3/4 → ok');
select isnt((select confirmed_at from public.session_slots where id='sl_grp'), null,
  'book_slot filling the group (4/4) STAMPED confirmed_at');

-- a non-admin cannot confirm
select is(public.confirm_session('sl_grp')->>'reason', 'not_admin', 'a player → confirm_session denied (not_admin)');

reset role;

select * from finish();
rollback;
