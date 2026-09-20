-- ============================================================================
-- News call-to-action link (pgTAP).
--
-- The link is optional, so the first thing to pin is that a post WITHOUT one is
-- untouched. After that it is all validation: http(s) only, enforced by a CHECK on
-- the table and not merely by the form, because the form is not the only caller.
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(23);

insert into auth.users (id) values ('0c0c0c0a-0000-0000-0000-0000000000aa');
insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('ad_link', '0c0c0c0a-0000-0000-0000-0000000000aa', 'Admin', now());

select has_column('public', 'news', 'link_url',   'news.link_url exists');
select has_column('public', 'news', 'link_label', 'news.link_label exists');
select col_is_null('public', 'news', 'link_url',   'link_url is optional');
select col_is_null('public', 'news', 'link_label', 'link_label is optional');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0c0c0c0a-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

-- ════════════════════════════════════════════════════════════════════════════
-- A post with a link
-- ════════════════════════════════════════════════════════════════════════════
select is(public.create_news('Update', 'Body', null, false, 'none', 'https://apps.apple.com/app/id123', 'Update the app')->>'ok',
  'true', 'a post can carry a link and a label');
select is((select link_url from public.news where title='Update'), 'https://apps.apple.com/app/id123', 'the URL is stored');
select is((select link_label from public.news where title='Update'), 'Update the app', 'the label is stored');

-- ════════════════════════════════════════════════════════════════════════════
-- A post without one is exactly as before
-- ════════════════════════════════════════════════════════════════════════════
select is(public.create_news('Plain', 'Body')->>'ok', 'true',
  'the legacy call still binds — an admin tab open from before this deploy keeps working');
select is((select link_url from public.news where title='Plain'), null, 'and stores no link');
select is((select link_label from public.news where title='Plain'), null, 'nor a label');

-- A label with no URL is dropped, not refused: it is a leftover in a form field.
select is(public.create_news('Labelled', 'Body', null, false, 'none', null, 'Dangling')->>'ok', 'true',
  'a label with no URL still publishes');
select is((select link_label from public.news where title='Labelled'), null, '…with the orphan label dropped');

-- A URL with no label is fine — the client supplies the wording.
select is(public.create_news('Bare', 'Body', null, false, 'none', 'https://example.com')->>'ok', 'true',
  'a URL with no label publishes');
select is((select link_label from public.news where title='Bare'), null,
  '…and leaves the label null for the client to default');

-- ════════════════════════════════════════════════════════════════════════════
-- Only http(s)
-- ════════════════════════════════════════════════════════════════════════════
select is(public.create_news('Bad1', 'Body', null, false, 'none', 'javascript:alert(1)')->>'reason', 'invalid_link',
  'a javascript: URL is refused');
select is(public.create_news('Bad2', 'Body', null, false, 'none', 'example.com')->>'reason', 'invalid_link',
  'a bare host with no scheme is refused');
select is(public.create_news('Bad3', 'Body', null, false, 'none', 'https://exa mple.com')->>'reason', 'invalid_link',
  'whitespace inside the URL is refused');
select is((select count(*)::int from public.news where title like 'Bad%'), 0,
  'and none of those created a news row');
reset role;

-- The CHECK is the real guarantee, not the RPC: a direct write cannot store one
-- either, whatever the caller.
select throws_ok(
  $$ insert into public.news (id, title, body, created_by, created_at, link_url)
       values ('nw_bad', 't', 'b', 'ad_link', now(), 'ftp://files.example.com') $$,
  '23514', null, 'the table itself rejects a non-http(s) scheme');

-- ════════════════════════════════════════════════════════════════════════════
-- Editing a link on and off
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0c0c0c0a-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
select is(public.update_news((select id from public.news where title='Plain'), 'Plain', 'Body', null, 'https://example.com/x', 'Read it')->>'ok',
  'true', 'a link can be added to an existing post');
select is((select link_url from public.news where title='Plain'), 'https://example.com/x', '…and is stored');
select is(public.update_news((select id from public.news where title='Plain'), 'Plain', 'Body', null, null, null)->>'ok',
  'true', 'and taken off again');
select is((select link_url from public.news where title='Plain'), null, '…clearing the URL');
reset role;

select * from finish();
rollback;
