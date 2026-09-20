-- ============================================================================
-- News notify targets — players / coaches / both / none (pgTAP).
--
-- A coach IS a player, so the two audiences are a partition of one table on
-- coach_id. What matters is that each target reaches exactly its own group and
-- nobody else, that the legacy four-argument call still behaves as it always did,
-- and that publishing never depends on the push: the news row is created either
-- way, because everyone SEES every item in the feed regardless of who was pinged.
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(21);

insert into auth.users (id) values
  ('0a1a1a01-0000-0000-0000-00000000a001'),   -- admin
  ('0a1a1a02-0000-0000-0000-00000000a002'),   -- plain player
  ('0a1a1a03-0000-0000-0000-00000000a003'),   -- another plain player
  ('0a1a1a04-0000-0000-0000-00000000a004');   -- a linked coach

insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('ad_news', '0a1a1a01-0000-0000-0000-00000000a001', 'News Admin', now());

insert into public.coaches (id, name, bio, is_active) values ('co_news', 'News Coach', 'b', true);

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id, coach_id) values
  ('pl_np1', '+201900050001', 'Plain One', 'men',    'beginner', now(), '0a1a1a02-0000-0000-0000-00000000a002', null),
  ('pl_np2', '+201900050002', 'Plain Two', 'ladies', 'beginner', now(), '0a1a1a03-0000-0000-0000-00000000a003', null),
  ('pl_nc1', '+201900050003', 'The Coach', 'men',    'beginner', now(), '0a1a1a04-0000-0000-0000-00000000a004', 'co_news'),
  -- Anonymised/deleted: auth_user_id null. Must never be notified by any target.
  ('pl_ngone', '+201900050004', 'Gone', 'men', 'beginner', now(), null, null);

-- Only the create_news CALL needs the admin's session. Every assertion below reads
-- notifications/news as postgres, because an admin has no direct grant on
-- notifications — the fan-out happens inside a SECURITY DEFINER function, which is
-- precisely why it can write rows the caller could never read.
-- ════════════════════════════════════════════════════════════════════════════
-- players
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0a1a1a01-0000-0000-0000-00000000a001","role":"authenticated"}', true);
select is(public.create_news('P', 'body', null, false, 'players')->>'ok', 'true', 'target "players" publishes');
reset role;
select is((select count(*)::int from public.notifications where type='news_published'), 2,
  'exactly the two PLAIN players are notified');
select is((select count(*)::int from public.notifications where player_id='pl_nc1'), 0,
  'the coach is NOT notified by "players"');
select is((select count(*)::int from public.notifications where player_id='pl_ngone'), 0,
  'a deleted account is never notified');
select isnt((select news_id from public.notifications limit 1), null,
  'the notification carries the news id, as before');

-- ════════════════════════════════════════════════════════════════════════════
-- coaches
-- ════════════════════════════════════════════════════════════════════════════
delete from public.notifications;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0a1a1a01-0000-0000-0000-00000000a001","role":"authenticated"}', true);
select is(public.create_news('C', 'body', null, false, 'coaches')->>'ok', 'true', 'target "coaches" publishes');
reset role;
select is((select count(*)::int from public.notifications where type='news_published'), 1,
  'exactly one notification — only the linked coach');
select is((select player_id from public.notifications), 'pl_nc1', '…and it is the coach');
select is((select count(*)::int from public.notifications where player_id in ('pl_np1','pl_np2')), 0,
  'no ordinary player is notified by "coaches"');

-- ════════════════════════════════════════════════════════════════════════════
-- both
-- ════════════════════════════════════════════════════════════════════════════
delete from public.notifications;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0a1a1a01-0000-0000-0000-00000000a001","role":"authenticated"}', true);
select is(public.create_news('B', 'body', null, false, 'both')->>'ok', 'true', 'target "both" publishes');
reset role;
select is((select count(*)::int from public.notifications where type='news_published'), 3,
  'everyone with a login is notified — two players and the coach');
select is((select count(*)::int from public.notifications where player_id='pl_ngone'), 0,
  'still never the deleted account');

-- ════════════════════════════════════════════════════════════════════════════
-- none
-- ════════════════════════════════════════════════════════════════════════════
delete from public.notifications;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0a1a1a01-0000-0000-0000-00000000a001","role":"authenticated"}', true);
select is(public.create_news('N', 'body', null, false, 'none')->>'ok', 'true', 'target "none" still PUBLISHES the item');
reset role;
select is((select count(*)::int from public.notifications), 0, '…and notifies nobody');
select is((select count(*)::int from public.news where title='N'), 1,
  'the news row exists regardless — everyone can still read it in the feed');

-- ════════════════════════════════════════════════════════════════════════════
-- Backward compatibility: an admin bundle loaded before this deploy
-- ════════════════════════════════════════════════════════════════════════════
delete from public.notifications;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0a1a1a01-0000-0000-0000-00000000a001","role":"authenticated"}', true);
select is(public.create_news('L1', 'body', null, true)->>'ok', 'true',
  'a legacy FOUR-argument call still resolves — an open admin tab does not break');
reset role;
select is((select count(*)::int from public.notifications where type='news_published'), 3,
  '…and notify_players=true still means everybody, exactly as it did before');

delete from public.notifications;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0a1a1a01-0000-0000-0000-00000000a001","role":"authenticated"}', true);
select is(public.create_news('L0', 'body', null, false)->>'ok', 'true', 'legacy call with false publishes');
reset role;
select is((select count(*)::int from public.notifications), 0, '…and notifies nobody, as before');

-- ════════════════════════════════════════════════════════════════════════════
-- A bad target is a reason, not a silent no-push
-- ════════════════════════════════════════════════════════════════════════════
delete from public.notifications;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0a1a1a01-0000-0000-0000-00000000a001","role":"authenticated"}', true);
select is(public.create_news('X', 'body', null, false, 'everyone')->>'reason', 'invalid_target',
  'an unknown target is refused — a typo must not become an announcement nobody gets');
reset role;
select is((select count(*)::int from public.news where title='X'), 0,
  '…and no news row is created by a refused call');
select * from finish();
rollback;
