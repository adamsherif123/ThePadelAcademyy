-- ============================================================================
-- Account deletion releases the coach link.
--
-- delete_account ANONYMISES rather than deletes: the player row stays as a
-- tombstone (name blanked, phone replaced, deleted_at set, auth_user_id nulled so
-- the auth row can go), because bookings and purchases reference it and the
-- academy's financial history must survive.
--
-- That is fine for every column except the one migration 049 added. players.coach_id
-- carries a partial UNIQUE index, so a tombstone that kept its link would hold that
-- coaches record hostage permanently: set_player_coach would answer `coach_taken`,
-- and the account holding it is a deleted row the admin's roster does not list, so
-- there would be no way to see the problem, let alone clear it. A coach who deleted
-- their account could never be given a new login.
--
-- So the anonymise clears it. The coaches row is untouched — that is the academy's
-- record, with its name, its photo and every session it has taught; only one
-- person's ACCESS to it is being withdrawn. The admin can link the next login to
-- the same coach as if nothing happened.
--
-- The body is otherwise 025's, unchanged: the same lock order, the same
-- seat-freeing loop, the same guarded update, the same {ok, reason}.
-- ============================================================================

create or replace function public.delete_account()
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_player text;
  v_slot   public.session_slots;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  -- Resolve + lock the caller's OWN player row. No argument path exists, so a caller
  -- can only ever reach their own row. The lock serialises a double-submit.
  select id into v_player from public.players where auth_user_id = v_uid for update;
  if not found then
    return jsonb_build_object('ok', true, 'already_deleted', true);
  end if;

  -- Free the seat of every FUTURE booked session, one slot at a time (uniform
  -- lock order: session_slots — locked here via FOR UPDATE OF — then
  -- bookings, same as book_slot/cancel_session/cancel_booking).
  for v_slot in
    select s.* from public.session_slots s
    join public.bookings b on b.slot_id = s.id
    where b.player_id = v_player and b.status = 'booked' and s.starts_at > now()
    order by s.id
    for update of s
  loop
    -- The booking-cancel is the arbiter (mirrors cancel_booking's own
    -- guarded logic): this UPDATE always reads live, so a booking a
    -- concurrent cancel_booking already cancelled matches zero rows here —
    -- FOUND is false, and we skip the seat-free entirely. There is nothing
    -- left to do for a booking someone else already resolved; freeing the
    -- seat again would double-decrement (or wrongly revert a slot that
    -- still has another player's live booking on it).
    update public.bookings
       set status = 'cancelled', cancelled_at = now()
     where player_id = v_player and status = 'booked' and slot_id = v_slot.id;
    if found then
      perform tpa.free_slot_seat(v_slot);
    end if;
  end loop;

  -- Anonymise the tombstone. Credits are LEFT as-is (abandoned, not refunded — a
  -- refund to a wallet nobody can reach is meaningless). Purchases untouched.
  update public.players
     set name         = 'Deleted player',
         phone        = 'deleted:' || id,   -- unique (id is the PK), no PII
         deleted_at   = now(),
         auth_user_id = null,               -- satisfies RESTRICT; auth row can now go
         -- ADDITIVE (054): release the coach link, if this was a coach's login.
         -- players.coach_id carries a partial UNIQUE index, so a tombstone that
         -- kept it would hold that coaches record hostage forever: set_player_coach
         -- would answer `coach_taken`, and the account holding it is a deleted row
         -- the admin's roster does not even list. The coaches row itself is
         -- untouched — it is the academy's record, with its sessions and its
         -- history; only one person's access to it is being withdrawn.
         coach_id     = null
   where id = v_player;

  return jsonb_build_object('ok', true, 'already_deleted', false, 'player_id', v_player);
end;
$$;
revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
