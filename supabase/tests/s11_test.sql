-- ============================================================================
-- S11.1 — session confirmation proof (pgTAP). DERIVED fill, STICKY manual.
--
-- The confirmed-ness rule (booked_count >= capacity OR manually_confirmed_at) lives
-- in @tpa/core and is tested in vitest. At the DB layer what matters is:
--   * book_slot / admin_book_player NO LONGER write the column (reverted to S7b) —
--     a filled session is confirmed by DERIVATION, its manually_confirmed_at NULL;
--   * confirm_session is the ONLY writer, and its write is STICKY (survives an
--     un-fill), idempotent, admin-only, and rejects a cancelled or past slot;
--   * capacity edits can't confirm (no UPDATE grant on the column).
--
-- Run with:  supabase test db
-- ============================================================================
begin;
select plan(23);

-- ── seed as postgres ─────────────────────────────────────────────────────────
insert into auth.users (id) values
  ('ffffffff-ffff-ffff-ffff-ffffffffffff'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

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

-- Distinct time windows (coach-overlap exclusion). sl_confirmed is MANUALLY confirmed.
insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status, manually_confirmed_at) values
  ('sl_grp',      'co1', now()+interval '2 day',        now()+interval '2 day 1 hour',  'group',      4, 3, 'men', 'beginner', 'published', null),
  ('sl_ind',      'co1', now()+interval '2 day 2 hour', now()+interval '2 day 3 hour',  'individual', 1, 0, null, null,        'published', null),
  ('sl_duo',      'co1', now()+interval '2 day 4 hour', now()+interval '2 day 5 hour',  'duo',        2, 1, null, null,        'published', null),
  ('sl_pending',  'co1', now()+interval '3 day',        now()+interval '3 day 1 hour',  'group',      4, 1, 'men', 'beginner', 'published', null),
  ('sl_confirmed','co1', now()+interval '4 day',        now()+interval '4 day 1 hour',  'group',      4, 4, 'men', 'beginner', 'published', now()),
  ('sl_cxl',      'co1', now()+interval '5 day',        now()+interval '5 day 1 hour',  'trial',      4, 0, null, null,        'cancelled', null),
  ('sl_past',     'co1', now()-interval '2 hour',       now()-interval '1 hour',        'trial',      4, 0, null, null,        'published', null),
  ('sl_capedit',  'co1', now()+interval '6 day',        now()+interval '6 day 1 hour',  'group',      4, 3, 'men', 'beginner', 'published', null);

insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at) values
  ('bk_conf', 'sl_confirmed', 'pl_a', 'cb_a_cnf', 'booked', now());

-- ════════════════════════════════════════════════════════════════════════════
-- AS ADMIN
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"ffffffff-ffff-ffff-ffff-ffffffffffff","role":"authenticated"}';

-- FILL via admin_book_player does NOT write the column (reverted to S7b) — the slot
-- is confirmed by DERIVATION (booked_count reaches capacity), not the timestamp.
select is(public.admin_book_player('sl_duo','pl_b',false)->>'ok', 'true', 'admin_book fills the duo → ok');
select is((select booked_count from public.session_slots where id='sl_duo'), 2, 'the duo is now full (2/2) — derived-confirmed');
select is((select manually_confirmed_at from public.session_slots where id='sl_duo'), null, 'admin_book did NOT write manually_confirmed_at (fill is derived)');

-- A non-fill also writes nothing
select is(public.admin_book_player('sl_pending','pl_b',false)->>'ok', 'true', 'admin_book on a not-full group → ok');
select is((select manually_confirmed_at from public.session_slots where id='sl_pending'), null, 'a non-filling booking writes no confirmation');

-- confirm_session (manual) — the ONLY writer. Idempotent, guards.
select is(public.confirm_session('sl_pending')->>'ok', 'true', 'confirm_session(pending) → ok');
select is(public.confirm_session('sl_pending')->>'already_confirmed', 'true', 'confirm_session is idempotent — 2nd call already_confirmed');
create temp table _cnf as select manually_confirmed_at c from public.session_slots where id='sl_pending';
select isnt((select c from _cnf), null, 'confirm_session set manually_confirmed_at');
select is(public.confirm_session('sl_pending')->>'ok', 'true', 'a 3rd confirm is still a no-op success');
select is((select manually_confirmed_at from public.session_slots where id='sl_pending'), (select c from _cnf), 'idempotent confirm does NOT re-stamp (audit time preserved)');

select is(public.confirm_session('sl_cxl')->>'reason',  'slot_cancelled', 'confirm_session rejects a cancelled slot');
select is(public.confirm_session('sl_past')->>'reason', 'slot_in_past',   'confirm_session rejects a PAST slot (forward-looking only)');
select is(public.confirm_session('sl_nope')->>'reason', 'slot_missing',   'confirm_session rejects a missing slot');

-- Capacity edits never confirm — the column has no UPDATE grant
update public.session_slots set capacity = 3 where id = 'sl_capedit';  -- granted column, 3/4 → 3/3
select is((select manually_confirmed_at from public.session_slots where id='sl_capedit'), null, 'lowering capacity does NOT write manual confirmation');
select throws_ok(
  $$ update public.session_slots set manually_confirmed_at = now() where id = 'sl_capedit' $$,
  '42501', null, 'an admin CANNOT set manually_confirmed_at directly (no column grant) — only confirm_session');

-- STICKY MANUAL: a cancel that drops a MANUALLY-confirmed slot below capacity keeps it confirmed
select isnt((select manually_confirmed_at from public.session_slots where id='sl_confirmed'), null, 'sl_confirmed is manually confirmed (4/4)');
select is(public.remove_booking('bk_conf', true)->>'ok', 'true', 'remove_booking on the confirmed slot → ok');
select is((select booked_count from public.session_slots where id='sl_confirmed'), 3, 'the cancel dropped it to 3/4 (no longer derived-confirmed)');
select isnt((select manually_confirmed_at from public.session_slots where id='sl_confirmed'), null,
  'STICKY MANUAL: 4/4→3/4 keeps manually_confirmed_at — the admin''s decision survives the un-fill');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AS PLAYER A — book_slot's fill writes NO confirmation column either
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

select is(public.book_slot('sl_ind')->>'ok', 'true', 'player books the individual → ok');
select is((select manually_confirmed_at from public.session_slots where id='sl_ind'), null,
  'book_slot filling a cap-1 slot writes NO manually_confirmed_at (confirmed by derivation)');
select is(public.book_slot('sl_grp')->>'ok', 'true', 'player books the group that was 3/4 → ok');
select is((select manually_confirmed_at from public.session_slots where id='sl_grp'), null,
  'book_slot filling the group (4/4) writes NO manually_confirmed_at (S7b body, unchanged)');

reset role;

select * from finish();
rollback;
