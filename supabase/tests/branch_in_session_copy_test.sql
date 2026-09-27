-- ============================================================================
-- 069 — every session notification names its BRANCH (pgTAP).
--
-- The whole fixture lives at a SECOND branch, never the default. That is the
-- point: a body that hardcoded "Oro Plaza Hotel", or resolved the default instead
-- of the slot's own row, would pass at the default branch and be wrong in the one
-- case the feature exists for. Here every expected string says "Sheikh Zayed
-- Club", and the default branch also exists and is NOT the answer.
--
-- Every client-triggered path runs as the real role: the player self-cancel under
-- the player's own JWT as `authenticated`, every admin path under an admin JWT as
-- `authenticated`. Only the cron-only reminder runs as postgres, which is what
-- actually calls it.
--
-- Two claims per emit: the body NAMES the branch, and the body IS NOT NULL. The
-- second is not paranoia — notifications.body is NOT NULL and `'x' || null` is
-- NULL in SQL, so a branch name that failed to resolve would abort the whole
-- money path it is attached to, not merely read badly.
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(35);

insert into auth.users (id) values
  ('08000001-0000-0000-0000-000000000001'),   -- admin
  ('08000002-0000-0000-0000-000000000002'),   -- the coach's login
  ('08000003-0000-0000-0000-000000000003'),   -- player A (acts)
  ('08000004-0000-0000-0000-000000000004'),   -- player B (stays booked, hears about it)
  ('08000005-0000-0000-0000-000000000005');   -- owner

insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('adm_s8', '08000001-0000-0000-0000-000000000001', 'Adm8', now());

-- The second branch. Everything below happens HERE.
insert into public.locations (id, name, address, maps_url, hours_text, sort_order, is_active, is_default)
values ('loc_s8_zayed', 'Sheikh Zayed Club', '7 Test St, Giza', 'https://maps.example/z', 'Daily', 50, true, false);

insert into public.coaches (id, name, bio, is_active) values ('co_s8', 'Tarek Fouad', 'b', true);

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id, coach_id) values
  ('pl_s8_coach', '+201908000002', 'Tarek Fouad', 'men', 'beginner', now(), '08000002-0000-0000-0000-000000000002', 'co_s8'),
  ('pl_s8_a',     '+201908000003', 'Amira Said',  'men', 'beginner', now(), '08000003-0000-0000-0000-000000000003', null),
  ('pl_s8_b',     '+201908000004', 'Bassem Nour', 'men', 'beginner', now(), '08000004-0000-0000-0000-000000000004', null),
  ('pl_s8_own',   '+201908000005', 'Owner Eight', 'men', 'beginner', now(), '08000005-0000-0000-0000-000000000005', null);
update public.players set is_owner = true where id = 'pl_s8_own';

insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at, location_id) values
  ('cb_s8_a', 'pl_s8_a', 'admin_grant', null, 'group', 9, 4, now()+interval '60 day', now(), 'loc_s8_zayed'),
  ('cb_s8_b', 'pl_s8_b', 'admin_grant', null, 'group', 9, 4, now()+interval '60 day', now(), 'loc_s8_zayed');

-- Capacity 2 everywhere a "reopen" is wanted: A + B fills it (confirmed), A
-- leaving drops it below capacity again, which is exactly session_reopened's gate.
insert into public.session_slots (id, location_id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status) values
  ('sl_s8_cancel',   'loc_s8_zayed', 'co_s8', now()+interval '3 day', now()+interval '3 day 1 hour', 'group', 2, 2, 'men', 'beginner', 'published'),
  ('sl_s8_remove',   'loc_s8_zayed', 'co_s8', now()+interval '4 day', now()+interval '4 day 1 hour', 'group', 2, 2, 'men', 'beginner', 'published'),
  ('sl_s8_session',  'loc_s8_zayed', 'co_s8', now()+interval '5 day', now()+interval '5 day 1 hour', 'group', 4, 1, 'men', 'beginner', 'published'),
  ('sl_s8_confirm',  'loc_s8_zayed', 'co_s8', now()+interval '6 day', now()+interval '6 day 1 hour', 'group', 4, 1, 'men', 'beginner', 'published'),
  ('sl_s8_resched',  'loc_s8_zayed', 'co_s8', now()+interval '7 day', now()+interval '7 day 1 hour', 'group', 4, 1, 'men', 'beginner', 'published'),
  ('sl_s8_adminadd', 'loc_s8_zayed', 'co_s8', now()+interval '8 day', now()+interval '8 day 1 hour', 'group', 2, 1, 'men', 'beginner', 'published'),
  ('sl_s8_remind',   'loc_s8_zayed', 'co_s8', now()+interval '30 minute', now()+interval '90 minute', 'group', 4, 1, 'men', 'beginner', 'published');

insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at, cancelled_at, location_id) values
  ('bk_s8_cancel_a', 'sl_s8_cancel',   'pl_s8_a', 'cb_s8_a', 'booked', now(), null, 'loc_s8_zayed'),
  ('bk_s8_cancel_b', 'sl_s8_cancel',   'pl_s8_b', 'cb_s8_b', 'booked', now(), null, 'loc_s8_zayed'),
  ('bk_s8_remove_a', 'sl_s8_remove',   'pl_s8_a', 'cb_s8_a', 'booked', now(), null, 'loc_s8_zayed'),
  ('bk_s8_remove_b', 'sl_s8_remove',   'pl_s8_b', 'cb_s8_b', 'booked', now(), null, 'loc_s8_zayed'),
  ('bk_s8_session',  'sl_s8_session',  'pl_s8_b', 'cb_s8_b', 'booked', now(), null, 'loc_s8_zayed'),
  ('bk_s8_confirm',  'sl_s8_confirm',  'pl_s8_b', 'cb_s8_b', 'booked', now(), null, 'loc_s8_zayed'),
  ('bk_s8_resched',  'sl_s8_resched',  'pl_s8_b', 'cb_s8_b', 'booked', now(), null, 'loc_s8_zayed'),
  ('bk_s8_adminadd', 'sl_s8_adminadd', 'pl_s8_b', 'cb_s8_b', 'booked', now(), null, 'loc_s8_zayed'),
  ('bk_s8_remind',   'sl_s8_remind',   'pl_s8_b', 'cb_s8_b', 'booked', now(), null, 'loc_s8_zayed');

-- ════════════════════════════════════════════════════════════════════════════
-- 0 — the helper the whole migration leans on
-- ════════════════════════════════════════════════════════════════════════════
select is(tpa.location_name('loc_s8_zayed'), 'Sheikh Zayed Club', 'location_name resolves the second branch');
select is(tpa.location_name(null), 'the academy', 'location_name(null) is the safe word, not NULL');
select is(tpa.location_name('loc_gone'), 'the academy', 'location_name of a missing row is the safe word');
select isnt(('x ' || tpa.location_name(null))::text, null, 'so a concatenated body can never become NULL');

-- ════════════════════════════════════════════════════════════════════════════
-- 1 — cancel_booking (MONEY PATH), as the PLAYER, under their own JWT
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"08000003-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(public.cancel_booking('bk_s8_cancel_a')->>'ok', 'true', 'cancel_booking still succeeds (069 is additive)');
reset role;

select is(
  (select body from public.notifications where type = 'session_reopened' and slot_id = 'sl_s8_cancel'),
  'A player left your Group session on '
    || (select tpa.cairo_when(starts_at) from public.session_slots where id = 'sl_s8_cancel')
    || ' at Sheikh Zayed Club — it''s pending again until it fills.',
  'cancel_booking → session_reopened names the branch');
select is(
  (select player_id from public.notifications where type = 'session_reopened' and slot_id = 'sl_s8_cancel'),
  'pl_s8_b', 'and it goes to the player who stayed, not the one who left');
select is(
  (select body from public.notifications where type = 'owner_cancellation'),
  'Amira Said cancelled '
    || (select tpa.cairo_time_short(starts_at) from public.session_slots where id = 'sl_s8_cancel')
    || ' slot with Tarek at Sheikh Zayed Club',
  'cancel_booking → owner_cancellation names the branch');
select is(
  (select slot_id from public.notifications where type = 'owner_cancellation'),
  null, 'the owner ping still carries NO slot id (the legacy deep-link rule holds)');

-- ════════════════════════════════════════════════════════════════════════════
-- 2 — remove_booking (MONEY PATH), as the ADMIN
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"08000001-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.remove_booking('bk_s8_remove_a', true)->>'ok', 'true', 'remove_booking still succeeds');
reset role;

select is(
  (select body from public.notifications where type = 'session_reopened' and slot_id = 'sl_s8_remove'),
  'A player left your Group session on '
    || (select tpa.cairo_when(starts_at) from public.session_slots where id = 'sl_s8_remove')
    || ' at Sheikh Zayed Club — it''s pending again until it fills.',
  'remove_booking → session_reopened names the branch');
select is(
  (select body from public.notifications where type = 'removed_from_session'),
  'You were removed from your Group session on '
    || (select tpa.cairo_when(starts_at) from public.session_slots where id = 'sl_s8_remove')
    || ' at Sheikh Zayed Club. Your credit was refunded.',
  'remove_booking → removed_from_session names the branch, refund sentence intact');

-- ════════════════════════════════════════════════════════════════════════════
-- 3 — cancel_session (MONEY PATH), as the ADMIN
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"08000001-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.cancel_session('sl_s8_session')->>'refunded_count', '1', 'cancel_session still refunds');
reset role;

select is(
  (select body from public.notifications where type = 'session_cancelled'),
  'Your Group session on '
    || (select tpa.cairo_when(starts_at) from public.session_slots where id = 'sl_s8_session')
    || ' at Sheikh Zayed Club was cancelled and your credit refunded.',
  'cancel_session → session_cancelled names the branch');

-- ════════════════════════════════════════════════════════════════════════════
-- 4 — confirm_session, as the ADMIN
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"08000001-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.confirm_session('sl_s8_confirm')->>'ok', 'true', 'confirm_session still succeeds');
reset role;

select is(
  (select body from public.notifications where type = 'session_confirmed' and slot_id = 'sl_s8_confirm'),
  'Your Group session on '
    || (select tpa.cairo_when(starts_at) from public.session_slots where id = 'sl_s8_confirm')
    || ' at Sheikh Zayed Club is confirmed.',
  'confirm_session → session_confirmed names the branch');

-- ════════════════════════════════════════════════════════════════════════════
-- 5 — reschedule_session, as the ADMIN
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"08000001-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(
  public.reschedule_session('sl_s8_resched', 'co_s8', 4, now()+interval '9 day', now()+interval '9 day 1 hour')->>'moved',
  'true', 'reschedule_session still moves the session');
reset role;

select is(
  (select body from public.notifications where type = 'session_rescheduled'),
  'Your Group session moved to '
    || (select tpa.cairo_when(starts_at) from public.session_slots where id = 'sl_s8_resched')
    || ' at Sheikh Zayed Club.',
  'reschedule_session → session_rescheduled names the branch it stays at');

-- ════════════════════════════════════════════════════════════════════════════
-- 6 — admin_book_player, as the ADMIN. Capacity 2 with 1 booked, so this
--     booking FILLS it and both emits fire in one call.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"08000001-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.admin_book_player('sl_s8_adminadd', 'pl_s8_a', false, null)->>'ok', 'true', 'admin_book_player still succeeds');
reset role;

select is(
  (select body from public.notifications where type = 'admin_booked'),
  'You''ve been added to a Group session on '
    || (select tpa.cairo_when(starts_at) from public.session_slots where id = 'sl_s8_adminadd')
    || ' at Sheikh Zayed Club.',
  'admin_book_player → admin_booked names the branch');
select is(
  (select body from public.notifications where type = 'session_confirmed' and slot_id = 'sl_s8_adminadd'),
  'Your Group session on '
    || (select tpa.cairo_when(starts_at) from public.session_slots where id = 'sl_s8_adminadd')
    || ' at Sheikh Zayed Club is confirmed.',
  'admin_book_player → the session_confirmed fan-out names the branch');

-- ════════════════════════════════════════════════════════════════════════════
-- 7 — send_session_reminders, both messages, as postgres (the cron caller)
-- ════════════════════════════════════════════════════════════════════════════
select is(tpa.send_session_reminders(), 1, 'one slot reminded');

select is(
  (select body from public.notifications where type = 'session_reminder'),
  'Your Group session starts in 30 minutes — '
    || (select tpa.cairo_time_short(starts_at) from public.session_slots where id = 'sl_s8_remind')
    || ' with Tarek at Sheikh Zayed Club.',
  'the PLAYER reminder names the branch');
select is(
  (select body from public.notifications where type = 'coach_session_reminder'),
  'You''re teaching a Group session in 30 minutes — '
    || (select tpa.cairo_time_short(starts_at) from public.session_slots where id = 'sl_s8_remind')
    || ' at Sheikh Zayed Club.',
  'the COACH reminder names the branch');
select is(
  (select player_id from public.notifications where type = 'coach_session_reminder'),
  'pl_s8_coach', 'and it still goes to the login linked to the slot''s coach');

-- §5 — idempotency is untouched. A second pass claims nothing and sends nothing.
select is(tpa.send_session_reminders(), 0, 'a second pass reminds ZERO slots (reminded_at still claims)');
select is(
  (select count(*)::int from public.notifications where type in ('session_reminder', 'coach_session_reminder')),
  2, 'and emits no duplicate — still exactly one reminder each');
select isnt(
  (select reminded_at from public.session_slots where id = 'sl_s8_remind'), null,
  'the stamp is set, which is what makes the pass exactly-once');

-- ════════════════════════════════════════════════════════════════════════════
-- 8 — the NOT NULL claim, over everything the fixture just produced
-- ════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from public.notifications where body is null or btrim(body) = ''),
  0, 'not one body is NULL or blank');
select is(
  (select count(*)::int from public.notifications where body not like '%Sheikh Zayed Club%'),
  0, 'EVERY notification this fixture produced names the branch');
select is(
  (select count(*)::int from public.notifications where body like '%Oro Plaza%'),
  0, 'and not one of them names the DEFAULT branch instead of the slot''s own');

-- ════════════════════════════════════════════════════════════════════════════
-- 9 — the hard constraint: no new notification type reached a legacy client
-- ════════════════════════════════════════════════════════════════════════════
select is(
  (select count(distinct type)::int from public.notifications
    where type not in ('session_confirmed','session_cancelled','removed_from_session','session_rescheduled',
                       'credits_granted','credit_request_rejected','admin_booked','session_reopened',
                       'news_published','owner_credit_request','owner_booking','owner_cancellation',
                       'session_reminder','booking_confirmation','coach_booking_alert','coach_session_reminder')),
  0, '069 introduced NO notification type a 1.2/1.3 client cannot render');
select is(
  (select count(*)::int from information_schema.check_constraints
    where constraint_name = 'notifications_type_check'
      and check_clause like '%coach_session_reminder%'),
  1, 'the type CHECK is the one that shipped — 069 did not widen it');

-- ════════════════════════════════════════════════════════════════════════════
-- 10 — the DEFAULT branch still reads as itself (069 did not hardcode anything)
-- ════════════════════════════════════════════════════════════════════════════
insert into public.session_slots (id, location_id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status)
values ('sl_s8_home', 'loc_oro_plaza', 'co_s8', now()+interval '11 day', now()+interval '11 day 1 hour', 'group', 4, 1, 'men', 'beginner', 'published');
insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at, location_id)
values ('cb_s8_home', 'pl_s8_b', 'admin_grant', null, 'group', 9, 4, now()+interval '60 day', now(), 'loc_oro_plaza');
insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at, cancelled_at, location_id)
values ('bk_s8_home', 'sl_s8_home', 'pl_s8_b', 'cb_s8_home', 'booked', now(), null, 'loc_oro_plaza');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"08000001-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.confirm_session('sl_s8_home')->>'ok', 'true', 'confirm_session at the default branch still succeeds');
reset role;

select is(
  (select body from public.notifications where type = 'session_confirmed' and slot_id = 'sl_s8_home'),
  'Your Group session on '
    || (select tpa.cairo_when(starts_at) from public.session_slots where id = 'sl_s8_home')
    || ' at Oro Plaza Hotel is confirmed.',
  'a session at the ORIGINAL branch names Oro Plaza Hotel — the slot''s own, either way');

select * from finish();
rollback;
