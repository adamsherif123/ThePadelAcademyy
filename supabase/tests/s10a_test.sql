-- ============================================================================
-- S10a — mark_attendance + coach-photos Storage policies (pgTAP, single session).
--
-- Attendance: every transition (booked ⇄ attended ⇄ no_show), 'cancelled'
-- unreachable as a target, an already-cancelled booking rejected, a future session
-- rejected, a non-admin denied, and the two invariants the RPC must never break —
-- booked_count doesn't move, no credit moves.
-- Storage: the coach-photos bucket config + who can write vs read, tested the same
-- way as RLS (role + request.jwt.claims).
--
-- Run with:  supabase test db
-- ============================================================================
begin;
select plan(37);

-- ── seed as postgres (RLS bypassed; constraints + FKs still apply) ───────────
insert into auth.users (id) values
  ('ffffffff-ffff-ffff-ffff-ffffffffffff'),   -- admin
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');    -- player A

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_a',   '+201000000001', 'Ali', 'men', 'beginner', now(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('pl_b',   '+201000000002', 'Bea', 'men', 'beginner', now(), null),
  ('pl_c',   '+201000000003', 'Cy',  'men', 'beginner', now(), null);

-- A1: the admin is NOT a player — an auth user linked to an admins row, no player row.
insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('adm_test', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'Adm', now());

insert into public.coaches (id, name, bio, is_active) values ('co1', 'Coach', 'b', true);

insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at, note) values
  ('cb_a', 'pl_a', 'signup_grant', null, 'trial', 2, 1, now() + interval '30 day', now(), null),
  ('cb_b', 'pl_b', 'signup_grant', null, 'trial', 2, 1, now() + interval '30 day', now(), null),
  ('cb_c', 'pl_c', 'signup_grant', null, 'trial', 2, 1, now() + interval '30 day', now(), null);

-- A PAST slot (started 2h ago), 2 booked → booked_count 2. A FUTURE slot with one
-- booking. A PAST slot whose only booking is already cancelled.
insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status) values
  ('sl_past',   'co1', now() - interval '2 hour', now() - interval '1 hour',       'trial', 4, 2, null, null, 'published'),
  ('sl_future', 'co1', now() + interval '1 day',  now() + interval '1 day 1 hour', 'trial', 4, 1, null, null, 'published'),
  ('sl_pastc',  'co1', now() - interval '3 hour', now() - interval '2 hour',       'trial', 4, 0, null, null, 'published');

insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at, cancelled_at) values
  ('bk_p1', 'sl_past',   'pl_a', 'cb_a', 'booked',    now(), null),
  ('bk_p2', 'sl_past',   'pl_b', 'cb_b', 'booked',    now(), null),
  ('bk_f',  'sl_future', 'pl_a', 'cb_a', 'booked',    now(), null),
  ('bk_c',  'sl_pastc',  'pl_c', 'cb_c', 'cancelled', now(), now());

-- ════════════════════════════════════════════════════════════════════════════
-- AS ADMIN
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"ffffffff-ffff-ffff-ffff-ffffffffffff","role":"authenticated"}';

-- transitions: booked → attended → no_show → booked, each leaving occupancy + credit untouched
select is(public.mark_attendance('bk_p1', 'attended')->>'ok', 'true', 'mark attended → ok');
select is((select status from public.bookings where id = 'bk_p1'), 'attended', 'booking is now attended');
select is((select booked_count from public.session_slots where id = 'sl_past'), 2, 'booked_count unchanged after attended (past 2/2 stays 2/2)');
select is((select quantity_remaining from public.credit_batches where id = 'cb_a'), 1, 'no credit moved on attended');
select is(public.mark_attendance('bk_p1', 'no_show')->>'ok', 'true', 'attended → no_show → ok');
select is((select status from public.bookings where id = 'bk_p1'), 'no_show', 'booking is now no_show');
select is((select booked_count from public.session_slots where id = 'sl_past'), 2, 'booked_count unchanged after no_show');
select is(public.mark_attendance('bk_p1', 'booked')->>'ok', 'true', 'no_show → booked → ok (reversible, S4f)');
select is((select status from public.bookings where id = 'bk_p1'), 'booked', 'reverted to booked');
select is((select booked_count from public.session_slots where id = 'sl_past'), 2, 'booked_count unchanged after revert to booked');

-- idempotent
select is(public.mark_attendance('bk_p1', 'attended')->>'ok', 'true', 'mark attended (first)');
select is(public.mark_attendance('bk_p1', 'attended')->>'ok', 'true', 'mark attended twice = no-op success (idempotent)');
select is((select status from public.bookings where id = 'bk_p1'), 'attended', 'still attended after the double-mark');
select is((select quantity_remaining from public.credit_batches where id = 'cb_a'), 1, 'still no credit movement across every transition');

-- 'cancelled' is NOT an accepted target → unreachable through this RPC, ever
select is(public.mark_attendance('bk_p1', 'cancelled')->>'reason', 'invalid_status', 'cancelled is not an accepted target (unreachable)');
select is((select status from public.bookings where id = 'bk_p1'), 'attended', 'the rejected cancelled-mark did not change the booking');
select is((select booked_count from public.session_slots where id = 'sl_past'), 2, 'the rejected cancelled-mark did not touch booked_count');

-- an already-cancelled booking cannot be marked (no un-cancelling / no resurrection)
select is(public.mark_attendance('bk_c', 'attended')->>'reason', 'already_cancelled', 'a cancelled booking cannot be marked present');
select is((select status from public.bookings where id = 'bk_c'), 'cancelled', 'the cancelled booking stayed cancelled');

-- past sessions only → a future session is rejected
select is(public.mark_attendance('bk_f', 'attended')->>'reason', 'session_not_started', 'a future session cannot be marked');
select is((select status from public.bookings where id = 'bk_f'), 'booked', 'future booking unchanged');
select is((select booked_count from public.session_slots where id = 'sl_future'), 1, 'future slot booked_count unchanged');

-- misc guards
select is(public.mark_attendance('bk_nope', 'attended')->>'reason', 'booking_missing', 'unknown booking rejected');
select is(public.mark_attendance('bk_p1', 'present')->>'reason', 'invalid_status', 'a garbage status value is rejected');

-- the headline invariant, stated directly: booked_count == non-cancelled bookings
select is(
  (select booked_count from public.session_slots where id = 'sl_past'),
  (select count(*)::int from public.bookings where slot_id = 'sl_past' and status <> 'cancelled'),
  'booked_count == count(non-cancelled bookings) after all transitions');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AS PLAYER (non-admin) — authority is checked first
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

select is(public.mark_attendance('bk_p1', 'attended')->>'reason', 'not_admin', 'player → mark_attendance denied (not_admin)');
select is(public.mark_attendance('bk_p1', 'cancelled')->>'reason', 'not_admin', 'player denied BEFORE input validation (authority first)');
select is((select status from public.bookings where id = 'bk_p1'), 'attended', 'the denied player call changed nothing');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- STORAGE — coach-photos bucket config + policies
-- ════════════════════════════════════════════════════════════════════════════
-- config (as postgres)
select is((select public from storage.buckets where id = 'coach-photos'), true, 'coach-photos is a PUBLIC bucket');
select is((select file_size_limit from storage.buckets where id = 'coach-photos'), 5242880::bigint, 'coach-photos caps uploads at 5 MiB');
select is((select allowed_mime_types from storage.buckets where id = 'coach-photos'), array['image/jpeg','image/png','image/webp'], 'coach-photos allows only jpeg/png/webp');

-- an ADMIN can upload
set local role authenticated;
set local request.jwt.claims to '{"sub":"ffffffff-ffff-ffff-ffff-ffffffffffff","role":"authenticated"}';
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('coach-photos', 'coaches/co1.jpg') $$,
  'an admin can upload a coach photo');
select is((select count(*)::int from storage.objects where bucket_id = 'coach-photos' and name = 'coaches/co1.jpg'), 1, 'the uploaded object exists');
reset role;

-- a PLAYER cannot write, but CAN read
set local role authenticated;
set local request.jwt.claims to '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('coach-photos', 'coaches/hack.jpg') $$,
  '42501', null, 'a player CANNOT upload a coach photo (RLS 42501)');
select is((select count(*)::int from storage.objects where bucket_id = 'coach-photos' and name = 'coaches/co1.jpg'), 1, 'a player CAN read coach photos');
-- NOTE: delete/replace is admin-only via the "coach photos are deletable by admins"
-- policy, but it can't be exercised here — storage.protect_delete() blocks ALL direct
-- SQL deletes (forcing the Storage API), so the RLS delete path is only reachable
-- through the API, where the policy applies.
reset role;

-- ANON (public audience) can read, cannot write
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
select is((select count(*)::int from storage.objects where bucket_id = 'coach-photos' and name = 'coaches/co1.jpg'), 1, 'anon (the public audience) CAN read coach photos');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('coach-photos', 'coaches/anon.jpg') $$,
  '42501', null, 'anon CANNOT upload');
reset role;

select * from finish();
rollback;
