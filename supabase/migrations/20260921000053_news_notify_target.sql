-- ============================================================================
-- News: choose who gets the push — players, coaches, both, or nobody.
--
-- Until now publishing news either pushed to EVERY active account or to none.
-- Now that some of those accounts are coaches (players.coach_id, migration 049),
-- "all players" and "all coaches" are different audiences and an announcement is
-- usually meant for one of them.
--
-- ── the groups ──
-- A coach IS a player, so the two groups are a partition of the same table:
--   players  → coach_id is null
--   coaches  → coach_id is not null
--   both     → no filter
-- Every one of them keeps the existing `auth_user_id is not null` condition, which
-- is what excludes an anonymised/deleted account (it can never sign in again).
--
-- ── backward compatible on purpose ──
-- The admin is a single-page app that people leave open for hours. A bundle loaded
-- before this deploys still calls create_news with four named arguments, so that
-- call must keep working rather than 404 until someone reloads. The old
-- `p_notify_players` boolean therefore stays exactly where it was, as the fourth
-- parameter, and the new target is a FIFTH with a default — a four-argument call
-- still binds, and behaves precisely as it does today.
--
-- One function, not two: create-or-replace cannot add a parameter (it would leave
-- the old body in place beside the new one as an overload, and two fan-outs to
-- keep in step), so the old signature is dropped first — the same move migration
-- 043 made for coach_hours_coached, and what makes this replacement additive in
-- effect rather than a fork.
--
-- Nothing re-notifies. This changes only what the CREATE path does from here on;
-- existing news rows and their notifications are untouched.
-- ============================================================================

drop function if exists public.create_news(text, text, text, boolean);

create or replace function public.create_news(
  p_title          text,
  p_body           text,
  p_image_path     text    default null,
  p_notify_players boolean default false,
  -- 'none' | 'players' | 'coaches' | 'both'. NULL means "an older client called
  -- this", and the boolean above decides — true meaning everybody, exactly as it
  -- did before there was anyone but players.
  p_notify_target  text    default null
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
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;
  v_admin := (select id from public.admins where auth_user_id = (select auth.uid()));

  if p_title is null or btrim(p_title) = '' then return jsonb_build_object('ok', false, 'reason', 'title_required'); end if;
  if p_body  is null or btrim(p_body)  = '' then return jsonb_build_object('ok', false, 'reason', 'body_required');  end if;
  -- Validated rather than silently treated as 'none': a typo in the target should
  -- come back as a reason the UI can show, not as an announcement nobody receives.
  if v_target not in ('none', 'players', 'coaches', 'both') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_target');
  end if;

  insert into public.news (id, title, body, image_path, created_by, created_at)
    values (v_news_id, btrim(p_title), btrim(p_body), p_image_path, v_admin, now());

  -- The fan-out: one row per recipient (auth_user_id is null for an
  -- anonymised/deleted account — it can never sign back in, so it's excluded),
  -- one INSERT statement, one push-trigger firing per row. Title/body are frozen
  -- copies of the news item at publish time, same as every other tpa.notify call
  -- site — an edit afterwards does not touch these rows.
  --
  -- The audience is the ONLY thing that changed: one extra predicate on the same
  -- statement, rather than a second fan-out per group.
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

revoke all on function public.create_news(text, text, text, boolean, text) from public, anon;
grant execute on function public.create_news(text, text, text, boolean, text) to authenticated;
