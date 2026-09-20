-- ============================================================================
-- News: an optional call-to-action link.
--
-- A post can now carry a URL and the words to put on the button — "Update the app"
-- → an App Store link — instead of a bare address sitting in the prose. Both
-- columns are nullable and every existing post has them null, so a post without a
-- link renders exactly as it does today.
--
-- ── why a field and not auto-linkified prose ──
-- Detecting http(s) in the body would need no migration, but it gives a raw URL
-- mid-sentence rather than a labelled button, and it turns every future post's
-- body into something the renderer parses — so a stray address in prose silently
-- becomes a tap target. A field is explicit: the admin decides there is a link,
-- decides what it says, and nothing else in the text changes meaning.
--
-- ── the URL is constrained in the DATABASE, not just the form ──
-- The CHECK is the real guarantee: http(s) only, no whitespace, something after
-- the scheme. The RPCs validate the same rule first so a typo comes back as a
-- reason the admin can read, rather than as a raw 23514 — but the constraint is
-- what makes it impossible to store, whatever the caller does. A label cannot
-- exist without a URL, because a button with nothing behind it is not a state
-- worth having.
-- ============================================================================

alter table public.news add column link_url   text;
alter table public.news add column link_label text;

comment on column public.news.link_url is
  'Optional call-to-action URL. http(s) only — see news_link_shape.';
comment on column public.news.link_label is
  'What the button says. Null with a URL set is fine; the client falls back to a default.';

alter table public.news add constraint news_link_shape check (
  (link_url is null and link_label is null)
  or (link_url ~ '^https?://[^[:space:]]+$')
);

-- ── create_news ───────────────────────────────────────────────────────────────
-- The 053 body, with the link threaded through. Same backward-compatibility move:
-- the new parameters are appended with defaults and the old signature dropped, so
-- an admin bundle loaded before this deploys still binds and still works.
drop function if exists public.create_news(text, text, text, boolean, text);

create or replace function public.create_news(
  p_title          text,
  p_body           text,
  p_image_path     text    default null,
  p_notify_players boolean default false,
  p_notify_target  text    default null,
  p_link_url       text    default null,
  p_link_label     text    default null
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_admin   text;
  v_news_id text := 'nw_' || gen_random_uuid();
  v_target  text := coalesce(p_notify_target, case when p_notify_players then 'both' else 'none' end);
  v_url     text := nullif(btrim(coalesce(p_link_url, '')), '');
  v_label   text := nullif(btrim(coalesce(p_link_label, '')), '');
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;
  v_admin := (select id from public.admins where auth_user_id = (select auth.uid()));

  if p_title is null or btrim(p_title) = '' then return jsonb_build_object('ok', false, 'reason', 'title_required'); end if;
  if p_body  is null or btrim(p_body)  = '' then return jsonb_build_object('ok', false, 'reason', 'body_required');  end if;
  if v_target not in ('none', 'players', 'coaches', 'both') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_target');
  end if;
  -- Same rule as the constraint, reported as something the admin can act on.
  if v_url is not null and v_url !~ '^https?://[^[:space:]]+$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_link');
  end if;
  -- A label with no URL is dropped rather than refused: it is a leftover in a form
  -- field, not a mistake worth blocking a publish over.
  if v_url is null then v_label := null; end if;

  insert into public.news (id, title, body, image_path, created_by, created_at, link_url, link_label)
    values (v_news_id, btrim(p_title), btrim(p_body), p_image_path, v_admin, now(), v_url, v_label);

  -- The fan-out: one row per recipient (auth_user_id is null for an
  -- anonymised/deleted account — it can never sign back in, so it's excluded),
  -- one INSERT statement, one push-trigger firing per row. Title/body are frozen
  -- copies of the news item at publish time.
  if v_target <> 'none' then
    insert into public.notifications (id, player_id, type, news_id, title, body, created_at)
    select 'nt_' || gen_random_uuid(), p.id, 'news_published', v_news_id, btrim(p_title), btrim(p_body), now()
    from public.players p
    where p.auth_user_id is not null
      and (
        v_target = 'both'
        or (v_target = 'players' and p.coach_id is null)
        or (v_target = 'coaches' and p.coach_id is not null)
      );
  end if;

  return jsonb_build_object('ok', true, 'news_id', v_news_id);
end;
$$;

revoke all on function public.create_news(text, text, text, boolean, text, text, text) from public, anon;
grant execute on function public.create_news(text, text, text, boolean, text, text, text) to authenticated;

-- ── update_news ───────────────────────────────────────────────────────────────
-- Editing still never re-notifies; the link simply joins title/body/image as a
-- mutable field, so a link can be added to an existing post or taken off one.
drop function if exists public.update_news(text, text, text, text);

create or replace function public.update_news(
  p_news_id    text,
  p_title      text,
  p_body       text,
  p_image_path text,
  p_link_url   text default null,
  p_link_label text default null
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_url   text := nullif(btrim(coalesce(p_link_url, '')), '');
  v_label text := nullif(btrim(coalesce(p_link_label, '')), '');
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;

  if p_title is null or btrim(p_title) = '' then return jsonb_build_object('ok', false, 'reason', 'title_required'); end if;
  if p_body  is null or btrim(p_body)  = '' then return jsonb_build_object('ok', false, 'reason', 'body_required');  end if;
  if v_url is not null and v_url !~ '^https?://[^[:space:]]+$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_link');
  end if;
  if v_url is null then v_label := null; end if;

  update public.news
     set title = btrim(p_title), body = btrim(p_body), image_path = p_image_path,
         link_url = v_url, link_label = v_label
   where id = p_news_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'news_missing'); end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.update_news(text, text, text, text, text, text) from public, anon;
grant execute on function public.update_news(text, text, text, text, text, text) to authenticated;
