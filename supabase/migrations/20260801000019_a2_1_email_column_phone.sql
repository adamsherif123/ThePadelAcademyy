-- ============================================================================
-- A2.1 — Store the player's email on the row + optional phone at signup.
--
-- A2 kept email only on auth.users. Two things need it queryable on the player row:
--   * the new-vs-existing routing check at the sign-in screen (email_has_account), and
--   * the admin's email search (A2 deferred it — no column existed).
-- Email, like phone under OTP, is set SERVER-SIDE in complete_signup from the
-- authenticated user (auth.users.email via auth.uid()), never a client argument. Phone
-- becomes an OPTIONAL create-account field, normalised to +20 E.164 and UNIQUE.
-- ============================================================================

-- ── players.email — nullable + UNIQUE (one player per email, mirrors auth) ───
-- Nullable: a retired/anonymised player has no email; and it's set by complete_signup,
-- not at insert. UNIQUE: one player per email, the same shape auth.users enforces. NULLs
-- are distinct in Postgres, so any number of email-less rows coexist.
alter table public.players add column email text;

-- Backfill live players from their auth user. auth.users.email is unique and there is one
-- player per auth_user_id, so this can't create a duplicate. Retired rows (auth_user_id
-- null) stay null. On an empty db (a fresh reset) this matches zero rows.
update public.players p
   set email = u.email
  from auth.users u
 where u.id = p.auth_user_id
   and p.email is null;

alter table public.players add constraint players_email_key unique (email);

-- ── delete_account: also null the email (PII) in the tombstone ───────────────
-- A2's tombstone anonymised name/phone; email is new PII to remove on deletion. Same
-- anonymise-and-retain shape, one extra column. (create or replace keeps the grants.)
create or replace function public.delete_account()
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_player text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  select id into v_player from public.players where auth_user_id = v_uid for update;
  if not found then
    return jsonb_build_object('ok', true, 'already_deleted', true);
  end if;

  update public.session_slots s
     set booked_count = greatest(0, s.booked_count - 1)
    from public.bookings b
   where b.player_id = v_player
     and b.status = 'booked'
     and b.slot_id = s.id
     and s.starts_at > now();

  update public.bookings
     set status = 'cancelled', cancelled_at = now()
   where player_id = v_player
     and status = 'booked'
     and slot_id in (select id from public.session_slots where starts_at > now());

  update public.players
     set name         = 'Deleted player',
         phone        = 'deleted:' || id,   -- unique (id is the PK), no PII
         email        = null,               -- A2.1: drop the email PII too
         deleted_at   = now(),
         auth_user_id = null                -- satisfies RESTRICT; auth row can now go
   where id = v_player;

  return jsonb_build_object('ok', true, 'already_deleted', false, 'player_id', v_player);
end;
$$;

-- ── complete_signup(name, gender, level, phone?) ────────────────────────────
-- Now 4-arg (phone optional, defaults null), so the signature changes — drop the 3-arg
-- and re-grant. Sets email from the auth user (server-side), normalises + validates an
-- optional Egyptian mobile to +20 E.164, and maps the phone UNIQUE violation to a clean
-- phone_taken reason. Still admin-refusing, still idempotent, still grants 2 trial credits.
drop function if exists public.complete_signup(text, text, text);

create function public.complete_signup(p_name text, p_gender text, p_level text, p_phone text default null)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_player_id  text;
  v_email      text;
  v_phone      text;
  v_constraint text;
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

  -- Email is the VERIFIED auth identity, taken from the session — never a client arg.
  select email into v_email from auth.users where id = v_uid;

  -- Optional phone: normalise to +20 E.164 (digits only → drop leading zeros → ensure the
  -- 20 country code → '+'), then validate as an Egyptian mobile. This is string formatting,
  -- NOT the removed OTP path. Blank/absent → null (phone stays optional).
  if p_phone is not null and btrim(p_phone) <> '' then
    v_phone := regexp_replace(p_phone, '[^0-9]', '', 'g');
    v_phone := regexp_replace(v_phone, '^0+', '');
    if left(v_phone, 2) <> '20' then
      v_phone := '20' || v_phone;
    end if;
    v_phone := '+' || v_phone;
    if v_phone !~ '^\+201[0-9]{9}$' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_phone');
    end if;
  end if;

  v_player_id := 'pl_' || gen_random_uuid();

  begin
    insert into public.players (id, email, phone, name, gender, level, created_at, auth_user_id)
      values (v_player_id, v_email, v_phone, btrim(p_name), p_gender, p_level, now(), v_uid);

    insert into public.credit_batches
      (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at, note)
    values
      ('cb_' || gen_random_uuid(), v_player_id, 'signup_grant', null, 'trial',
       tpa.signup_trial_credits(), tpa.signup_trial_credits(), now() + tpa.credit_expiry(), now(), null);
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      -- A taken phone is a clean, retryable business reason (the field is optional).
      if v_constraint = 'players_phone_key' then
        return jsonb_build_object('ok', false, 'reason', 'phone_taken');
      end if;
      -- Otherwise a concurrent double-submit raced on auth_user_id/email → idempotent.
      select id into v_player_id from public.players where auth_user_id = v_uid;
      return jsonb_build_object('ok', true, 'already_completed', true, 'player_id', v_player_id);
  end;

  return jsonb_build_object('ok', true, 'already_completed', false, 'player_id', v_player_id);
end;
$$;

revoke all on function public.complete_signup(text, text, text, text) from public;
grant execute on function public.complete_signup(text, text, text, text) to authenticated;

-- ── email_has_account(email) — the one-bit existence check for sign-in routing ─
-- Adam's decision (A2.1): a server-side existence check is worth the tiny enumeration
-- surface for the academy's threat model. It exposes EXACTLY one boolean — does a LIVE
-- player row exist for this email — and nothing else (no name, no id, no admin-ness). An
-- admin has no player row, so this is naturally false for an admin email, and the consumer
-- flow then routes them to create-account, where signUp/complete_signup refuse them (A1)
-- and they land on the not-a-player screen. Callable by anon: the caller is on the
-- unauthenticated sign-in screen. SECURITY DEFINER + pinned search_path (reads players
-- past RLS to answer the one bit).
create or replace function public.email_has_account(p_email text)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1
      from public.players
     where deleted_at is null
       and email is not null
       and lower(email) = lower(btrim(p_email))
  )
$$;

revoke all on function public.email_has_account(text) from public;
grant execute on function public.email_has_account(text) to anon, authenticated;
