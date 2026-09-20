-- ============================================================================
-- Deleting a COACH's account releases the coach link (pgTAP).
--
-- delete_account anonymises rather than deletes, because bookings and purchases
-- reference the row. Every column that carries meaning is therefore blanked — and
-- players.coach_id has to be one of them, because it carries a partial UNIQUE
-- index: a tombstone that kept its link would hold that coaches record hostage
-- forever, invisibly, since the admin's roster does not list deleted rows.
--
-- The coaches row itself must survive. It is the academy's record — its name, its
-- sessions, its hours — and only one person's access to it is being withdrawn.
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(12);

insert into auth.users (id) values
  ('0b0b0b01-0000-0000-0000-00000000b001'),   -- the coach's login
  ('0b0b0b02-0000-0000-0000-00000000b002'),   -- the replacement login
  ('0b0b0b03-0000-0000-0000-00000000b003');   -- an admin, to re-link afterwards

insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('ad_del', '0b0b0b03-0000-0000-0000-00000000b003', 'Admin', now());

insert into public.coaches (id, name, bio, is_active) values
  ('co_del', 'Persisting Coach', 'bio worth keeping', true);

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id, coach_id) values
  ('pl_delcoach', '+201900060001', 'Leaving Coach', 'men', 'beginner', now(), '0b0b0b01-0000-0000-0000-00000000b001', 'co_del'),
  ('pl_newcoach', '+201900060002', 'Arriving Coach','men', 'beginner', now(), '0b0b0b02-0000-0000-0000-00000000b002', null);

-- A session this coach has taught: it must outlive the account.
insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status) values
  ('sl_del', 'co_del', now()-interval '3 hours', now()-interval '2 hours', 'group', 4, 0, 'men', 'beginner', 'published');

select is((select coach_id from public.players where id='pl_delcoach'), 'co_del', 'the coach starts linked');

-- ════════════════════════════════════════════════════════════════════════════
-- The coach deletes their own account
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0b0b0b01-0000-0000-0000-00000000b001","role":"authenticated"}', true);
select is(public.delete_account()->>'ok', 'true', 'a linked coach can delete their account — no FK error');
select is(public.delete_account()->>'already_deleted', 'true', 'and a second call is idempotent');
reset role;

-- ── the tombstone ───────────────────────────────────────────────────────────
select is((select coach_id from public.players where id='pl_delcoach'), null,
  'the tombstone RELEASES the coach link — this is the whole point');
select is((select name from public.players where id='pl_delcoach'), 'Deleted player',
  'and is anonymised exactly as before');
select isnt((select deleted_at from public.players where id='pl_delcoach'), null, '…marked deleted');
select is((select auth_user_id from public.players where id='pl_delcoach'), null, '…with its auth link dropped');

-- ── the coach record survives ───────────────────────────────────────────────
select is((select count(*)::int from public.coaches where id='co_del'), 1,
  'the COACHES row survives — it is the academy''s record, not the person''s');
select is((select bio from public.coaches where id='co_del'), 'bio worth keeping',
  '…entirely untouched');
select is((select count(*)::int from public.session_slots where coach_id='co_del'), 1,
  'and the sessions they taught are still attributed to them');

-- ════════════════════════════════════════════════════════════════════════════
-- The freed coach can be given a new login — the failure this prevents
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0b0b0b03-0000-0000-0000-00000000b003","role":"authenticated"}', true);
select is(public.set_player_coach('pl_newcoach', 'co_del')->>'ok', 'true',
  'the admin can link the SAME coach to a new account — without the release this was coach_taken, permanently');
reset role;
select is((select coach_id from public.players where id='pl_newcoach'), 'co_del', 'and the new login holds the link');

select * from finish();
rollback;
