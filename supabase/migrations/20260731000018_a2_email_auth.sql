-- ============================================================================
-- A2 — Consumer auth moves from phone-OTP to email/password.
--
-- The flow changes shape: the client now calls supabase.auth.signUp({email,password})
-- FIRST (GoTrue creates the auth user + owns the password), then calls complete_signup
-- to create the player row. So complete_signup stays a thin, idempotent profile-creator —
-- password handling never enters our code. Two DB changes are all it takes:
--   1. players.phone becomes nullable — email players have no phone at signup.
--   2. complete_signup no longer reads/writes phone (there is none on an email auth user).
--
-- Unchanged and still guaranteed: the 2-credit trial grant is idempotent (the partial
-- unique path + already_completed fast path), and an admin is still refused (A1's guard).
-- ============================================================================

-- ── players.phone: NOT NULL → nullable ──────────────────────────────────────
-- Was "login identity; one player per phone" under OTP. Email is the login identity now
-- (in auth.users), so a player may have no phone. The UNIQUE constraint stays: it still
-- forbids two players sharing a real phone, and Postgres treats NULLs as distinct so any
-- number of phone-less players coexist. delete_account's tombstone still writes
-- 'deleted:'||id (unique, no PII) — that write is unaffected by the column being nullable.
alter table public.players alter column phone drop not null;

-- ── complete_signup: drop the phone logic ───────────────────────────────────
-- Byte-identical to the A1 version EXCEPT the phone read + the phone insert column are
-- gone (an email auth user has no phone to normalise). The admin guard and the idempotent
-- trial-credit grant are kept verbatim.
create or replace function public.complete_signup(p_name text, p_gender text, p_level text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_player_id text;
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

  v_player_id := 'pl_' || gen_random_uuid();

  begin
    -- phone is omitted → NULL. Email players have no phone; it stays nullable.
    insert into public.players (id, name, gender, level, created_at, auth_user_id)
      values (v_player_id, btrim(p_name), p_gender, p_level, now(), v_uid);

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
