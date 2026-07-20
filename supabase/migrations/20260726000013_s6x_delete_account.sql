-- ============================================================================
-- S6.x — in-app account deletion (Apple Guideline 5.1.1(v), Google Play parity).
--
-- The model is ANONYMISE, NOT DESTROY. A player row is referenced by bookings,
-- purchases and credit_batches — the academy's FINANCIAL RECORDS. S8 gave
-- players.auth_user_id an ON DELETE RESTRICT FK and kept the column nullable for
-- exactly this: null the link (keeping the financial record), then drop the
-- now-unreferenced auth user. So deletion:
--   * anonymises the player — name → 'Deleted player', phone → a unique non-PII
--     sentinel (phone is NOT NULL + UNIQUE, so it can't be nulled; 'deleted:'||id
--     is unique and carries no PII), deleted_at → now();
--   * KEEPS gender/level — they are NOT NULL (can't be nulled) and are coarse,
--     non-identifying categories the academy keeps for aggregate stats;
--   * cancels the player's FUTURE bookings and frees those seats (a deleted player
--     must not hold a court), NO refund — they're abandoning the wallet;
--   * leaves PAST bookings, purchases (incl. a pending/abandoned one) and credit
--     batches intact, now attributed to the anonymised tombstone;
--   * nulls auth_user_id so the RESTRICT FK permits the auth.users delete (done by
--     the Edge Function via the Admin API — never here).
--
-- The RPC resolves the caller via auth.uid() and takes NO player_id argument: even
-- the Edge Function cannot delete anyone but the caller. Same "resolve identity
-- server-side, never trust the caller" rule as every money RPC.
-- ============================================================================

-- deleted_at: null for a live player, set at anonymisation. A partial tombstone
-- marker; the anonymised name/phone are the visible signal, this is the timestamp.
alter table public.players add column if not exists deleted_at timestamptz;

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

  -- Resolve + lock the caller's OWN player row. No argument path exists, so a caller
  -- can only ever reach their own row. The lock serialises a double-submit.
  select id into v_player from public.players where auth_user_id = v_uid for update;
  if not found then
    -- No live player for this auth user: already anonymised (auth_user_id nulled by a
    -- prior run) or never completed signup. Idempotent no-op — the Edge Function will
    -- still (re)attempt the auth-user delete, which is what makes a mid-way failure
    -- recoverable.
    return jsonb_build_object('ok', true, 'already_deleted', true);
  end if;

  -- Free the seats of every FUTURE booked session (uniform lock order: session_slots
  -- then bookings, same as book_slot / cancel_session, so no deadlock). One booking
  -- per (player, slot) — bookings_one_per_player_slot — so each slot decrements by
  -- exactly one. Reuses cancel_booking's seat-free statement verbatim; no refund.
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

  -- Anonymise the tombstone. Credits are LEFT as-is (abandoned, not refunded — a
  -- refund to a wallet nobody can reach is meaningless). Purchases untouched.
  update public.players
     set name         = 'Deleted player',
         phone        = 'deleted:' || id,   -- unique (id is the PK), no PII
         deleted_at   = now(),
         auth_user_id = null                -- satisfies RESTRICT; auth row can now go
   where id = v_player;

  return jsonb_build_object('ok', true, 'already_deleted', false, 'player_id', v_player);
end;
$$;

-- The caller deletes their own account. Not anon, not the public role.
revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
