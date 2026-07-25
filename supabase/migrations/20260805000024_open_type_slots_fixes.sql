-- ============================================================================
-- Booking rework — four blocking fixes from independent review (all confirmed
-- by execution in a reconstruction harness). Additive on top of 20260804000023;
-- the atomic type-set design, the revert's core race-safety, and the
-- same-type-join/different-type-reject behaviour were all confirmed sound and
-- are UNCHANGED here.
--
-- FIX 1 — gender TOCTOU (most serious). Making gender booking-set (and
-- revert-cleared) turned the peek-time gender gate into a race: the read at
-- the top of book_slot/admin_book_player sees the UNLOCKED pre-image, while
-- the guarded UPDATE re-checked only type and capacity — never gender. Two
-- racers (one men, one ladies) choosing 'group' on the same untyped slot could
-- both pass their own peek (gender is still null for both of them at read
-- time) and then both attempt to seat, with only capacity deciding who fits —
-- seating a men player into what becomes a 'ladies' group. Fixed exactly like
-- the type clause: the guarded WHERE now ALSO re-checks gender against the
-- COMMITTED row. book_slot has no override concept, so its clause is
-- unconditional. admin_book_player's override is a deliberate, admin-chosen
-- bypass of the gender gate — the WHERE's gender clause must keep respecting
-- p_override, or a genuine override booking would start failing under
-- contention with a false slot_full. Both diagnostic ("not found") branches
-- gained a gender check (ahead of the type check, matching the pre-check's own
-- order) so an excluded racer resolves to a clean gender_mismatch, never an
-- exception or the wrong reason. admin_book_player's diagnostic also gained
-- the missing slot_missing re-check book_slot already had (a genuine
-- inconsistency independent of this race — aligned here).
--
-- FIX 2 — the CHECK that doesn't check. session_slots_group_shape's branch 2
-- was `training_type = 'group' and gender is not null and level is not null`.
-- For an UNTYPED row (training_type IS NULL), `training_type = 'group'`
-- evaluates to NULL (not FALSE) under three-valued logic — so branch 2 as a
-- whole is NULL, not FALSE, for an untyped row with both gender and level set.
-- Branch 1 (training_type IS NULL AND gender IS NULL AND level IS NULL) is
-- FALSE for that row (gender/level aren't null); branch 3 (training_type IS
-- NOT NULL...) is FALSE (training_type IS null). FALSE OR NULL OR FALSE =
-- NULL, and Postgres treats a NULL CHECK result as SATISFIED — so an untyped
-- row with gender AND level both set could be inserted, even though branch 2
-- LOOKS type-qualified. The qualifier needs to be a hard FALSE for the
-- untyped case, not a nullable equality: `training_type IS NOT NULL AND
-- training_type = 'group' and ...`. Once a row in that poisoned shape exists,
-- booking a non-group type onto it leaves gender/level untouched (the SET's
-- CASE only clears/sets them for 'group'), producing a row that satisfies
-- NEITHER branch 2 nor branch 3 — a genuine, unhandled check_violation
-- (23514) raised mid-transaction inside book_slot's `begin...exception` block,
-- which catches only TP002/unique_violation — escalating to a raw
-- PostgREST 500, breaking the {ok,reason}-as-data contract. The fixed CHECK
-- makes the poisoned row unconstructible in the first place (rejected at
-- INSERT), so that escalation path is unreachable by construction, not just
-- papered over. Decision: NOT adding a defensive check_violation catch to
-- book_slot/admin_book_player — the CHECK is the correct layer to own this
-- invariant, and if one ever fires after this fix it means a genuinely new,
-- unanticipated bug that SHOULD surface loudly rather than being silently
-- absorbed into the {ok,reason} contract as if it were ordinary rejected data.
--
-- FIX 3 — delete_account skipped the revert. It froze seats with its own
-- inline UPDATE (a THIRD copy of the seat-free logic, alongside
-- cancel_booking's and remove_booking's) that never became CASE-guarded for
-- the revert rule — the exact kind of divergence that caused this whole class
-- of bug. Fixed by extracting the ONE seat-free + revert statement into
-- tpa.free_slot_seat(v_slot), called by cancel_booking, remove_booking, AND
-- delete_account — one statement, three callers, no room left to drift
-- independently again. delete_account now loops one FUTURE booked slot at a
-- time (session_slots locked via FOR UPDATE OF first, matching the uniform
-- slot→booking lock order every other RPC uses), ordered by slot id for the
-- same defensive global-ordering reason S7b.1 refunds credit batches in id
-- order. The stale "reuses cancel_booking's seat-free statement verbatim"
-- comment (which had drifted false) is corrected to describe the shared
-- helper.
--
-- FIX 4 — reschedule_session staleness. It set capacity but never touched
-- pre_booking_capacity, so a LATER revert would silently restore the
-- PRE-EDIT value, discarding whatever the admin explicitly re-capacitied the
-- slot to. Decision: reconcile pre_booking_capacity ONLY when the admin is
-- genuinely CHANGING the capacity away from what's on the row today
-- (p_capacity <> the pre-image capacity) while a stash exists — in that case
-- their new number is the newest deliberate ceiling for this coach+time
-- block, so the stash is cleared (a later revert then just keeps whatever is
-- on the row, per the existing "else capacity" branch). A reschedule that
-- leaves capacity untouched (the common case: just moving time/coach) leaves
-- the stash alone, so an individual-forced slot's revert still restores the
-- ORIGINAL pre-booking number, not whatever happened to be showing.
-- Clearing the stash unconditionally on every reschedule (as bluntly
-- suggested) was considered and rejected: it would strand an
-- individual-forced slot at capacity 1 forever the moment an admin merely
-- moved its time without touching capacity at all, defeating the open-
-- inventory goal for exactly the slots that most need it restored.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 2 — the corrected CHECK. Additive to the two already-correct branches;
-- only branch 2's qualifier changes shape (NULL-safe now).
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.session_slots drop constraint session_slots_group_shape;
alter table public.session_slots add constraint session_slots_group_shape check (
  (training_type is null and gender is null and level is null)
  or
  (training_type is not null and training_type = 'group' and gender is not null and level is not null)
  or
  (training_type is not null and training_type <> 'group' and gender is null and level is null)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 3 — the ONE seat-free + revert statement, shared by cancel_booking,
-- remove_booking, and delete_account. Caller must already hold the slot's row
-- lock (FOR UPDATE) — this function takes no new lock, matching the existing
-- "same lock, same statement, same commit" race-safety of the revert.
-- Plain function (not SECURITY DEFINER), search_path pinned — same shape as
-- tpa.refund_booking: it only ever runs from inside another SECURITY DEFINER
-- RPC, inheriting that RPC's elevated context, and the `tpa` schema is not
-- exposed to any client role (see S7a).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function tpa.free_slot_seat(v_slot public.session_slots)
  returns void
  language plpgsql
  set search_path = ''
as $$
declare
  v_will_be_empty boolean := (v_slot.booked_count - 1 <= 0) and (v_slot.set_by_booking_at is not null);
begin
  update public.session_slots
    set booked_count = greatest(0, booked_count - 1),
        training_type = case when v_will_be_empty then null else training_type end,
        gender = case when v_will_be_empty then null else gender end,
        level = case when v_will_be_empty then null else level end,
        capacity = case when v_will_be_empty and pre_booking_capacity is not null
                        then pre_booking_capacity else capacity end,
        pre_booking_capacity = case when v_will_be_empty then null else pre_booking_capacity end,
        set_by_booking_at = case when v_will_be_empty then null else set_by_booking_at end
    where id = v_slot.id;
end;
$$;

create or replace function public.cancel_booking(p_booking_id text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_player  text;
  v_slot_id text;
  v_booking public.bookings;
  v_slot    public.session_slots;
  v_refund  boolean;
begin
  v_player := public.current_player_id();
  if v_player is null then return jsonb_build_object('ok', false, 'reason', 'not_authenticated'); end if;

  select slot_id into v_slot_id from public.bookings where id = p_booking_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'booking_missing'); end if;

  select * into v_slot from public.session_slots where id = v_slot_id for update;   -- lock slot first
  if not found then return jsonb_build_object('ok', false, 'reason', 'slot_missing'); end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;   -- then the booking
  if v_booking.player_id <> v_player then return jsonb_build_object('ok', false, 'reason', 'not_owner');         end if;
  if v_booking.status = 'cancelled'  then return jsonb_build_object('ok', false, 'reason', 'already_cancelled'); end if;
  if v_booking.status <> 'booked'    then return jsonb_build_object('ok', false, 'reason', 'not_cancellable');   end if;
  if v_slot.starts_at <= now()       then return jsonb_build_object('ok', false, 'reason', 'not_cancellable');   end if;

  v_refund := (v_slot.starts_at - now()) > tpa.cancellation_window();

  perform tpa.free_slot_seat(v_slot);
  update public.bookings set status = 'cancelled', cancelled_at = now() where id = v_booking.id;
  if v_refund then perform tpa.refund_booking(v_booking.id); end if;

  return jsonb_build_object('ok', true, 'refunded', v_refund,
    'credit_batch_id', case when v_refund then v_booking.credit_batch_id else null end);
end;
$$;

create or replace function public.remove_booking(p_booking_id text, p_refund boolean)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_slot_id text;
  v_slot    public.session_slots;
  v_booking public.bookings;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;

  select slot_id into v_slot_id from public.bookings where id = p_booking_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'booking_missing'); end if;

  select * into v_slot from public.session_slots where id = v_slot_id for update;   -- slot lock first
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if v_booking.status <> 'booked' then return jsonb_build_object('ok', false, 'reason', 'already_cancelled'); end if;

  perform tpa.free_slot_seat(v_slot);
  update public.bookings set status = 'cancelled', cancelled_at = now() where id = p_booking_id;
  if p_refund then perform tpa.refund_booking(p_booking_id); end if;

  -- v_slot is the PRE-update PL/pgSQL variable — still names the real type the
  -- player was removed from even though the column may have just been nulled.
  perform tpa.notify(
    v_booking.player_id, 'removed_from_session', 'Removed from a session',
    'You were removed from your ' || initcap(v_slot.training_type) || ' session on '
      || tpa.cairo_when(v_slot.starts_at) || '. '
      || case when p_refund then 'Your credit was refunded.' else 'Your credit was not refunded.' end,
    v_slot_id, null);

  return jsonb_build_object('ok', true, 'refunded', p_refund);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 3 (cont.) — delete_account now shares tpa.free_slot_seat too, one FUTURE
-- booked slot at a time. Ordered by slot id — the same defensive global-order
-- discipline S7b.1 uses for shared credit-batch refunds, foreclosing any
-- cross-transaction lock-order cycle even though this loop only ever touches
-- ONE player's own bookings.
-- ─────────────────────────────────────────────────────────────────────────────
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
  -- lock order: session_slots — locked here via FOR UPDATE OF — then bookings,
  -- same as book_slot/cancel_session/cancel_booking). Shares the EXACT
  -- seat-free + revert statement cancel_booking/remove_booking use via
  -- tpa.free_slot_seat, so there is no third copy of the CASE-laden UPDATE
  -- left to drift out of sync with the revert rule again. No refund — a
  -- deleted player is abandoning the wallet, not asking for money back.
  for v_slot in
    select s.* from public.session_slots s
    join public.bookings b on b.slot_id = s.id
    where b.player_id = v_player and b.status = 'booked' and s.starts_at > now()
    order by s.id
    for update of s
  loop
    perform tpa.free_slot_seat(v_slot);
    update public.bookings
       set status = 'cancelled', cancelled_at = now()
     where player_id = v_player and status = 'booked' and slot_id = v_slot.id;
  end loop;

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

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 1 — book_slot: gender re-checked in the guarded WHERE against the
-- COMMITTED row (unconditional — book_slot has no override concept), plus the
-- matching diagnostic branch entry.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.book_slot(p_slot_id text, p_training_type text default null)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_player        text;
  v_slot          public.session_slots;
  v_pgender       text;
  v_plevel        text;
  v_effective_type text;
  v_batch_id      text;
  v_booking_id    text;
  v_new_count     int;
  v_capacity      int;
begin
  v_player := public.current_player_id();
  if v_player is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  select * into v_slot from public.session_slots where id = p_slot_id;
  if not found then           return jsonb_build_object('ok', false, 'reason', 'slot_missing');   end if;
  if v_slot.status <> 'published' then return jsonb_build_object('ok', false, 'reason', 'slot_cancelled'); end if;
  if v_slot.starts_at <= now() then    return jsonb_build_object('ok', false, 'reason', 'slot_in_past');  end if;

  select gender, level into v_pgender, v_plevel from public.players where id = v_player;
  if v_slot.gender is not null and v_slot.gender <> v_pgender then
    return jsonb_build_object('ok', false, 'reason', 'gender_mismatch');
  end if;
  -- level_mismatch removed — level is display-only (rule 4); no code blocks a
  -- mismatched join. gender_mismatch above is the ladies/men separation and is
  -- preserved unchanged. This is the UNLOCKED peek — see the guarded WHERE
  -- below for the race-safe re-check against the committed row (FIX 1).

  -- Resolve the effective training type (rule 1 + rule 2).
  if v_slot.training_type is not null then
    if p_training_type is not null and p_training_type <> v_slot.training_type then
      return jsonb_build_object('ok', false, 'reason', 'type_mismatch');
    end if;
    v_effective_type := v_slot.training_type;
  else
    if p_training_type is null then
      return jsonb_build_object('ok', false, 'reason', 'type_required');
    end if;
    if p_training_type not in ('trial', 'group', 'duo', 'individual') then
      return jsonb_build_object('ok', false, 'reason', 'invalid_type');
    end if;
    v_effective_type := p_training_type;
  end if;

  -- Credit check re-pointed at the CHOICE, not the slot's (possibly absent)
  -- pre-set type.
  select id into v_batch_id
  from public.credit_batches
  where player_id = v_player and training_type = v_effective_type
    and quantity_remaining > 0 and expires_at > now()
  order by expires_at asc, id asc
  limit 1;
  if v_batch_id is null then return jsonb_build_object('ok', false, 'reason', 'no_usable_credit'); end if;

  v_booking_id := 'bk_' || gen_random_uuid();
  begin
    -- Guarded increment: WHERE gains the type clause (20260804000023) and now
    -- ALSO a gender clause (FIX 1) — a racer whose gender doesn't match the
    -- COMMITTED value matches zero rows here, same EvalPlanQual mechanism that
    -- already proves the type race. The SET terms are unchanged.
    update public.session_slots
      set booked_count = booked_count + 1,
          training_type = coalesce(training_type, v_effective_type),
          capacity = case when training_type is null and v_effective_type = 'individual'
                          then 1 else capacity end,
          pre_booking_capacity = case when training_type is null and v_effective_type = 'individual'
                                      then capacity else pre_booking_capacity end,
          gender = case when training_type is null and v_effective_type = 'group'
                        then v_pgender else gender end,
          level = case when training_type is null and v_effective_type = 'group'
                       then v_plevel else level end,
          set_by_booking_at = case when training_type is null then now() else set_by_booking_at end
      where id = p_slot_id and booked_count < capacity
        and status = 'published' and starts_at > now()
        and (training_type is null or training_type = v_effective_type)
        and (gender is null or gender = v_pgender)
      returning booked_count, capacity into v_new_count, v_capacity;
    if not found then
      select * into v_slot from public.session_slots where id = p_slot_id;
      if not found then                    return jsonb_build_object('ok', false, 'reason', 'slot_missing');   end if;
      if v_slot.status <> 'published' then return jsonb_build_object('ok', false, 'reason', 'slot_cancelled'); end if;
      if v_slot.starts_at <= now() then    return jsonb_build_object('ok', false, 'reason', 'slot_in_past');  end if;
      if v_slot.gender is not null and v_slot.gender <> v_pgender then
        return jsonb_build_object('ok', false, 'reason', 'gender_mismatch');
      end if;
      if v_slot.training_type is not null and v_slot.training_type <> v_effective_type then
        return jsonb_build_object('ok', false, 'reason', 'type_mismatch');
      end if;
      return jsonb_build_object('ok', false, 'reason', 'slot_full');
    end if;

    update public.credit_batches
      set quantity_remaining = quantity_remaining - 1
      where id = v_batch_id and quantity_remaining > 0;
    if not found then raise exception 'credit race lost' using errcode = 'TP002'; end if;

    insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at, cancelled_at)
      values (v_booking_id, p_slot_id, v_player, v_batch_id, 'booked', now(), null);
  exception
    when sqlstate 'TP002'  then return jsonb_build_object('ok', false, 'reason', 'no_usable_credit');
    when unique_violation then return jsonb_build_object('ok', false, 'reason', 'already_booked');
  end;

  if v_new_count = v_capacity then
    perform tpa.notify(
      b.player_id, 'session_confirmed', 'Session confirmed',
      'Your ' || initcap(v_effective_type) || ' session on ' || tpa.cairo_when(v_slot.starts_at)
        || ' is confirmed.',
      p_slot_id, null)
    from public.bookings b
    where b.slot_id = p_slot_id and b.status = 'booked' and b.player_id <> v_player;
  end if;

  return jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'credit_batch_id', v_batch_id);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 1 — admin_book_player: gender re-checked in the guarded WHERE too, but
-- ONLY when NOT overridden — p_override is the admin's deliberate instruction
-- to seat a mismatched gender, and must keep bypassing the gender guard in the
-- WHERE exactly as it already bypasses the pre-check, or a genuine override
-- would start failing under contention with a false slot_full. The diagnostic
-- branch mirrors this (gender check gated on `not p_override`) and also gains
-- the slot_missing re-check book_slot's diagnostic already had (a genuine,
-- pre-existing inconsistency between the two functions, aligned here).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_book_player(
  p_slot_id text, p_player_id text, p_override boolean, p_training_type text default null
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_slot           public.session_slots;
  v_pgender        text;
  v_plevel         text;
  v_effective_type text;
  v_batch_id       text;
  v_booking_id     text;
  v_mismatch       boolean := false;
  v_new_count      int;
  v_capacity       int;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;

  select * into v_slot from public.session_slots where id = p_slot_id;
  if not found then                       return jsonb_build_object('ok', false, 'reason', 'slot_missing');    end if;
  select gender, level into v_pgender, v_plevel from public.players where id = p_player_id;
  if not found then                       return jsonb_build_object('ok', false, 'reason', 'player_missing');  end if;
  if v_slot.status <> 'published' then    return jsonb_build_object('ok', false, 'reason', 'slot_cancelled'); end if;
  if v_slot.starts_at <= now() then       return jsonb_build_object('ok', false, 'reason', 'slot_in_past');   end if;

  v_mismatch := (v_slot.gender is not null and v_slot.gender <> v_pgender);
  if not p_override then
    if v_slot.gender is not null and v_slot.gender <> v_pgender then
      return jsonb_build_object('ok', false, 'reason', 'gender_mismatch');
    end if;
    -- level_mismatch removed — display-only, never blocking (rule 4).
  end if;

  if v_slot.training_type is not null then
    if p_training_type is not null and p_training_type <> v_slot.training_type then
      return jsonb_build_object('ok', false, 'reason', 'type_mismatch');
    end if;
    v_effective_type := v_slot.training_type;
  else
    if p_training_type is null then
      return jsonb_build_object('ok', false, 'reason', 'type_required');
    end if;
    if p_training_type not in ('trial', 'group', 'duo', 'individual') then
      return jsonb_build_object('ok', false, 'reason', 'invalid_type');
    end if;
    v_effective_type := p_training_type;
  end if;

  select id into v_batch_id
  from public.credit_batches
  where player_id = p_player_id and training_type = v_effective_type
    and quantity_remaining > 0 and expires_at > now()
  order by expires_at asc, id asc
  limit 1;
  if v_batch_id is null then return jsonb_build_object('ok', false, 'reason', 'no_usable_credit'); end if;

  v_booking_id := 'bk_' || gen_random_uuid();
  begin
    update public.session_slots
      set booked_count = booked_count + 1,
          training_type = coalesce(training_type, v_effective_type),
          capacity = case when training_type is null and v_effective_type = 'individual'
                          then 1 else capacity end,
          pre_booking_capacity = case when training_type is null and v_effective_type = 'individual'
                                      then capacity else pre_booking_capacity end,
          gender = case when training_type is null and v_effective_type = 'group'
                        then v_pgender else gender end,
          level = case when training_type is null and v_effective_type = 'group'
                       then v_plevel else level end,
          set_by_booking_at = case when training_type is null then now() else set_by_booking_at end
      where id = p_slot_id and booked_count < capacity
        and status = 'published' and starts_at > now()
        and (training_type is null or training_type = v_effective_type)
        and (p_override or gender is null or gender = v_pgender)
      returning booked_count, capacity into v_new_count, v_capacity;
    if not found then
      select * into v_slot from public.session_slots where id = p_slot_id;
      if not found then                    return jsonb_build_object('ok', false, 'reason', 'slot_missing');   end if;
      if v_slot.status <> 'published' then return jsonb_build_object('ok', false, 'reason', 'slot_cancelled'); end if;
      if v_slot.starts_at <= now() then    return jsonb_build_object('ok', false, 'reason', 'slot_in_past');  end if;
      if not p_override and v_slot.gender is not null and v_slot.gender <> v_pgender then
        return jsonb_build_object('ok', false, 'reason', 'gender_mismatch');
      end if;
      if v_slot.training_type is not null and v_slot.training_type <> v_effective_type then
        return jsonb_build_object('ok', false, 'reason', 'type_mismatch');
      end if;
      return jsonb_build_object('ok', false, 'reason', 'slot_full');
    end if;

    update public.credit_batches
      set quantity_remaining = quantity_remaining - 1
      where id = v_batch_id and quantity_remaining > 0;
    if not found then raise exception 'credit race lost' using errcode = 'TP002'; end if;

    insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at, cancelled_at)
      values (v_booking_id, p_slot_id, p_player_id, v_batch_id, 'booked', now(), null);
  exception
    when sqlstate 'TP002'  then return jsonb_build_object('ok', false, 'reason', 'no_usable_credit');
    when unique_violation then return jsonb_build_object('ok', false, 'reason', 'already_booked');
  end;

  if v_new_count = v_capacity then
    perform tpa.notify(
      b.player_id, 'session_confirmed', 'Session confirmed',
      'Your ' || initcap(v_effective_type) || ' session on ' || tpa.cairo_when(v_slot.starts_at)
        || ' is confirmed.',
      p_slot_id, null)
    from public.bookings b
    where b.slot_id = p_slot_id and b.status = 'booked' and b.player_id <> p_player_id;
  end if;

  return jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'credit_batch_id', v_batch_id,
    'overridden', (p_override and v_mismatch));
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- FIX 4 — reschedule_session reconciles pre_booking_capacity. See the header
-- comment for the full decision and why unconditional clearing was rejected.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.reschedule_session(
  p_slot_id   text,
  p_coach_id  text,
  p_capacity  int,
  p_starts_at timestamptz,
  p_ends_at   timestamptz
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_slot  public.session_slots;
  v_moved boolean;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;

  select * into v_slot from public.session_slots where id = p_slot_id for update;
  if not found then                   return jsonb_build_object('ok', false, 'reason', 'slot_missing');   end if;
  if v_slot.status = 'cancelled' then return jsonb_build_object('ok', false, 'reason', 'slot_cancelled'); end if;
  if p_capacity < v_slot.booked_count then return jsonb_build_object('ok', false, 'reason', 'capacity_below_booked'); end if;
  if p_ends_at <= p_starts_at then    return jsonb_build_object('ok', false, 'reason', 'end_before_start'); end if;
  v_moved := p_starts_at <> v_slot.starts_at;
  if v_moved and p_starts_at <= now() then return jsonb_build_object('ok', false, 'reason', 'in_past'); end if;

  begin
    -- pre_booking_capacity is the "resting" capacity a later revert restores.
    -- Clear it ONLY when the admin is genuinely changing capacity away from
    -- what's on the row today (p_capacity <> the pre-image capacity) while a
    -- stash exists — their new number supersedes it as the newest deliberate
    -- ceiling, so a later revert just keeps whatever's on the row (the
    -- existing "else capacity" branch). Leaving capacity untouched (the
    -- common reschedule: just moving time/coach) leaves the stash alone.
    update public.session_slots
      set coach_id = p_coach_id,
          capacity = p_capacity,
          starts_at = p_starts_at,
          ends_at = p_ends_at,
          pre_booking_capacity = case
            when pre_booking_capacity is not null and p_capacity <> capacity then null
            else pre_booking_capacity
          end
      where id = p_slot_id;
  exception when exclusion_violation then
    return jsonb_build_object('ok', false, 'reason', 'coach_conflict');
  end;

  if v_moved then
    perform tpa.notify(
      b.player_id, 'session_rescheduled', 'Session rescheduled',
      'Your ' || initcap(v_slot.training_type) || ' session moved to ' || tpa.cairo_when(p_starts_at) || '.',
      p_slot_id, null)
    from public.bookings b
    where b.slot_id = p_slot_id and b.status = 'booked';
  end if;

  return jsonb_build_object('ok', true, 'moved', v_moved);
end;
$$;
