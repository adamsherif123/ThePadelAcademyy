-- ============================================================================
-- 070 — every credit notification names its BRANCH (pgTAP).
--
-- Same discipline as 069's suite: the whole fixture lives at a SECOND branch,
-- never the default, so a body that hardcoded "Oro Plaza Hotel" or resolved the
-- default instead of the row's own branch would pass at the default and be wrong
-- in the only case the feature exists for. Every expected string here says
-- "Sheikh Zayed Club", the default branch also exists, and the last section
-- proves a request at the DEFAULT branch still reads as itself.
--
-- Roles are real: the player's own JWT as `authenticated` for request_credits,
-- an admin JWT as `authenticated` for approve and reject. Nothing runs as
-- postgres, because nothing here is called by postgres.
--
-- Two claims per emit: the body NAMES the branch, and the body IS NOT NULL.
-- notifications.body is NOT NULL and `'x' || null` is NULL, so an unresolved
-- branch would not merely read badly — it would abort the money path it hangs
-- off, taking the approval or the request with it.
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(28);

insert into auth.users (id) values
  ('07000001-0000-0000-0000-000000000001'),   -- admin
  ('07000002-0000-0000-0000-000000000002'),   -- the requesting player
  ('07000003-0000-0000-0000-000000000003');   -- owner

insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('adm_s85', '07000001-0000-0000-0000-000000000001', 'Adm85', now());

insert into public.locations (id, name, address, maps_url, hours_text, sort_order, is_active, is_default)
values ('loc_s85_zayed', 'Sheikh Zayed Club', '7 Test St, Giza', 'https://maps.example/z', 'Daily', 52, true, false);

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_s85_p',   '+201908500002', 'Mona Player', 'ladies', 'beginner', now(), '07000002-0000-0000-0000-000000000002'),
  ('pl_s85_own', '+201908500003', 'Owner Five',  'men',    'beginner', now(), '07000003-0000-0000-0000-000000000003');
update public.players set is_owner = true where id = 'pl_s85_own';

-- One package at each branch, so "the package's branch" is a real choice and not
-- the only row in the table.
insert into public.packages (id, location_id, training_type, session_count, price, name, is_active) values
  ('pk_s85_zayed', 'loc_s85_zayed', 'group', 4, 240000, 'Zayed Group 4-Pack', true),
  ('pk_s85_home',  'loc_oro_plaza',  'group', 4, 240000, 'Home Group 4-Pack',  true);

-- ════════════════════════════════════════════════════════════════════════════
-- 0 — the helper, and the NULL it cannot produce
-- ════════════════════════════════════════════════════════════════════════════
select is(tpa.location_name('loc_s85_zayed'), 'Sheikh Zayed Club', 'location_name resolves the second branch');
select is(tpa.location_name(null), 'the academy', 'location_name(null) is the safe word, not NULL');
select isnt(('x ' || tpa.location_name(null))::text, null, 'so a concatenated credit body can never become NULL');

-- ════════════════════════════════════════════════════════════════════════════
-- 1 — request_credits, as the PLAYER under their own JWT
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"07000002-0000-0000-0000-000000000002","role":"authenticated"}', true);
-- The 063 net refuses a non-default branch to a client that has not said it
-- understands branches. This is the header the 1.4 app sends.
select set_config('request.headers', '{"x-tpa-client":"mobile/1.4.0"}', true);
select is(public.request_credits('pk_s85_zayed', 'instapay', null)->>'ok', 'true',
  'request_credits still succeeds (070 is additive)');
reset role;

select is(
  (select count(*)::int from public.notifications where type = 'owner_credit_request'),
  1, 'exactly one owner is pinged');
select is(
  (select body from public.notifications where type = 'owner_credit_request'),
  'Mona Player requested 4 Group Credits for Sheikh Zayed Club',
  'the owners are told WHICH BRANCH the credits are for — the argument grant_credits requires');
select is(
  (select player_id from public.notifications where type = 'owner_credit_request'),
  'pl_s85_own', 'and it goes to the owner, not the requester');
select is(
  (select location_id from public.credit_requests where player_id = 'pl_s85_p'),
  'loc_s85_zayed', 'the request row itself is stamped with that branch (065)');

-- ════════════════════════════════════════════════════════════════════════════
-- 2 — reject_credit_request, as the ADMIN
-- ════════════════════════════════════════════════════════════════════════════
-- A SECOND request, at the DEFAULT branch, live at the same time. 066 allows
-- exactly this, and it is the whole reason the declined message needs a branch:
-- without one the player cannot tell which of their two requests was refused.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"07000002-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is(public.request_credits('pk_s85_home', 'instapay', null)->>'ok', 'true',
  'a player may hold a SECOND pending request at another branch (066)');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"07000001-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(
  public.reject_credit_request(
    (select id from public.credit_requests where location_id = 'loc_s85_zayed'), 'Payment not received')->>'ok',
  'true', 'reject_credit_request still succeeds');
reset role;

select is(
  (select body from public.notifications where type = 'credit_request_rejected'),
  'Your credit request for Sheikh Zayed Club was declined: Payment not received',
  'the declined message names the branch, so the player knows WHICH request');
select is(
  (select count(*)::int from public.credit_requests where status = 'pending'),
  1, 'their other request is untouched — which is exactly why the branch had to be said');

-- ════════════════════════════════════════════════════════════════════════════
-- 3 — approve_credit_request, as the ADMIN (MONEY: it mints a batch)
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"07000002-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tpa-client":"mobile/1.4.0"}', true);
select is(public.request_credits('pk_s85_zayed', 'instapay', null)->>'ok', 'true',
  'a fresh request at the second branch (the first was declined)');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"07000001-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(
  public.approve_credit_request(
    (select id from public.credit_requests where location_id = 'loc_s85_zayed' and status = 'pending'),
    null, null)->>'ok',
  'true', 'approve_credit_request still succeeds and still mints');
reset role;

select is(
  (select body from public.notifications where type = 'credits_granted'),
  'You received 4 Group credits for Sheikh Zayed Club.',
  'the player is told where the credits work — the exact sentence grant_credits uses');
-- The claim behind that sentence: the batch really is at that branch.
select is(
  (select location_id from public.credit_batches where player_id = 'pl_s85_p'),
  'loc_s85_zayed', 'and the minted batch IS at the branch the message named');
select is(
  (select quantity_remaining from public.credit_batches where player_id = 'pl_s85_p'),
  4, 'with the package''s session count, unchanged by 070');

-- The other route to the same outcome must read identically. This is the defect
-- 070 closes: one event, two sentences, depending on which button was pressed.
select is(
  public.grant_credits('pl_s85_own', 'group', 4, 'parity check', 'loc_s85_zayed')->>'ok', 'true',
  'grant_credits succeeds (run as postgres — the admin path is covered elsewhere)');
select is(
  (select body from public.notifications where type = 'credits_granted' and player_id = 'pl_s85_own'),
  'You received 4 Group credits for Sheikh Zayed Club.',
  'grant_credits and approve_credit_request now produce the SAME sentence, character for character');

-- ════════════════════════════════════════════════════════════════════════════
-- 5 — the DEFAULT branch still reads as itself (nothing was hardcoded)
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"07000001-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(
  public.approve_credit_request(
    (select id from public.credit_requests where location_id = 'loc_oro_plaza' and status = 'pending'),
    null, null)->>'ok',
  'true', 'the request at the ORIGINAL branch approves too');
reset role;

select is(
  (select count(*)::int from public.notifications
    where type = 'credits_granted' and body = 'You received 4 Group credits for Oro Plaza Hotel.'),
  1, 'and reads "Oro Plaza Hotel" — the row''s own branch, either way');


-- ════════════════════════════════════════════════════════════════════════════
-- 6 — over everything the fixture produced: nothing NULL, and every message
--     names the branch of the ROW IT IS ABOUT rather than a fixed one
-- ════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from public.notifications where body is null or btrim(body) = ''),
  0, 'not one body is NULL or blank');
-- Both branches appear, because the fixture deliberately worked at both. What
-- must never happen is a message naming NEITHER, or naming BOTH.
select is(
  (select count(*)::int from public.notifications
    where body not like '%Sheikh Zayed Club%' and body not like '%Oro Plaza Hotel%'),
  0, 'every message names a branch — none came out branchless');
select is(
  (select count(*)::int from public.notifications
    where body like '%Sheikh Zayed Club%' and body like '%Oro Plaza Hotel%'),
  0, 'and none names two');
-- The counts, stated: 4 messages about Zayed rows (owner ping, decline, owner
-- ping again, credits added) plus the grant_credits parity check = 5; 2 about the
-- default branch (its owner ping and its approval).
select is(
  (select count(*)::int from public.notifications where body like '%Sheikh Zayed Club%'),
  5, 'five messages are about the second branch''s rows, and say so');
select is(
  (select count(*)::int from public.notifications where body like '%Oro Plaza Hotel%'),
  2, 'two are about the default branch''s rows, and say that instead');

-- ════════════════════════════════════════════════════════════════════════════
-- 7 — the hard constraint: no type a 1.2/1.3 client cannot render
-- ════════════════════════════════════════════════════════════════════════════
select is(
  (select count(distinct type)::int from public.notifications
    where type not in ('session_confirmed','session_cancelled','removed_from_session','session_rescheduled',
                       'credits_granted','credit_request_rejected','admin_booked','session_reopened',
                       'news_published','owner_credit_request','owner_booking','owner_cancellation',
                       'session_reminder','booking_confirmation','coach_booking_alert','coach_session_reminder')),
  0, '070 introduced NO notification type a legacy client cannot render');
select is(
  (select count(*)::int from information_schema.check_constraints
    where constraint_name = 'notifications_type_check'
      and check_clause like '%coach_session_reminder%'),
  1, 'the type CHECK is the one that shipped — 070 did not widen it');

select * from finish();
rollback;
