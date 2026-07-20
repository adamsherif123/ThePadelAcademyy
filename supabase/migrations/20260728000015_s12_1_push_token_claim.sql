-- ============================================================================
-- S12.1 — device_push_tokens: sign-out cleanup + shared-device reassignment.
--
-- A physical device's Expo token is UNIQUE and can move between players (same phone,
-- a different account signs in). It CANNOT be reassigned by a direct client UPDATE:
-- reads are own-only (a token must never be readable across players), and an
-- `UPDATE ... WHERE expo_push_token = ?` needs SELECT visibility of the row — so
-- player B literally can't see (or claim) the row player A registered. So registration
-- goes through register_push_token: a SECURITY DEFINER RPC that resolves the caller via
-- current_player_id() (never a player_id argument), and reassigns-or-inserts as the
-- definer. Same "resolve identity server-side, write through an RPC" shape as every
-- other mutation — and still no service_role key in the client.
--
-- Plus DELETE-own, so sign-out / account deletion can drop THIS device's token (the
-- caller owns it, so own-only SELECT sees it) without touching another device's row.
-- ============================================================================

grant delete on public.device_push_tokens to authenticated;

create policy device_push_tokens_delete_own on public.device_push_tokens
  for delete to authenticated
  using (player_id = (select public.current_player_id()));

create or replace function public.register_push_token(p_token text, p_platform text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_player text := public.current_player_id();
begin
  if v_player is null then return jsonb_build_object('ok', false, 'reason', 'not_authenticated'); end if;
  if p_platform not in ('ios', 'android') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_platform');
  end if;

  -- One physical device → one row (expo_push_token is UNIQUE). Claim it for the caller
  -- (reassigning from any previous player on this shared device), keeping the row's id
  -- and created_at; or insert it fresh.
  update public.device_push_tokens
     set player_id = v_player, platform = p_platform, last_seen_at = now()
   where expo_push_token = p_token;
  if not found then
    insert into public.device_push_tokens (id, player_id, expo_push_token, platform, created_at, last_seen_at)
    values ('dpt_' || gen_random_uuid(), v_player, p_token, p_platform, now(), now());
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.register_push_token(text, text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;
