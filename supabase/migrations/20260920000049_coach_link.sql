-- ============================================================================
-- Coach mode, phase 1 — the link between a login and a coach record.
--
-- Coaches have never had an identity: `coaches` is (id, name, bio, photo_url,
-- is_active) with no auth_user_id, created and edited by admins, pointed at by
-- session_slots.coach_id and availability_templates.coach_id. A coach who needs to
-- see their own schedule therefore needs a LOGIN, and the app needs to know which
-- coaches row that login is.
--
-- ── one column, not two ──
-- This adds players.coach_id and NO is_coach boolean. `coach_id is not null` IS the
-- flag, which makes the two contradictory states unrepresentable: a flagged coach
-- with nothing to show, and a link nobody reads. The shape otherwise mirrors
-- is_owner (044): a column, a partial index over the handful of flagged rows, and
-- a helper the rest of the system asks instead of re-deriving the predicate.
--
-- ── strictly additive ──
-- session_slots.coach_id still references coaches(id). coach_hours_coached is
-- untouched and still admin-gated. The admin's coach management, the public
-- "Meet the coaches" roster (coaches_select_active_public, readable by anon) and
-- every existing policy are unchanged. Nothing reads coach_id yet except the
-- helper and the admin control added here.
-- ============================================================================

alter table public.players
  add column coach_id text references public.coaches(id);

comment on column public.players.coach_id is
  'The coaches row this login IS, or null for an ordinary player. Non-null is the coach flag — there is deliberately no separate is_coach boolean.';

-- UNIQUE, partial: one coaches record maps to AT MOST ONE login. Two player
-- accounts claiming the same coach would both show the same schedule and the same
-- payroll hours, with no way to tell which is the real one — a state worth making
-- impossible in the database rather than policing in the admin UI. Partial, so the
-- overwhelming majority of players (coach_id null) are not indexed and are not
-- constrained by it.
create unique index players_coach_id_key
  on public.players (coach_id) where coach_id is not null;

-- ── the helper ────────────────────────────────────────────────────────────────
-- The exact mirror of current_player_id(): auth.uid() → the caller's player row →
-- their coach link. Null for a player with no link, and null for an admin
-- credential (which has no player row at all), so "is the caller a coach" is one
-- question with one answer everywhere it is asked.
create or replace function public.current_coach_id()
  returns text
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select coach_id from public.players where auth_user_id = (select auth.uid())
$$;

revoke all on function public.current_coach_id() from public;
grant execute on function public.current_coach_id() to anon, authenticated;

-- ── the admin write ───────────────────────────────────────────────────────────
-- There is no admin policy to UPDATE another player's row — only
-- players_update_self — and data/players.ts says so in as many words, returning
-- `not_supported` for admin profile edits. That stands: this does not add a broad
-- admin UPDATE policy on players. It is a SECURITY DEFINER RPC that writes exactly
-- ONE column, so the privilege granted is "an admin may set a player's coach link"
-- and nothing wider.
--
-- p_coach_id null clears the link (the "Not a coach" option).
create or replace function public.set_player_coach(p_player_id text, p_coach_id text default null)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    return jsonb_build_object('ok', false, 'reason', 'not_admin');
  end if;

  -- A retired player is not a candidate for a login of any kind.
  if not exists (
    select 1 from public.players where id = p_player_id and deleted_at is null
  ) then
    return jsonb_build_object('ok', false, 'reason', 'player_missing');
  end if;

  -- Validate the coach id rather than letting the FK raise: a typo should come back
  -- as a reason the UI can render, not a 23503 the client has to decode. An INACTIVE
  -- coach is deliberately still linkable — a coach on leave keeps their login.
  if p_coach_id is not null and not exists (
    select 1 from public.coaches where id = p_coach_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'coach_missing');
  end if;

  update public.players set coach_id = p_coach_id where id = p_player_id;

  return jsonb_build_object('ok', true, 'coach_id', p_coach_id);
exception
  -- players_coach_id_key: this coach already belongs to another login.
  when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'coach_taken');
end;
$$;

revoke all on function public.set_player_coach(text, text) from public, anon;
grant execute on function public.set_player_coach(text, text) to authenticated;
