-- ============================================================================
-- News: an admin-authored announcement feed. Server + admin only this session —
-- the client feed/pop-up/nav button is a separate, later session; this migration
-- only builds what that session will consume (the tables, RLS, RPCs, storage
-- bucket, and the news_published notification type end-to-end).
--
-- ── news: no draft state ──
-- create = immediately visible. news has no `published`/`published_at` column;
-- `created_at` doubles as publish time. A no-draft model keeps the CRUD and the
-- client's 30-day visibility query trivial (one timestamp, one meaning); an admin
-- who publishes a mistake deletes it and republishes rather than un-drafting it.
--
-- ── news_seen: cascade on delete ──
-- FK to news is ON DELETE CASCADE — deleting a news item is a hard delete, and a
-- seen-row for a news item that no longer exists is meaningless, so it goes with
-- it. Composite PK (player_id, news_id): a row's mere existence means "this
-- player has seen this item"; there is nothing else to store per-row.
--
-- ── the 30-day visibility window lives in the QUERY, not RLS ──
-- news RLS just gates "any authenticated player may read every news row"; the
-- client session's read query/RPC applies `created_at > now() - interval '30
-- days'`. Keeping the window out of RLS means it can change (or become
-- per-request) without a migration, and admins browsing the News tab always see
-- full history regardless of the 30-day player-facing window.
--
-- ── notifications.news_id, not a jsonb payload ──
-- notifications has no generic metadata column — session-related types carry a
-- typed `slot_id`/`booking_id` FK. news_published needs the same: a nullable
-- `news_id` FK, added here. ON DELETE SET NULL (not CASCADE): a player's
-- notification HISTORY shouldn't be mass-deleted just because an admin later
-- deletes the news item — the inbox entry (title/body, already a frozen copy)
-- stays; only the deep-link target goes stale.
--
-- ── the notify fan-out bypasses tpa.notify on purpose ──
-- tpa.notify inserts exactly one row per call. Fanning out to every player via a
-- PL/pgSQL loop calling tpa.notify once per player is behaviourally identical to
-- one bulk `insert into notifications (...) select ... from players` — both
-- produce one row per player and (since notifications_send_push is a row-level
-- AFTER INSERT trigger with no WHEN clause) fire the push trigger once per
-- inserted row either way. The bulk form is one statement instead of N
-- function-call-plus-insert round trips, so create_news below inserts directly
-- rather than looping tpa.notify — still entirely inside this SECURITY DEFINER
-- function's trust boundary, so nothing about the security model changes; only
-- code-path efficiency does. tpa.notify itself is untouched (no news_id
-- parameter added to it) since nothing else calls it with one.
--
-- ── news-images bucket: mirrors coach-photos exactly ──
-- public=true (players view images), admin-only insert/update/delete via
-- is_admin(), same 5 MiB / jpeg|png|webp limits. Path convention differs from
-- coach-photos' <coachId>.<ext> on purpose: a news row's id doesn't exist until
-- AFTER create_news runs (server-generated, like every other RPC-created id in
-- this codebase — see record_cash_purchase's v_purchase_id), so the admin client
-- uploads FIRST under a random key (news/<uuid>.<ext>) and only then calls
-- create_news with the resulting path. There is no id-keyed upsert-overwrite
-- here the way coach-photos has one; on edit-with-a-new-image the admin client
-- is responsible for removing the old object (mirroring uploadCoachPhoto's own
-- proactive cleanup of stale variants).
-- ============================================================================

-- ── schema ────────────────────────────────────────────────────────────────────

create table public.news (
  id          text primary key,                                    -- nw_… server-generated (create_news), no default
  title       text not null,
  body        text not null,                                       -- plain text, no rich formatting
  image_path  text,                                                 -- nullable: a news item may be text-only; a news-images/ storage key, not a URL
  created_by  text not null references public.admins (id),
  created_at  timestamptz not null default now()
);

create index news_created_at_idx on public.news (created_at desc);

create table public.news_seen (
  player_id  text not null references public.players (id),
  news_id    text not null references public.news (id) on delete cascade,
  seen_at    timestamptz not null default now(),
  primary key (player_id, news_id)
);

alter table public.notifications add column news_id text references public.news (id) on delete set null;

-- Widen the type CHECK (established drop+recreate pattern).
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'session_confirmed', 'session_cancelled', 'removed_from_session',
    'session_rescheduled', 'credits_granted', 'credit_request_rejected',
    'admin_booked', 'session_reopened', 'news_published'));

-- ── storage: news-images bucket ──────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('news-images', 'news-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "news images are readable by anyone"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'news-images');

create policy "news images are insertable by admins"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'news-images' and public.is_admin());

create policy "news images are updatable by admins"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'news-images' and public.is_admin())
  with check (bucket_id = 'news-images' and public.is_admin());

create policy "news images are deletable by admins"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'news-images' and public.is_admin());

-- ── RLS: news ─────────────────────────────────────────────────────────────────

alter table public.news enable row level security;
revoke all on public.news from public;
grant select, insert, update, delete on public.news to authenticated;

create policy news_select_authenticated on public.news
  for select to authenticated
  using (true);   -- the 30-day window is a query-side filter (see header), not RLS

create policy news_insert_admin on public.news
  for insert to authenticated
  with check ((select public.is_admin()));

create policy news_update_admin on public.news
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy news_delete_admin on public.news
  for delete to authenticated
  using ((select public.is_admin()));

-- ── RLS: news_seen — own-row-only, no admin access ──────────────────────────
-- A player marks/reads only their own seen-rows. Nothing today needs an admin
-- to read seen-status, so (unlike news) there is no admin-select policy here —
-- RLS defaults to deny, so admins simply have no path to this table yet.

alter table public.news_seen enable row level security;
revoke all on public.news_seen from public;
grant select, insert on public.news_seen to authenticated;

create policy news_seen_select_own on public.news_seen
  for select to authenticated
  using (player_id = (select public.current_player_id()));

create policy news_seen_insert_own on public.news_seen
  for insert to authenticated
  with check (player_id = (select public.current_player_id()));

-- ── RPCs: admin CRUD ──────────────────────────────────────────────────────────

create or replace function public.create_news(
  p_title text, p_body text, p_image_path text default null, p_notify_players boolean default false
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_admin   text;
  v_news_id text := 'nw_' || gen_random_uuid();
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;
  v_admin := (select id from public.admins where auth_user_id = (select auth.uid()));

  if p_title is null or btrim(p_title) = '' then return jsonb_build_object('ok', false, 'reason', 'title_required'); end if;
  if p_body  is null or btrim(p_body)  = '' then return jsonb_build_object('ok', false, 'reason', 'body_required');  end if;

  insert into public.news (id, title, body, image_path, created_by, created_at)
    values (v_news_id, btrim(p_title), btrim(p_body), p_image_path, v_admin, now());

  -- The fan-out: one row per active player (auth_user_id is null for an
  -- anonymised/deleted account — it can never sign back in, so it's excluded),
  -- one INSERT statement, one push-trigger firing per row (see header). Title/
  -- body are frozen copies of the news item at publish time, same as every
  -- other tpa.notify call site — an edit afterwards does not touch these rows.
  if p_notify_players then
    insert into public.notifications (id, player_id, type, news_id, title, body, created_at)
    select 'nt_' || gen_random_uuid(), p.id, 'news_published', v_news_id, btrim(p_title), btrim(p_body), now()
    from public.players p
    where p.auth_user_id is not null;
  end if;

  return jsonb_build_object('ok', true, 'news_id', v_news_id);
end;
$$;

revoke all on function public.create_news(text, text, text, boolean) from public;
grant execute on function public.create_news(text, text, text, boolean) to authenticated;

-- Edit never re-notifies — only create does (RULES). Title/body/image are the
-- only mutable fields; created_by/created_at stay put (an edit isn't a republish).
create or replace function public.update_news(p_news_id text, p_title text, p_body text, p_image_path text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;

  if p_title is null or btrim(p_title) = '' then return jsonb_build_object('ok', false, 'reason', 'title_required'); end if;
  if p_body  is null or btrim(p_body)  = '' then return jsonb_build_object('ok', false, 'reason', 'body_required');  end if;

  update public.news set title = btrim(p_title), body = btrim(p_body), image_path = p_image_path
    where id = p_news_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'news_missing'); end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.update_news(text, text, text, text) from public;
grant execute on function public.update_news(text, text, text, text) to authenticated;

-- Hard delete — no retire state (unlike delete_package, nothing references news
-- by FK except news_seen, which CASCADEs, and notifications.news_id, which SETs
-- NULL). The manual-delete option, confirmed.
create or replace function public.delete_news(p_news_id text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;

  delete from public.news where id = p_news_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'news_missing'); end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.delete_news(text) from public;
grant execute on function public.delete_news(text) to authenticated;
