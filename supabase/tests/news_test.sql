-- ============================================================================
-- News (server + admin) + credit expiry 30->40. Proves:
--  * create_news is admin-gated, validates title/body, and creates a visible row;
--  * notify_players=true fans out EXACTLY one news_published notification per
--    active player (auth_user_id is not null), each carrying the news id, and
--    excludes an anonymised/deleted player (auth_user_id null);
--  * notify_players=false creates news with ZERO notifications;
--  * update_news is admin-gated, edits fields, and NEVER inserts a notification
--    (only create notifies);
--  * delete_news is admin-gated, hard-deletes, CASCADEs news_seen, and SETS
--    NULL (not deletes) the news_id on any notification history that pointed
--    at it;
--  * news RLS: any authenticated player can SELECT, but only admins can
--    INSERT/UPDATE/DELETE (direct writes, bypassing the RPCs, are rejected);
--  * news_seen RLS — the light-review check: a player can insert/select ONLY
--    their own seen-row; a seen-row insert for another player is rejected;
--  * the 30-day visibility window (a query-side filter, not RLS) actually
--    excludes an old item and includes a recent one;
--  * tpa.credit_expiry() is now 40 days, a NEW purchase mints a 40-day batch,
--    and a pre-existing batch's stored expiry is completely untouched.
--
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(44);

-- ── seed (as postgres / superuser: RLS bypassed) ─────────────────────────────
insert into auth.users (id) values
  ('e0000000-e000-e000-e000-e00000000000'),   -- admin
  ('e1000000-e100-e100-e100-e10000000001'),   -- player A (active)
  ('e1000000-e100-e100-e100-e10000000002');   -- player B (active)

insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('adm_news', 'e0000000-e000-e000-e000-e00000000000', 'AdmNews', now());

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_news_a', '+201900004001', 'NewsA', 'men',    'beginner', now(), 'e1000000-e100-e100-e100-e10000000001'),
  ('pl_news_b', '+201900004002', 'NewsB', 'ladies', 'beginner', now(), 'e1000000-e100-e100-e100-e10000000002'),
  -- An anonymised/deleted account: auth_user_id nulled (the real shape a
  -- deleted player has, per delete_account — see supabase/migrations/
  -- 20260726000013_s6x_delete_account.sql). Must be excluded from the fan-out.
  ('pl_news_gone', '+201900004003', 'Deleted player', 'men', 'beginner', now(), null);

-- ════════════════════════════════════════════════════════════════════════════
-- A) create_news — admin-gated, validated.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e1000000-e100-e100-e100-e10000000001","role":"authenticated"}',true);
select is((public.create_news('Court resurfacing', 'Courts 1-2 closed next week.', null, false)->>'reason'), 'not_admin', 'A: a player cannot create news');

select set_config('request.jwt.claims','{"sub":"e0000000-e000-e000-e000-e00000000000","role":"authenticated"}',true);
select is((public.create_news('', 'body', null, false)->>'reason'), 'title_required', 'A: blank title rejected');
select is((public.create_news('title', '   ', null, false)->>'reason'), 'body_required', 'A: blank body rejected');

-- ════════════════════════════════════════════════════════════════════════════
-- B) notify_players=true — the fan-out, the review-critical part.
-- ════════════════════════════════════════════════════════════════════════════
-- Still role=authenticated with the admin claim set at the end of A) above.
select lives_ok($$ select public.create_news('Big announcement', 'Read all about it.', 'news/abc123.jpg', true) $$, 'B: admin creates news WITH notify');
reset role;

select is((select count(*)::int from public.news where title = 'Big announcement'), 1, 'B: the news row exists');
select is((select image_path from public.news where title = 'Big announcement'), 'news/abc123.jpg', 'B: image_path stored as the raw storage key, not a URL');

select is(
  (select count(*)::int from public.notifications where type = 'news_published'
     and news_id = (select id from public.news where title = 'Big announcement')),
  2, 'B: exactly TWO news_published notifications (the two active players, not the anonymised one)');
select is(
  (select count(*)::int from public.notifications n join public.players p on p.id = n.player_id
     where n.type = 'news_published' and p.id = 'pl_news_a'),
  1, 'B: player A got exactly one');
select is(
  (select count(*)::int from public.notifications n join public.players p on p.id = n.player_id
     where n.type = 'news_published' and p.id = 'pl_news_b'),
  1, 'B: player B got exactly one');
select is(
  (select count(*)::int from public.notifications where type = 'news_published' and player_id = 'pl_news_gone'),
  0, 'B: the anonymised/deleted player (auth_user_id null) got NONE');
select is(
  (select news_id from public.notifications where type = 'news_published' and player_id = 'pl_news_a'),
  (select id from public.news where title = 'Big announcement'),
  'B: the notification carries the news id (deep-link target)');
select is(
  (select title from public.notifications where type = 'news_published' and player_id = 'pl_news_a'),
  'Big announcement', 'B: the notification title mirrors the news title');

-- ════════════════════════════════════════════════════════════════════════════
-- C) notify_players=false — created silently, zero notifications.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e0000000-e000-e000-e000-e00000000000","role":"authenticated"}',true);
select lives_ok($$ select public.create_news('Quiet update', 'No push for this one.', null, false) $$, 'C: admin creates news WITHOUT notify');
reset role;

select is((select count(*)::int from public.news where title = 'Quiet update'), 1, 'C: the news row exists');
select is(
  (select count(*)::int from public.notifications where news_id = (select id from public.news where title = 'Quiet update')),
  0, 'C: zero notifications for a silent create');

-- ════════════════════════════════════════════════════════════════════════════
-- D) update_news — edits, never re-notifies.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e1000000-e100-e100-e100-e10000000001","role":"authenticated"}',true);
select is(
  (public.update_news((select id from public.news where title = 'Big announcement'), 'Hacked title', 'x', null)->>'reason'),
  'not_admin', 'D: a player cannot edit news');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e0000000-e000-e000-e000-e00000000000","role":"authenticated"}',true);
select is(
  (public.update_news('nw_does_not_exist', 'x', 'y', null)->>'reason'),
  'news_missing', 'D: editing a missing id fails cleanly');
select lives_ok(
  $$ select public.update_news((select id from public.news where title = 'Big announcement'), 'Big announcement (edited)', 'Updated body.', 'news/xyz789.jpg') $$,
  'D: admin edits the news item');
reset role;

select is((select title from public.news where id = (select id from public.news where title like 'Big announcement%')), 'Big announcement (edited)', 'D: title updated');
select is((select image_path from public.news where title = 'Big announcement (edited)'), 'news/xyz789.jpg', 'D: image_path updated');
select is(
  (select count(*)::int from public.notifications where news_id = (select id from public.news where title = 'Big announcement (edited)')),
  2, 'D: still exactly TWO notifications — the edit created no new ones (still the original fan-out from B)');

-- ════════════════════════════════════════════════════════════════════════════
-- E) delete_news — hard delete, news_seen CASCADEs, notifications.news_id SETS NULL.
-- ════════════════════════════════════════════════════════════════════════════
-- Seed a seen-row for the item we're about to delete (as postgres, RLS bypassed).
insert into public.news_seen (player_id, news_id, seen_at)
  values ('pl_news_a', (select id from public.news where title = 'Big announcement (edited)'), now());

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e1000000-e100-e100-e100-e10000000001","role":"authenticated"}',true);
select is(
  (public.delete_news((select id from public.news where title = 'Big announcement (edited)'))->>'reason'),
  'not_admin', 'E: a player cannot delete news');
reset role;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e0000000-e000-e000-e000-e00000000000","role":"authenticated"}',true);
select is(
  (public.delete_news('nw_does_not_exist')->>'reason'),
  'news_missing', 'E: deleting a missing id fails cleanly');

-- Capture the id before it's gone.
select lives_ok(
  $$ select public.delete_news((select id from public.news where title = 'Big announcement (edited)')) $$,
  'E: admin deletes the news item');
reset role;

select is((select count(*)::int from public.news where title = 'Big announcement (edited)'), 0, 'E: the news row is gone (hard delete)');
select is((select count(*)::int from public.news_seen where player_id = 'pl_news_a'), 0, 'E: the seen-row CASCADEd away with it');
select is(
  (select count(*)::int from public.notifications where type = 'news_published' and player_id in ('pl_news_a','pl_news_b') and news_id is null),
  2, 'E: the TWO notification rows survive — news_id SET NULL, not the row deleted (history preserved)');

-- ════════════════════════════════════════════════════════════════════════════
-- F) news RLS — any authenticated player SELECTs; only admins write.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"e1000000-e100-e100-e100-e10000000002","role":"authenticated"}';

select is((select count(*)::int from public.news where title = 'Quiet update'), 1, 'F: a player CAN read news (RLS select-all-authenticated)');
select throws_ok(
  $$ insert into public.news (id, title, body, created_by, created_at) values ('nw_hack', 'x', 'y', 'adm_news', now()) $$,
  '42501', null, 'F: a player cannot INSERT into news directly (RLS admin-only — WITH CHECK failure throws)');
-- UPDATE/DELETE are granted table-wide (mirrors packages/coaches); RLS's USING
-- clause then filters which EXISTING rows are visible to the command. Unlike
-- INSERT's WITH CHECK, a USING-blocked UPDATE/DELETE affects ZERO ROWS rather
-- than throwing — the same pattern rls_test.sql uses for packages/coaches.
with u as (update public.news set title = 'hacked' where title = 'Quiet update' returning 1)
select is((select count(*)::int from u), 0, 'F: a player''s UPDATE of news affects 0 rows (RLS admin-only)');
with d as (delete from public.news where title = 'Quiet update' returning 1)
select is((select count(*)::int from d), 0, 'F: a player''s DELETE of news affects 0 rows (RLS admin-only)');
select is((select title from public.news where title = 'Quiet update'), 'Quiet update', 'F: the row is genuinely untouched — title unchanged');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- G) news_seen RLS — the light-review check: own-row-only.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims to '{"sub":"e1000000-e100-e100-e100-e10000000001","role":"authenticated"}';

select lives_ok(
  $$ insert into public.news_seen (player_id, news_id) values ('pl_news_a', (select id from public.news where title = 'Quiet update')) $$,
  'G: player A can insert their OWN seen-row');
select throws_ok(
  $$ insert into public.news_seen (player_id, news_id) values ('pl_news_b', (select id from public.news where title = 'Quiet update')) $$,
  '42501', null, 'G: player A CANNOT insert a seen-row for player B (own-row-only holds)');
select is((select count(*)::int from public.news_seen where player_id = 'pl_news_a'), 1, 'G: A sees their own seen-row');
select is((select count(*)::int from public.news_seen where player_id = 'pl_news_b'), 0, 'G: A cannot read B''s seen-rows (RLS select own-only)');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- H) the 30-day visibility window — a query-side filter, not RLS.
-- ════════════════════════════════════════════════════════════════════════════
insert into public.news (id, title, body, created_by, created_at) values
  ('nw_old', 'Ancient news', 'From 40 days ago.', 'adm_news', now() - interval '40 days'),
  ('nw_recent', 'Fresh news', 'From yesterday.', 'adm_news', now() - interval '1 day');

select is(
  (select count(*)::int from public.news where id = 'nw_old' and created_at > now() - interval '30 days'),
  0, 'H: a 40-day-old item is excluded by the 30-day query filter');
select is(
  (select count(*)::int from public.news where id = 'nw_recent' and created_at > now() - interval '30 days'),
  1, 'H: a 1-day-old item is included by the 30-day query filter');
-- RLS itself still returns BOTH regardless of age — the window is query-side only.
set local role authenticated;
set local request.jwt.claims to '{"sub":"e1000000-e100-e100-e100-e10000000001","role":"authenticated"}';
select is((select count(*)::int from public.news where id in ('nw_old','nw_recent')), 2, 'H: RLS itself imposes no age limit — both rows are readable');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- I) credit expiry 30 -> 40, future purchases only.
-- ════════════════════════════════════════════════════════════════════════════
select is(tpa.credit_expiry(), interval '40 days', 'I: tpa.credit_expiry() is now 40 days');

-- A pre-existing batch, seeded as if minted BEFORE this migration (30-day span).
insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at) values
  ('cb_news_pre', 'pl_news_a', 'signup_grant', null, 'group', 2, 2, now() - interval '10 days' + interval '30 days', now() - interval '10 days');
select is(
  (select expires_at - created_at from public.credit_batches where id = 'cb_news_pre'),
  interval '30 days', 'I: the PRE-EXISTING batch keeps its original 30-day span — completely untouched');

-- A NEW purchase, minted now, must get 40 days.
insert into public.packages (id, training_type, session_count, price, name, is_active) values
  ('pk_news_test', 'group', 8, 280000, 'News Test Pack', true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e0000000-e000-e000-e000-e00000000000","role":"authenticated"}',true);
select lives_ok($$ select public.record_cash_purchase('pl_news_a', 'pk_news_test', 280000) $$, 'I: admin records a new cash purchase');
reset role;

select is(
  (select (cb.expires_at - cb.created_at) from public.credit_batches cb
     join public.purchases pu on pu.id = cb.purchase_id
     where pu.package_id = 'pk_news_test'),
  interval '40 days', 'I: the NEW batch gets a 40-day span');
-- And the old one is STILL untouched after the new mint (proves no blanket UPDATE ran anywhere).
select is(
  (select expires_at - created_at from public.credit_batches where id = 'cb_news_pre'),
  interval '30 days', 'I: the pre-existing batch is STILL 30 days after a new mint happened (no retroactive UPDATE anywhere)');

select * from finish();
rollback;
