-- ============================================================================
-- A1 — Separate admin identity from player identity (🔒 security core).
--
-- Before: an admin was a `players` row with is_admin = true; is_admin() read that
-- flag and every policy/RPC keyed authority off it. After: an admin is an `auth.users`
-- row linked to a `public.admins` record and NO player row. is_admin() reads `admins`,
-- never players. The invariants this migration makes true at the DB level:
--   * a player has NO write path to admin-ness (admins is out-of-band-only);
--   * an admin has NO player identity — current_player_id() is NULL for them, so they
--     act on player data ONLY through is_admin() policies, never as a player;
--   * the two never cross — complete_signup refuses an admin, so an admin auth user can
--     never also become a player.
--
-- Nothing else changes: every admin RPC already gated on is_admin() ALONE (none resolve
-- current_player_id() for the admin — admin_book_player takes the target player as an
-- argument), and current_player_id() already returns NULL for an auth user with no
-- player row. So this migration touches is_admin(), complete_signup, and the identity
-- store — and the whole authority graph follows.
-- ============================================================================

-- ── admins: the new identity store ──────────────────────────────────────────
-- Created OUT-OF-BAND ONLY (SQL / service_role). There is NO insert/update/delete grant
-- to any client role and NO write policy below, so no API, RLS policy, or RPC can create
-- an admin — the same "promotion is a deliberate, owner-run action" guarantee is_admin
-- had, now structural. auth_user_id UNIQUE = at most one admin per auth user.
create table public.admins (
  id            text primary key,                                   -- adm_… supplied out-of-band, no default
  auth_user_id  uuid not null unique references auth.users (id) on delete cascade,
  display_name  text not null,
  created_at    timestamptz not null
);

alter table public.admins enable row level security;
-- Clear Supabase's default grants on this NEW table BEFORE handing back only SELECT
-- (the S12 lesson: a new public table auto-grants authenticated full INSERT/UPDATE/DELETE).
revoke all on public.admins from anon, authenticated;
grant select on public.admins to authenticated;
-- An admin reads ONLY their own admin row (the app renders a display name from it). No
-- one reads another admin's row; no client role may write it — admins are made by SQL.
create policy admins_select_self on public.admins
  for select to authenticated
  using (auth_user_id = (select auth.uid()));

-- ── is_admin() now reads admins, never players.is_admin ─────────────────────
-- SECURITY DEFINER (reads admins past its own RLS), search_path pinned — same hardening
-- as before. current_player_id() is UNCHANGED: it already returns NULL for an auth user
-- with no player row, which is exactly an admin.
create or replace function public.is_admin()
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (select 1 from public.admins where auth_user_id = (select auth.uid()))
$$;

-- ── complete_signup refuses an admin — the other direction of separation ────
-- The ONLY player-creating RPC. Guarded so an admin auth user can never ALSO become a
-- player. Body is otherwise byte-identical to S8.
create or replace function public.complete_signup(p_name text, p_gender text, p_level text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_player_id text;
  v_phone     text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  -- An admin identity can never become a player (A1 separation).
  if public.is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'is_admin');
  end if;

  -- Idempotent fast path: this auth user already has a player.
  select id into v_player_id from public.players where auth_user_id = v_uid;
  if found then
    return jsonb_build_object('ok', true, 'already_completed', true, 'player_id', v_player_id);
  end if;

  if p_name is null or btrim(p_name) = '' then
    return jsonb_build_object('ok', false, 'reason', 'name_required');
  end if;
  if p_gender not in ('men', 'ladies') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_gender');
  end if;
  if p_level not in ('beginner', 'adv_beginner', 'intermediate') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_level');
  end if;

  select phone into v_phone from auth.users where id = v_uid;
  if v_phone is not null and left(v_phone, 1) <> '+' then
    v_phone := '+' || v_phone;
  end if;

  v_player_id := 'pl_' || gen_random_uuid();

  begin
    insert into public.players (id, phone, name, gender, level, created_at, auth_user_id)
      values (v_player_id, v_phone, btrim(p_name), p_gender, p_level, now(), v_uid);

    insert into public.credit_batches
      (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at, note)
    values
      ('cb_' || gen_random_uuid(), v_player_id, 'signup_grant', null, 'trial',
       tpa.signup_trial_credits(), tpa.signup_trial_credits(), now() + tpa.credit_expiry(), now(), null);
  exception
    when unique_violation then
      select id into v_player_id from public.players where auth_user_id = v_uid;
      return jsonb_build_object('ok', true, 'already_completed', true, 'player_id', v_player_id);
  end;

  return jsonb_build_object('ok', true, 'already_completed', false, 'player_id', v_player_id);
end;
$$;

-- ── migrate existing admins, then drop the flag ─────────────────────────────
-- Move any player flagged is_admin=true into the new identity, then SEVER their player
-- identity so each auth user is cleanly an admin OR a player, never both. FK-safe: the
-- old player's financial records survive, re-attributed to a retired (auth-less,
-- deleted) player row — exactly delete_account's anonymise-and-retain shape. On an EMPTY
-- database (a fresh `db reset` for the test suite) both statements match zero rows.
insert into public.admins (id, auth_user_id, display_name, created_at)
  select 'adm_' || gen_random_uuid(), p.auth_user_id, p.name, now()
    from public.players p
   where p.is_admin = true and p.auth_user_id is not null
  on conflict (auth_user_id) do nothing;

update public.players
   set auth_user_id = null,
       deleted_at   = coalesce(deleted_at, now()),
       name         = 'Deleted player',
       phone        = 'deleted:' || id
 where is_admin = true;

-- Nothing reads players.is_admin now (is_admin() rewritten) and no index/constraint
-- depends on it (only players_pkey / players_phone_key / players_auth_user_id_key
-- exist). Drop it so the old model is gone and cannot be half-used.
alter table public.players drop column is_admin;
