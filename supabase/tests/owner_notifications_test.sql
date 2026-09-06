-- ============================================================================
-- Owner pings — players.is_owner + the two fan-outs (pgTAP).
--
-- Proves the recipient mechanism is the FLAG (not a hardcoded list), that both
-- fan-outs fire only on the success path, that the actor is never self-notified,
-- and that the two message strings render exactly as specified:
--   "Hady requested 4 Group Credits"
--   "Hady booked 7pm slot with Aly"
--
-- The owners here are seeded and flagged by this test, deliberately NOT the two
-- production ids the migration flags — so correctness is proven independently of
-- which players the academy currently calls owners.
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(25);

-- ── seed as postgres (RLS bypassed) ─────────────────────────────────────────
insert into auth.users (id) values
  ('0aaaaaaa-0000-0000-0000-00000000000a'),   -- owner 1
  ('0bbbbbbb-0000-0000-0000-00000000000b'),   -- owner 2
  ('0ccccccc-0000-0000-0000-00000000000c'),   -- plain player (the actor)
  ('0ddddddd-0000-0000-0000-00000000000d');   -- deleted owner

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_own1', '+201900008001', 'Owner One',  'men',    'beginner', now(), '0aaaaaaa-0000-0000-0000-00000000000a'),
  ('pl_own2', '+201900008002', 'Owner Two',  'men',    'beginner', now(), '0bbbbbbb-0000-0000-0000-00000000000b'),
  ('pl_hady', '+201900008003', 'Hady',       'men',    'beginner', now(), '0ccccccc-0000-0000-0000-00000000000c'),
  ('pl_gone', '+201900008004', 'Gone Owner', 'men',    'beginner', now(), '0ddddddd-0000-0000-0000-00000000000d');

update public.players set is_owner = true where id in ('pl_own1', 'pl_own2', 'pl_gone');
-- A flagged owner who has since deleted their account must not be pinged.
update public.players set deleted_at = now() where id = 'pl_gone';

insert into public.coaches (id, name, bio, is_active) values
  ('co_aly', 'Aly Salem', 'b', true);

insert into public.packages (id, training_type, session_count, price, name, is_active) values
  ('pk_grp4', 'group', 4, 140000, '4-pack', true),
  ('pk_dead', 'group', 4, 140000, 'Hidden', false);

-- A 7:00 PM Cairo session tomorrow, and a full one for the rejection case.
insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status) values
  ('sl_7pm',  'co_aly',
     ((date_trunc('day', (now() at time zone 'Africa/Cairo')) + interval '1 day 19 hour') at time zone 'Africa/Cairo'),
     ((date_trunc('day', (now() at time zone 'Africa/Cairo')) + interval '1 day 20 hour 30 minute') at time zone 'Africa/Cairo'),
     'group', 4, 0, 'men', 'beginner', 'published'),
  ('sl_full', 'co_aly', now()+interval '2 day', now()+interval '2 day 1 hour', 'group', 1, 1, 'men', 'beginner', 'published');

insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at) values
  ('cb_hady', 'pl_hady', 'signup_grant', null, 'group', 5, 5, now()+interval '30 day', now()),
  ('cb_own1', 'pl_own1', 'signup_grant', null, 'group', 5, 5, now()+interval '30 day', now());

-- ════════════════════════════════════════════════════════════════════════════
-- The flag itself
-- ════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from public.players where is_owner),
  3, 'is_owner flags exactly the players it was set on');
select is(
  (select is_owner from public.players where id = 'pl_hady'),
  false, 'every other player defaults to is_owner = false');

-- ════════════════════════════════════════════════════════════════════════════
-- CREDIT REQUEST — a non-owner requests
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0ccccccc-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select is(public.request_credits('pk_grp4', 'instapay', null)->>'ok', 'true',
  'request_credits still succeeds (the ping is additive)');
reset role;

select is(
  (select count(*)::int from public.notifications where type = 'owner_credit_request'),
  2, 'a non-owner request pings BOTH live owners — one row each');
select is(
  (select count(*)::int from public.notifications
    where type = 'owner_credit_request' and player_id = 'pl_own1'),
  1, 'owner 1 gets exactly one — never duplicated');
select is(
  (select count(*)::int from public.notifications
    where type = 'owner_credit_request' and player_id = 'pl_gone'),
  0, 'a flagged owner who deleted their account is NOT pinged');
select is(
  (select count(*)::int from public.notifications
    where type = 'owner_credit_request' and player_id = 'pl_hady'),
  0, 'the requester (a non-owner) is not pinged');
select is(
  (select distinct body from public.notifications where type = 'owner_credit_request'),
  'Hady requested 4 Group Credits',
  'the exact required string: "Hady requested 4 Group Credits"');

-- ════════════════════════════════════════════════════════════════════════════
-- CREDIT REQUEST — a REJECTED request pings nobody
-- ════════════════════════════════════════════════════════════════════════════
delete from public.notifications;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0aaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select is(public.request_credits('pk_dead', 'instapay', null)->>'reason', 'package_inactive',
  'an inactive package is still rejected, unchanged');
reset role;
select is(
  (select count(*)::int from public.notifications where type = 'owner_credit_request'),
  0, 'a REJECTED credit request pings nobody — only the success path emits');

-- ════════════════════════════════════════════════════════════════════════════
-- CREDIT REQUEST — an OWNER requests: the other owner is pinged, not themselves
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0aaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select is(public.request_credits('pk_grp4', 'cash', null)->>'ok', 'true', 'owner 1 requests credits');
reset role;

select is(
  (select count(*)::int from public.notifications
    where type = 'owner_credit_request' and player_id = 'pl_own1'),
  0, 'an owner requesting their OWN credits is never self-pinged');
select is(
  (select count(*)::int from public.notifications
    where type = 'owner_credit_request' and player_id = 'pl_own2'),
  1, 'the OTHER owner is still pinged');

-- ════════════════════════════════════════════════════════════════════════════
-- BOOKING — a non-owner books
-- ════════════════════════════════════════════════════════════════════════════
delete from public.notifications;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0ccccccc-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select is(public.book_slot('sl_7pm')->>'ok', 'true', 'book_slot still succeeds (the ping is additive)');
reset role;

select is(
  (select booked_count from public.session_slots where id = 'sl_7pm'),
  1, 'the seat was actually taken — guarded UPDATE unchanged');
select is(
  (select quantity_remaining from public.credit_batches where id = 'cb_hady'),
  4, 'the credit was actually spent — guarded logic unchanged');
select is(
  (select count(*)::int from public.notifications where type = 'owner_booking'),
  2, 'a booking pings BOTH live owners — one row each');
select is(
  (select distinct body from public.notifications where type = 'owner_booking'),
  'Hady booked 7pm slot with Aly',
  'the exact required string: "Hady booked 7pm slot with Aly" (Cairo time, coach first name)');
select is(
  (select distinct slot_id from public.notifications where type = 'owner_booking'),
  'sl_7pm', 'the ping carries the slot it was about');

-- ════════════════════════════════════════════════════════════════════════════
-- BOOKING — an OWNER books, and a REJECTED booking
-- ════════════════════════════════════════════════════════════════════════════
delete from public.notifications;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0aaaaaaa-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select is(public.book_slot('sl_7pm')->>'ok', 'true', 'owner 1 books the same session');
reset role;

select is(
  (select count(*)::int from public.notifications
    where type = 'owner_booking' and player_id = 'pl_own1'),
  0, 'an owner booking their OWN session is never self-pinged');
select is(
  (select count(*)::int from public.notifications
    where type = 'owner_booking' and player_id = 'pl_own2'),
  1, 'the OTHER owner is still pinged');

delete from public.notifications;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0ccccccc-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select is(public.book_slot('sl_full')->>'reason', 'slot_full',
  'a full slot is still rejected, unchanged');
reset role;
select is(
  (select count(*)::int from public.notifications where type = 'owner_booking'),
  0, 'a REJECTED booking pings nobody — only the success path emits');

-- ════════════════════════════════════════════════════════════════════════════
-- The type constraint accepts both new types and still rejects nonsense
-- ════════════════════════════════════════════════════════════════════════════
select throws_ok(
  $$ insert into public.notifications (id, player_id, type, title, body, created_at)
       values ('nt_bad', 'pl_own1', 'owner_nonsense', 't', 'b', now()) $$,
  '23514', null, 'notifications_type_check still rejects an unknown type');

select * from finish();
rollback;
