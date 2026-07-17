-- ============================================================================
-- S8 — real auth. Everything until now used synthetic request.jwt.claims; this
-- wires players to auth.users and adds the one RPC that turns a freshly-verified
-- phone into a player with their free trial credits.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- TASK 1 — the auth.users FK (deferred from S5 so the delete semantics were owned
-- here). ON DELETE RESTRICT, never CASCADE: a player's bookings, purchases and
-- credit batches are the academy's FINANCIAL RECORDS, and cascading an auth-user
-- delete into them would let a dashboard click silently erase revenue history.
-- RESTRICT forces any deletion to be deliberate. auth_user_id is already nullable —
-- that is exactly what the eventual anonymise-then-delete flow (S8 Task 6) needs:
-- null the link (keeping the financial record), THEN drop the now-unreferenced auth
-- user. NOT VALID + VALIDATE isn't needed — the table is empty at migration time.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.players
  add constraint players_auth_user_id_fkey
  foreign key (auth_user_id) references auth.users (id) on delete restrict;

-- ─────────────────────────────────────────────────────────────────────────────
-- TASK 2 — the third constant crossing the SQL/TS boundary: SIGNUP_TRIAL_CREDITS.
-- Mirrors @tpa/core constants.ts (= 2). One SQL home in the tpa schema, same as
-- tpa.credit_expiry() / tpa.cancellation_window(); sql-parity.test.ts asserts the
-- value matches. (No occurrence-guard here — unlike the interval literals, a bare
-- `2` isn't distinctive enough to detect inlining; the value-parity test is the
-- guard. See the report.)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function tpa.signup_trial_credits()
  returns integer language sql immutable
  as $$ select 2 $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TASK 2 — complete_signup: an RPC, NOT an auth.users trigger. A trigger fires at
-- OTP time, before the profile-setup screen exists — but players.name/gender/level
-- are NOT NULL and don't exist yet, so a trigger would have to invent placeholders
-- or the columns would go nullable. A NULLABLE gender is a SECURITY HOLE: book_slot
-- tests `v_slot.gender <> v_pgender`, and with a NULL player gender that yields NULL
-- (not true), so the mismatch check silently passes and the player books into any
-- group. So the profile arrives from a real screen, after verification, through
-- this RPC — one transaction: create the player (pl_ id, no DB default), then grant
-- the 2 free trial credits (expiring via tpa.credit_expiry(), like everything else).
--
-- IDEMPOTENT two ways, both structural: (a) the auth_user_id UNIQUE constraint makes
-- a second player row impossible; (b) the partial unique index on
-- (player_id) WHERE source='signup_grant' makes a second grant impossible. The fast
-- path returns the existing player; a concurrent double-call is caught as a
-- unique_violation and returns the same player — never a second grant.
--
-- Between OTP and this call the user is authenticated with NO player row, so
-- current_player_id() is NULL and every RLS policy denies them. That is correct and
-- verified (auth_test.sql / auth_session.sh), not worked around.
-- ─────────────────────────────────────────────────────────────────────────────
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

  -- Idempotent fast path: this auth user already has a player.
  select id into v_player_id from public.players where auth_user_id = v_uid;
  if found then
    return jsonb_build_object('ok', true, 'already_completed', true, 'player_id', v_player_id);
  end if;

  -- Validate the profile so callers get data, not a raw 23514 from the CHECKs.
  if p_name is null or btrim(p_name) = '' then
    return jsonb_build_object('ok', false, 'reason', 'name_required');
  end if;
  if p_gender not in ('men', 'ladies') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_gender');
  end if;
  if p_level not in ('beginner', 'adv_beginner', 'intermediate') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_level');
  end if;

  -- The phone is the VERIFIED auth identity, never a caller argument. Normalise to a
  -- leading '+' (GoTrue stores digits-only) so players.phone stays E.164 like the
  -- rest of the app.
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
      -- A concurrent complete_signup won (auth_user_id UNIQUE or the signup_grant
      -- partial index). Return the existing player — never double-grant.
      select id into v_player_id from public.players where auth_user_id = v_uid;
      return jsonb_build_object('ok', true, 'already_completed', true, 'player_id', v_player_id);
  end;

  return jsonb_build_object('ok', true, 'already_completed', false, 'player_id', v_player_id);
end;
$$;

-- Only an authenticated (post-OTP) user completes their own signup. Not anon.
revoke all on function public.complete_signup(text, text, text) from public;
grant execute on function public.complete_signup(text, text, text) to authenticated;
