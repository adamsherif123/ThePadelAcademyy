-- ============================================================================
-- Coach mode phase 1 — players.coach_id, current_coach_id(), set_player_coach (pgTAP).
--
-- The link is the whole phase, so what is proved here is: the flag resolves for the
-- right caller and nobody else, the write is admin-only, a bad coach id is a clean
-- reason rather than a raw FK error, and one coaches record can never belong to two
-- logins (the property the routing fork would otherwise be ambiguous about).
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(24);

insert into auth.users (id) values
  ('0c0c0c01-0000-0000-0000-00000000c001'),   -- the coach's login
  ('0c0c0c02-0000-0000-0000-00000000c002'),   -- an ordinary player
  ('0c0c0c03-0000-0000-0000-00000000c003'),   -- a second would-be coach login
  ('0c0c0c04-0000-0000-0000-00000000c004');   -- an admin

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_coach1', '+201900010001', 'Coach One',  'men', 'beginner', now(), '0c0c0c01-0000-0000-0000-00000000c001'),
  ('pl_plain',  '+201900010002', 'Plain Player','men', 'beginner', now(), '0c0c0c02-0000-0000-0000-00000000c002'),
  ('pl_coach2', '+201900010003', 'Coach Two',  'men', 'beginner', now(), '0c0c0c03-0000-0000-0000-00000000c003'),
  ('pl_gone2',  '+201900010004', 'Retired',    'men', 'beginner', now(), null);
update public.players set deleted_at = now() where id = 'pl_gone2';

insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('ad_coachtest', '0c0c0c04-0000-0000-0000-00000000c004', 'Admin', now());

insert into public.coaches (id, name, bio, is_active) values
  ('co_link_a', 'Coach Alpha', 'b', true),
  ('co_link_b', 'Coach Beta',  'b', false);   -- inactive: still linkable (on leave)

-- ════════════════════════════════════════════════════════════════════════════
-- Shape
-- ════════════════════════════════════════════════════════════════════════════
select has_column('public', 'players', 'coach_id', 'players.coach_id exists');
select col_is_null('public', 'players', 'coach_id', 'coach_id is nullable — null means "not a coach"');
select has_index('public', 'players', 'players_coach_id_key', 'the partial unique index exists');
select hasnt_column('public', 'players', 'is_coach',
  'there is deliberately NO is_coach boolean — the FK alone is the flag');

-- ════════════════════════════════════════════════════════════════════════════
-- set_player_coach — authorisation
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0c0c0c02-0000-0000-0000-00000000c002","role":"authenticated"}', true);
select is(public.set_player_coach('pl_coach1', 'co_link_a')->>'reason', 'not_admin',
  'an ordinary PLAYER cannot link anyone to a coach');
select is((select coach_id from public.players where id = 'pl_coach1'), null,
  'and the attempt wrote nothing');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- set_player_coach — the happy path, as an admin
-- ════════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claims', '{"sub":"0c0c0c04-0000-0000-0000-00000000c004","role":"authenticated"}', true);

select is(public.set_player_coach('pl_coach1', 'co_link_a')->>'ok', 'true', 'an admin links a player to a coach');
select is((select coach_id from public.players where id = 'pl_coach1'), 'co_link_a', 'the link is written');
select is(public.set_player_coach('pl_coach1', 'co_link_a')->>'ok', 'true',
  're-linking the SAME coach is idempotent, not a uniqueness failure against itself');

-- ════════════════════════════════════════════════════════════════════════════
-- set_player_coach — rejections
-- ════════════════════════════════════════════════════════════════════════════
select is(public.set_player_coach('pl_coach2', 'co_nope')->>'reason', 'coach_missing',
  'a coach id that does not exist is a clean reason, never a raw FK violation');
select is(public.set_player_coach('pl_nobody', 'co_link_a')->>'reason', 'player_missing',
  'a player id that does not exist is refused');
select is(public.set_player_coach('pl_gone2', 'co_link_a')->>'reason', 'player_missing',
  'a DELETED player is not a candidate for a coach login');
select is(public.set_player_coach('pl_coach2', 'co_link_a')->>'reason', 'coach_taken',
  'a coach already linked to one login cannot be linked to a second');
select is((select coach_id from public.players where id = 'pl_coach2'), null,
  'and the second player is left unlinked');
select is((select coach_id from public.players where id = 'pl_coach1'), 'co_link_a',
  'the original link is untouched by the rejected attempt');

-- An INACTIVE coach is deliberately still linkable — a coach on leave keeps their login.
select is(public.set_player_coach('pl_coach2', 'co_link_b')->>'ok', 'true',
  'an inactive coach can still be linked (on leave, not gone)');

-- Clearing
select is(public.set_player_coach('pl_coach2', null)->>'ok', 'true', 'passing null clears the link');
select is((select coach_id from public.players where id = 'pl_coach2'), null, 'the link is cleared');
select is(public.set_player_coach('pl_coach2', 'co_link_b')->>'ok', 'true',
  'and the freed coach can be linked again');
select is(public.set_player_coach('pl_coach2', null)->>'ok', 'true', 'cleared again for the reads below');

-- ════════════════════════════════════════════════════════════════════════════
-- current_coach_id() — the flag the routing fork reads
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0c0c0c01-0000-0000-0000-00000000c001","role":"authenticated"}', true);
select is(public.current_coach_id(), 'co_link_a', 'a linked coach resolves to THEIR coach record');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0c0c0c02-0000-0000-0000-00000000c002","role":"authenticated"}', true);
select is(public.current_coach_id(), null, 'an ordinary player resolves to null');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0c0c0c04-0000-0000-0000-00000000c004","role":"authenticated"}', true);
select is(public.current_coach_id(), null,
  'an ADMIN credential resolves to null — it has no player row, so it is never a coach');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- Nothing existing moved
-- ════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from information_schema.table_constraints tc
    join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
   where tc.table_name = 'session_slots' and tc.constraint_type = 'FOREIGN KEY' and ccu.table_name = 'coaches'),
  1, 'session_slots.coach_id still references coaches — the link did not re-key the schedule');

select * from finish();
rollback;
