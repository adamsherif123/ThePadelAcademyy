-- ============================================================================
-- Session 8 Part A — the coach app is ACADEMY-WIDE, not per-branch (pgTAP).
--
-- A player browses one branch at a time. A coach does not: they are given a
-- session wherever the academy needs them, their day can run across two branches,
-- and their pay is one number for all of it. So the two claims here are the
-- opposite of the player app's:
--
--   1. NOTHING a coach reads is filtered by branch. A coach whose sessions are
--      split across two locations must see all of them, and their hours must add
--      up across both — anything else is a coach who thinks they have half a day,
--      or half a wage.
--   2. That is true STRUCTURALLY, not just for this fixture: the four functions
--      behind the coach app never mention location at all, so no future branch
--      filter can appear in them without this test going red.
--
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(19);

insert into auth.users (id) values
  ('08b00001-0000-0000-0000-00000000b001'),   -- the coach's login
  ('08b00002-0000-0000-0000-00000000b002'),   -- a player
  ('08b00003-0000-0000-0000-00000000b003');   -- admin

insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('adm_s8b', '08b00003-0000-0000-0000-00000000b003', 'Adm8b', now());

insert into public.locations (id, name, address, maps_url, hours_text, sort_order, is_active, is_default)
values ('loc_s8b_zayed', 'Sheikh Zayed Club', '7 Test St, Giza', 'https://maps.example/z', 'Daily', 51, true, false);

insert into public.coaches (id, name, bio, is_active) values ('co_s8b', 'Tarek Fouad', 'b', true);

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id, coach_id) values
  ('pl_s8b_coach', '+201908100001', 'Tarek Fouad', 'men', 'beginner', now(), '08b00001-0000-0000-0000-00000000b001', 'co_s8b'),
  ('pl_s8b_p',     '+201908100002', 'Player Two',  'men', 'beginner', now(), '08b00002-0000-0000-0000-00000000b002', null);

insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at, location_id) values
  ('cb_s8b_home', 'pl_s8b_p', 'admin_grant', null, 'group', 9, 4, now()+interval '60 day', now(), 'loc_oro_plaza'),
  ('cb_s8b_away', 'pl_s8b_p', 'admin_grant', null, 'group', 9, 4, now()+interval '60 day', now(), 'loc_s8b_zayed');

-- ONE coach, FOUR sessions, split evenly between the two branches. Two in the
-- future (schedule), two already finished with an attended booking (hours).
insert into public.session_slots (id, location_id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status) values
  ('sl_s8b_fut_home', 'loc_oro_plaza',  'co_s8b', now()+interval '2 day', now()+interval '2 day 1 hour',  'group', 4, 1, 'men', 'beginner', 'published'),
  ('sl_s8b_fut_away', 'loc_s8b_zayed',  'co_s8b', now()+interval '3 day', now()+interval '3 day 1 hour',  'group', 4, 1, 'men', 'beginner', 'published'),
  ('sl_s8b_past_home','loc_oro_plaza',  'co_s8b', now()-interval '2 hour', now()-interval '1 hour',       'group', 4, 1, 'men', 'beginner', 'published'),
  ('sl_s8b_past_away','loc_s8b_zayed',  'co_s8b', now()-interval '4 hour', now()-interval '3 hour',       'group', 4, 1, 'men', 'beginner', 'published');

insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at, cancelled_at, location_id) values
  ('bk_s8b_fh', 'sl_s8b_fut_home',  'pl_s8b_p', 'cb_s8b_home', 'booked',   now(), null, 'loc_oro_plaza'),
  ('bk_s8b_fa', 'sl_s8b_fut_away',  'pl_s8b_p', 'cb_s8b_away', 'booked',   now(), null, 'loc_s8b_zayed'),
  ('bk_s8b_ph', 'sl_s8b_past_home', 'pl_s8b_p', 'cb_s8b_home', 'attended', now(), null, 'loc_oro_plaza'),
  ('bk_s8b_pa', 'sl_s8b_past_away', 'pl_s8b_p', 'cb_s8b_away', 'attended', now(), null, 'loc_s8b_zayed');

-- ════════════════════════════════════════════════════════════════════════════
-- 1 — as the COACH, under their own JWT (the real role, not postgres)
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"08b00001-0000-0000-0000-00000000b001","role":"authenticated"}', true);

select is(public.current_coach_id(), 'co_s8b', 'the JWT resolves to the coach');

-- ── WITHOUT the header: a 1.3 coach binary is pinned to the default branch ──
-- 063's net has no coach exemption — a coach reads slots as plain `authenticated`
-- through session_slots_select_published_public — and that is deliberate and
-- documented there. Asserting it first is what makes the header assertion below
-- mean something: the two differ, so the header is doing the work.
select is(
  (select count(*)::int from public.session_slots where coach_id = 'co_s8b' and status = 'published'),
  2, 'with NO x-tpa-client header, the coach sees only the DEFAULT branch''s sessions');
select is(
  (select count(distinct location_id)::int from public.session_slots
    where coach_id = 'co_s8b' and status = 'published'),
  1, 'and those two are all at one branch — the legacy net, doing its job');

-- ── WITH the header the app actually sends ──────────────────────────────────
-- Identical to what apps/mobile/src/lib/supabase.ts puts on the client at
-- construction: ONE client for players and coaches alike, so the coach build
-- cannot forget it. app.json's version is 1.4 today; any mobile/<semver>
-- satisfies the net's regex, which is the point — it says "this binary
-- understands branches", not "this binary is new enough".
select set_config('request.headers', '{"x-tpa-client":"mobile/1.4.0"}', true);

select is(
  (select count(*)::int from public.session_slots where coach_id = 'co_s8b' and status = 'published'),
  4, 'WITH the header, the coach reads all FOUR of their sessions — both branches');
select is(
  (select count(distinct location_id)::int from public.session_slots
    where coach_id = 'co_s8b' and status = 'published'),
  2, 'and they genuinely span two branches (so the count above is not a coincidence)');
select is(
  (select count(*)::int from public.session_slots
    where coach_id = 'co_s8b' and status = 'published' and location_id = 'loc_s8b_zayed'),
  2, 'including both of the ones at the SECOND branch, which were invisible a moment ago');

-- Hours: one number, both branches, no split. A SECURITY DEFINER aggregate, so
-- it never saw the net in the first place — the coach's PAY was never at risk.
select is(
  (select hours from public.coach_hours_coached(null) where coach_id = 'co_s8b'), 2.0::numeric,
  'hours are 2 — ONE hour at each branch, added together into a single figure');

select is(
  (public.coach_dashboard_summary()->>'upcoming_count')::int, 2,
  'the dashboard counts upcoming sessions at both branches');
select is(
  (public.coach_dashboard_summary()->>'hours_this_month')::numeric, 2.0::numeric,
  'and its hours figure is the same single cross-branch number');

-- The roster is per-session, so it answers for a session at the SECOND branch too.
select is(
  (select count(*)::int from public.coach_session_roster('sl_s8b_fut_away')),
  1, 'the roster for a session at the second branch is readable, not empty');

-- The hours aggregate is header-independent, which is the claim 063 made when it
-- accepted the coach net: "their hours and dashboard are SECURITY DEFINER
-- aggregates that bypass RLS entirely, so pay is never affected." Proven, not
-- taken on trust.
select set_config('request.headers', '{}', true);
select is(
  (select hours from public.coach_hours_coached(null) where coach_id = 'co_s8b'), 2.0::numeric,
  'and hours are STILL 2 with the header removed — pay never depended on it');
select is(
  (public.coach_dashboard_summary()->>'hours_this_month')::numeric, 2.0::numeric,
  'the dashboard''s hours figure is header-independent too');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2 — the structural claim: none of it CAN be branch-filtered
-- ════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname, p.proname) in
      (('public','coach_dashboard_summary'), ('public','coach_hours_coached'),
       ('public','coach_session_roster'),    ('tpa','coach_hours_between'))
      and p.prosrc like '%location%'),
  0, 'not one of the four coach functions mentions location — no branch filter can hide in them');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname, p.proname) in
      (('public','coach_dashboard_summary'), ('public','coach_hours_coached'),
       ('public','coach_session_roster'),    ('tpa','coach_hours_between'))),
  4, 'and all four exist under those exact names (so the check above is not vacuous)');

-- ════════════════════════════════════════════════════════════════════════════
-- 3 — a coach is not a player: no toggle, and no branch-scoped credit view
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"08b00001-0000-0000-0000-00000000b001","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.locations where is_active),
  2, 'the coach CAN read the branch list (that is how a card names its branch)');
select is(
  (select count(*)::int from public.credit_batches),
  0, 'but reads no credit batches at all — the branch question is never about money for them');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4 — a session at the second branch still notifies the coach with the branch
--     named (069), which is the coach-facing half of this whole session
-- ════════════════════════════════════════════════════════════════════════════
update public.session_slots set starts_at = now()+interval '30 minute', ends_at = now()+interval '90 minute'
  where id = 'sl_s8b_fut_away';
select is(tpa.send_session_reminders(), 1, 'the second branch''s session is reminded');
select is(
  (select body from public.notifications where type = 'coach_session_reminder'),
  'You''re teaching a Group session in 30 minutes — '
    || (select tpa.cairo_time_short(starts_at) from public.session_slots where id = 'sl_s8b_fut_away')
    || ' at Sheikh Zayed Club.',
  'and the coach is told WHICH branch to be at');
select is(
  (select player_id from public.notifications where type = 'coach_session_reminder'),
  'pl_s8b_coach', 'it reaches the coach''s own login');

select * from finish();
rollback;
