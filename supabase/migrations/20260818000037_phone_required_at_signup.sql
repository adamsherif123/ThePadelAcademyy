-- ============================================================================
-- Phone becomes REQUIRED at signup (complete_signup only) — a blank/absent
-- phone now rejects cleanly with 'phone_required', checked before the
-- existing normalise + format validation. update_profile is UNTOUCHED: an
-- existing player may still add, change, or clear their phone after signup
-- (its own migration documents this as a deliberate, separate contract —
-- players who signed up before this change may legitimately have no phone).
-- Every other line of complete_signup is byte-identical to the live A5 body.
-- ============================================================================

create or replace function public.complete_signup(
  p_name text, p_gender text, p_level text, p_phone text default null, p_trained_before boolean default null
)
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
  if public.is_admin() then
    return jsonb_build_object('ok', false, 'reason', 'is_admin');
  end if;
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

  select email into v_email from auth.users where id = v_uid;

  -- NEW: phone is now required at signup — checked before the normalise/format
  -- validation below, which is otherwise untouched.
  if p_phone is null or btrim(p_phone) = '' then
    return jsonb_build_object('ok', false, 'reason', 'phone_required');
  end if;

  v_phone := regexp_replace(p_phone, '[^0-9]', '', 'g');
  v_phone := regexp_replace(v_phone, '^0+', '');
  if left(v_phone, 2) <> '20' then
    v_phone := '20' || v_phone;
  end if;
  v_phone := '+' || v_phone;
  if v_phone !~ '^\+201[0-9]{9}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_phone');
  end if;

  v_player_id := 'pl_' || gen_random_uuid();

  begin
    -- A5: NO credits are minted at signup. A new player starts with zero and buys a trial.
    insert into public.players (id, email, phone, name, gender, level, created_at, auth_user_id, trained_before)
      values (v_player_id, v_email, v_phone, btrim(p_name), p_gender, p_level, now(), v_uid, p_trained_before);
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'players_phone_key' then
        return jsonb_build_object('ok', false, 'reason', 'phone_taken');
      end if;
      select id into v_player_id from public.players where auth_user_id = v_uid;
      return jsonb_build_object('ok', true, 'already_completed', true, 'player_id', v_player_id);
  end;

  return jsonb_build_object('ok', true, 'already_completed', false, 'player_id', v_player_id);
end;
$$;

revoke all on function public.complete_signup(text, text, text, text, boolean) from public;
grant execute on function public.complete_signup(text, text, text, text, boolean) to authenticated;
