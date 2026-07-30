-- ============================================================================
-- Edit profile — update_profile(name, gender, level, phone?)
--
-- The consumer app's edit-profile screen lets a player fix their name/gender/level
-- and add/replace (or clear) the optional phone. name/gender/level already have a
-- column-level UPDATE grant (20260716000002_rls.sql) a client could write directly,
-- but PHONE deliberately does NOT: that same migration's note spells out that a
-- client phone write is rejected at the privilege layer (42501), because phone needs
-- +20 E.164 normalisation and the UNIQUE / phone_taken handling that only
-- complete_signup performed. There was no RPC to update an existing player's phone
-- (complete_signup is create-only/idempotent), so adding a phone post-signup was
-- impossible client-side. This RPC is that missing piece.
--
-- It reuses complete_signup's EXACT phone normalisation + validation, so there is one
-- path, not two. Resolves the caller server-side via auth.uid() (never a player_id
-- argument) and updates only that player's own row. Returns {ok, reason} as DATA, the
-- same contract as complete_signup — a duplicate number is phone_taken, a malformed one
-- invalid_phone, never an HTTP error. Touches nothing else: not email (the auth
-- identity), not trained_before (a one-time signup self-report), not credits/bookings.
--
-- SECURITY DEFINER + pinned empty search_path (writes past RLS to the caller's own row,
-- resolved from auth.uid()), mirroring complete_signup. EXECUTE is revoked from PUBLIC
-- and granted only to authenticated — an anon caller can't reach it.
-- ============================================================================
create or replace function public.update_profile(
  p_name text,
  p_gender text,
  p_level text,
  p_phone text default null
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_player_id  text;
  v_phone      text;
  v_constraint text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  -- An admin identity has no player row (A1 separation) — nothing to update.
  if public.is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'is_admin');
  end if;

  -- The caller's OWN live player row. A missing/retired row is treated as "no player"
  -- (the caller isn't a player here) rather than a crash.
  select id into v_player_id
    from public.players
   where auth_user_id = v_uid and deleted_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_player');
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

  -- Optional phone: IDENTICAL normalisation to complete_signup (digits only → drop
  -- leading zeros → ensure the 20 country code → '+'), then validate as an Egyptian
  -- mobile. Blank/absent → null, so the player can also CLEAR a previously-set phone.
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

  begin
    update public.players
       set name   = btrim(p_name),
           gender = p_gender,
           level  = p_level,
           phone  = v_phone
     where id = v_player_id;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      -- Another player already has this number. Clean, retryable business reason —
      -- the field is optional, so the player can pick another or leave it blank.
      if v_constraint = 'players_phone_key' then
        return jsonb_build_object('ok', false, 'reason', 'phone_taken');
      end if;
      raise;
  end;

  return jsonb_build_object('ok', true, 'player_id', v_player_id);
end;
$$;

revoke all on function public.update_profile(text, text, text, text) from public;
grant execute on function public.update_profile(text, text, text, text) to authenticated;
