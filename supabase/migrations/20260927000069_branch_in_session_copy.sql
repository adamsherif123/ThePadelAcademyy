-- ============================================================================
-- 069 — every notification that describes a SESSION names its branch
--
-- WHY
-- With one location, "your Group session on Tuesday at 6" was unambiguous. With
-- two it is not, and the reader of these messages is standing somewhere deciding
-- where to drive. 065 fixed the credit messages (grant_credits) and Session 4
-- fixed book_slot's four. This is the rest: every remaining tpa.notify /
-- tpa.notify_owners call site whose body describes a session.
--
-- COPY ONLY — the hard constraint
-- A 1.2 (99541ff) or 1.3 (255b73f) client can never be updated. So this migration
-- adds NO notification type, NO enum value, and NO column: notifications.type is
-- untouched, and every change is a longer string in an existing body. A legacy
-- client renders the new bodies exactly as it renders today's, because to it they
-- are the same thing — text.
--
-- HOW EACH BODY WAS BUILT
-- Not retyped. Each function below was extracted from the definition LIVE ON DEV
-- (`supabase db dump --linked`), and only the listed hunks were applied:
--
--   admin_book_player     4 hunks   declare, one assignment, 2 message strings
--   cancel_booking        4 hunks   declare, one assignment, 2 message strings
--   cancel_session        3 hunks   declare, one assignment, 1 message string
--   confirm_session       3 hunks   declare, one assignment, 1 message string
--   remove_booking        4 hunks   declare, one assignment, 2 message strings
--   reschedule_session    3 hunks   declare, one assignment, 1 message string
--   send_session_reminders 3 hunks  cursor column, 2 message strings
--
-- Applying the INVERSE of those hunks reproduces the live definition
-- byte-for-byte — proven mechanically, not asserted. Nothing else moved: no
-- guard, no lock order, no {ok, reason}, no return shape, no grant. The headers
-- below are restyled to this repo's lowercase form; the attributes they replace
-- (`LANGUAGE plpgsql SECURITY DEFINER`, `SET search_path TO ''`) are identical,
-- and the body between `as $fn$` and `$fn$;` is verbatim apart from the hunks.
--
-- WHY IT CANNOT PRODUCE A NULL BODY
-- notifications.body is NOT NULL, and `'a' || null` is NULL in SQL, so a branch
-- name that failed to resolve would take the whole message down with it. It
-- cannot: tpa.location_name coalesces a missing row to 'the academy' (066). Each
-- function resolves it ONCE, above the first message that reads it — the same
-- ordering bug 065 hit in book_slot and fixed there.
--
-- NOT CHANGED, AND WHY
--   book_slot, grant_credits, transfer_credit_batch  — already name the branch.
--   approve_credit_request, reject_credit_request, request_credits,
--   settle_purchase, mark_purchase_refunded          — describe CREDITS or MONEY,
--     not a session. Out of this migration's stated scope. Two of them are
--     nonetheless a real gap and are flagged in the session report: the player's
--     "Credits added" on approval, and the owners' "New credit request", neither
--     of which says which branch — while grant_credits, the other way to the same
--     outcome, does.
-- ============================================================================

-- admin_book_player — the admin adds a player. Two emits: the player's own
-- 'admin_booked' and the 'session_confirmed' fan-out when that booking fills the slot.
create or replace function public.admin_book_player(p_slot_id text, p_player_id text, p_override boolean, p_training_type text default null)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $fn$
declare
  v_slot             public.session_slots;
  v_pgender          text;
  v_plevel           text;
  v_effective_type   text;
  v_batch_id         text;
  v_booking_id       text;
  -- v_mismatch / v_committed_gender / p_override / the `overridden` return
  -- field are INERT (20260813000032, gender display-only): p_override existed
  -- only to bypass the gender gate, and nothing blocks on gender anymore, so
  -- there is nothing left to override. Still computed and returned exactly as
  -- before — v_mismatch is now a plain fact ("does the committed gender differ
  -- from this player's"), never a check outcome — kept for client
  -- compatibility, not because it still gates anything. Left alone
  -- deliberately: retiring the parameter/field is a separate signature change.
  v_mismatch         boolean;
  v_new_count        int;
  v_capacity         int;
  v_committed_gender text;
  v_other_loc        text;   -- ADDITIVE (065, location-locked credits)
  v_loc_name         text;   -- ADDITIVE (069, branch in session copy)
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;

  select * into v_slot from public.session_slots where id = p_slot_id;
  if not found then                       return jsonb_build_object('ok', false, 'reason', 'slot_missing');    end if;
  select gender, level into v_pgender, v_plevel from public.players where id = p_player_id;
  if not found then                       return jsonb_build_object('ok', false, 'reason', 'player_missing');  end if;
  if v_slot.status <> 'published' then    return jsonb_build_object('ok', false, 'reason', 'slot_cancelled'); end if;
  if v_slot.starts_at <= now() then       return jsonb_build_object('ok', false, 'reason', 'slot_in_past');   end if;

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

  -- ADDITIVE (065): same rule as book_slot, and deliberately NOT overridable.
  -- p_override covers gender/level only; letting an admin spend one branch's
  -- credits at another would silently move money between branches' books.
  select id into v_batch_id
  from public.credit_batches
  where player_id = p_player_id and training_type = v_effective_type
    and quantity_remaining > 0 and expires_at > now()
    and location_id = v_slot.location_id
  order by expires_at asc, id asc
  limit 1;
  if v_batch_id is null then
    select cb.location_id into v_other_loc
    from public.credit_batches cb
    where cb.player_id = p_player_id and cb.training_type = v_effective_type
      and cb.quantity_remaining > 0 and cb.expires_at > now()
    order by cb.expires_at asc, cb.id asc
    limit 1;
    if v_other_loc is not null then
      return jsonb_build_object(
        'ok', false, 'reason', 'credit_wrong_location',
        'location_id', v_other_loc,
        'location_name', tpa.location_name(v_other_loc));
    end if;
    return jsonb_build_object('ok', false, 'reason', 'no_usable_credit');
  end if;

  v_booking_id := 'bk_' || gen_random_uuid();
  begin
    update public.session_slots
      set booked_count = booked_count + 1,
          training_type = coalesce(training_type, v_effective_type),
          capacity = case when training_type is null
                          then least(capacity, tpa.canonical_capacity(v_effective_type)) else capacity end,
          pre_booking_capacity = case when training_type is null
                                      then capacity else pre_booking_capacity end,
          gender = case when training_type is null and v_effective_type = 'group'
                        then v_pgender else gender end,
          level = case when training_type is null and v_effective_type = 'group'
                       then v_plevel else level end,
          set_by_booking_at = case when training_type is null then now() else set_by_booking_at end
      where id = p_slot_id and booked_count < capacity
        and status = 'published' and starts_at > now()
        and (training_type is null or training_type = v_effective_type)
      returning booked_count, capacity, gender into v_new_count, v_capacity, v_committed_gender;
    if not found then
      select * into v_slot from public.session_slots where id = p_slot_id;
      if not found then                    return jsonb_build_object('ok', false, 'reason', 'slot_missing');   end if;
      if v_slot.status <> 'published' then return jsonb_build_object('ok', false, 'reason', 'slot_cancelled'); end if;
      if v_slot.starts_at <= now() then    return jsonb_build_object('ok', false, 'reason', 'slot_in_past');  end if;
      if v_slot.training_type is not null and v_slot.training_type <> v_effective_type then
        return jsonb_build_object('ok', false, 'reason', 'type_mismatch');
      end if;
      return jsonb_build_object('ok', false, 'reason', 'slot_full');
    end if;

    update public.credit_batches
      set quantity_remaining = quantity_remaining - 1
      where id = v_batch_id and quantity_remaining > 0;
    if not found then raise exception 'credit race lost' using errcode = 'TP002'; end if;

    insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at, cancelled_at, location_id)
      values (v_booking_id, p_slot_id, p_player_id, v_batch_id, 'booked', now(), null, v_slot.location_id);
  exception
    when sqlstate 'TP002'  then return jsonb_build_object('ok', false, 'reason', 'no_usable_credit');
    when unique_violation then return jsonb_build_object('ok', false, 'reason', 'already_booked');
  end;

  -- ADDITIVE (069): resolved ONCE, before the first message that uses it.
  -- tpa.location_name coalesces a missing row to 'the academy' (066), so a
  -- concatenated body can never become NULL and violate notifications.body.
  v_loc_name := tpa.location_name(v_slot.location_id);

  perform tpa.notify(
    p_player_id, 'admin_booked', 'Added to a session',
    'You''ve been added to a ' || initcap(v_effective_type) || ' session on '
      || tpa.cairo_when(v_slot.starts_at) || ' at ' || v_loc_name || '.',
    p_slot_id, null);

  v_mismatch := (v_committed_gender is not null and v_committed_gender <> v_pgender);

  if v_new_count = v_capacity then
    perform tpa.notify(
      b.player_id, 'session_confirmed', 'Session confirmed',
      'Your ' || initcap(v_effective_type) || ' session on ' || tpa.cairo_when(v_slot.starts_at)
        || ' at ' || v_loc_name || ' is confirmed.',
      p_slot_id, null)
    from public.bookings b
    where b.slot_id = p_slot_id and b.status = 'booked' and b.player_id <> p_player_id;
  end if;

  return jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'credit_batch_id', v_batch_id,
    'overridden', (p_override and v_mismatch));
end;
$fn$;


-- cancel_booking — MONEY PATH (refund_booking). Two emits: the session_reopened
-- fan-out to the players left behind, and the owner_cancellation ping.
create or replace function public.cancel_booking(p_booking_id text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $fn$
declare
  v_player        text;
  v_slot_id       text;
  v_booking       public.bookings;
  v_slot          public.session_slots;
  v_refund        boolean;
  v_was_confirmed boolean;
  v_new_count     int;
  v_new_capacity  int;
  v_who           text;   -- ADDITIVE (owner ping)
  v_coach         text;   -- ADDITIVE (owner ping)
  v_loc_name      text;   -- ADDITIVE (069, branch in session copy)
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

  -- NEW — captured from the PRE-cancel locked row, before free_slot_seat runs.
  v_was_confirmed := (v_slot.booked_count >= v_slot.capacity) or (v_slot.manually_confirmed_at is not null);

  perform tpa.free_slot_seat(v_slot);
  update public.bookings set status = 'cancelled', cancelled_at = now() where id = v_booking.id;
  if v_refund then perform tpa.refund_booking(v_booking.id); end if;

  -- NEW — read the COMMITTED post-cancel state (still under this transaction's
  -- own slot lock, so this is our own just-applied free_slot_seat write, not a
  -- pre-lock peek). manually_confirmed_at is never touched by free_slot_seat,
  -- so v_slot's copy is still accurate for that column.
  select booked_count, capacity into v_new_count, v_new_capacity
    from public.session_slots where id = v_slot.id;

  -- ADDITIVE (069): resolved ONCE, before the first message that uses it.
  -- tpa.location_name coalesces a missing row to 'the academy' (066), so a
  -- concatenated body can never become NULL and violate notifications.body.
  v_loc_name := tpa.location_name(v_slot.location_id);

  if v_was_confirmed and v_new_count < v_new_capacity and v_slot.manually_confirmed_at is null then
    perform tpa.notify(
      b.player_id, 'session_reopened', 'Session reopened',
      'A player left your ' || initcap(v_slot.training_type) || ' session on ' || tpa.cairo_when(v_slot.starts_at)
        || ' at ' || v_loc_name || ' — it''s pending again until it fills.',
      v_slot.id, null)
    from public.bookings b
    where b.slot_id = v_slot.id and b.status = 'booked' and b.player_id <> v_player;
  end if;

  -- ── ADDITIVE: tell the owners someone dropped out ────────────────────────
  -- Emitted only here, on the success return, AFTER the seat is freed, the booking
  -- is marked cancelled, any refund is applied and the session_reopened fan-out has
  -- run. Every rejection above returns earlier and notifies nobody.
  --
  -- Scoped to the PLAYER self-cancel by construction: remove_booking, cancel_session
  -- and delete_account each do their own inline seat-free rather than calling this
  -- function, so an academy-initiated cancel or a delete-account cascade cannot reach
  -- this line. Same player-action-only scoping 044 applied to book_slot (which
  -- notifies, while admin_book_player does not).
  --
  -- v_slot is the row locked at the top; free_slot_seat touches booked_count only, so
  -- starts_at and coach_id are still correct here.
  select name into v_who from public.players where id = v_player;
  select name into v_coach from public.coaches where id = v_slot.coach_id;
  perform tpa.notify_owners(
    'owner_cancellation',
    'Booking cancelled',
    coalesce(v_who, 'A player') || ' cancelled ' || tpa.cairo_time_short(v_slot.starts_at)
      || ' slot with ' || coalesce(split_part(v_coach, ' ', 1), 'a coach')
      || ' at ' || v_loc_name,
    v_player,
    -- NO slot id, deliberately. The owner has no booking on this slot, and every
    -- SHIPPED build routes an unrecognised notification type to
    -- Sessions?focus=<slotId> — which would open on a session that isn't theirs.
    -- Passing null makes that fallback a harmless Sessions landing instead.
    null);

  return jsonb_build_object('ok', true, 'refunded', v_refund,
    'credit_batch_id', case when v_refund then v_booking.credit_batch_id else null end);
end;
$fn$;


-- cancel_session — MONEY PATH (refunds every booking). One emit per refunded player.
create or replace function public.cancel_session(p_slot_id text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $fn$
declare
  v_slot  public.session_slots;
  v_bk    record;
  v_count int := 0;
  v_loc_name text;   -- ADDITIVE (069, branch in session copy)
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;

  select * into v_slot from public.session_slots where id = p_slot_id for update;
  if not found then                   return jsonb_build_object('ok', false, 'reason', 'slot_missing');      end if;
  if v_slot.status = 'cancelled' then return jsonb_build_object('ok', false, 'reason', 'already_cancelled'); end if;

  -- ADDITIVE (069): resolved ONCE, before the first message that uses it.
  -- tpa.location_name coalesces a missing row to 'the academy' (066), so a
  -- concatenated body can never become NULL and violate notifications.body.
  v_loc_name := tpa.location_name(v_slot.location_id);

  for v_bk in
    select b.id, b.credit_batch_id, b.player_id
    from public.bookings b
    where b.slot_id = p_slot_id and b.status = 'booked'
    order by b.credit_batch_id, b.id
  loop
    perform 1 from public.credit_batches where id = v_bk.credit_batch_id for update;
    perform tpa.refund_booking(v_bk.id);
    update public.bookings set status = 'cancelled', cancelled_at = now() where id = v_bk.id;
    perform tpa.notify(
      v_bk.player_id, 'session_cancelled', 'Session cancelled',
      'Your ' || initcap(v_slot.training_type) || ' session on ' || tpa.cairo_when(v_slot.starts_at)
        || ' at ' || v_loc_name || ' was cancelled and your credit refunded.',
      p_slot_id, null);
    v_count := v_count + 1;
  end loop;

  update public.session_slots set status = 'cancelled', booked_count = 0 where id = p_slot_id;

  return jsonb_build_object('ok', true, 'refunded_count', v_count);
end;
$fn$;


-- confirm_session — the admin confirms a session that had not filled.
-- NOT in Session 8's enumeration, but it plainly describes a session, which is the rule.
create or replace function public.confirm_session(p_slot_id text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $fn$
declare
  v_slot public.session_slots;
  v_loc_name text;   -- ADDITIVE (069, branch in session copy)
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;

  select * into v_slot from public.session_slots where id = p_slot_id for update;
  if not found then                       return jsonb_build_object('ok', false, 'reason', 'slot_missing');    end if;
  if v_slot.status = 'cancelled' then     return jsonb_build_object('ok', false, 'reason', 'slot_cancelled'); end if;
  if v_slot.starts_at <= now() then       return jsonb_build_object('ok', false, 'reason', 'slot_in_past');   end if;

  if v_slot.manually_confirmed_at is not null then
    return jsonb_build_object('ok', true, 'already_confirmed', true);
  end if;

  update public.session_slots set manually_confirmed_at = now() where id = p_slot_id;

  -- Announce only if it wasn't ALREADY confirmed by fill (booked_count >= capacity),
  -- because those players were already notified when the Nth booking filled it.
  -- ADDITIVE (069): resolved ONCE, before the first message that uses it.
  -- tpa.location_name coalesces a missing row to 'the academy' (066), so a
  -- concatenated body can never become NULL and violate notifications.body.
  v_loc_name := tpa.location_name(v_slot.location_id);

  if v_slot.booked_count < v_slot.capacity then
    perform tpa.notify(
      b.player_id, 'session_confirmed', 'Session confirmed',
      'Your ' || initcap(v_slot.training_type) || ' session on ' || tpa.cairo_when(v_slot.starts_at)
        || ' at ' || v_loc_name || ' is confirmed.',
      p_slot_id, null)
    from public.bookings b
    where b.slot_id = p_slot_id and b.status = 'booked';
  end if;

  return jsonb_build_object('ok', true, 'already_confirmed', false);
end;
$fn$;


-- remove_booking — MONEY PATH (conditional refund). Two emits: the session_reopened
-- fan-out and the removed player's own message.
create or replace function public.remove_booking(p_booking_id text, p_refund boolean)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $fn$
declare
  v_slot_id       text;
  v_slot          public.session_slots;
  v_booking       public.bookings;
  v_was_confirmed boolean;
  v_new_count     int;
  v_new_capacity  int;
  v_loc_name      text;   -- ADDITIVE (069, branch in session copy)
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;

  select slot_id into v_slot_id from public.bookings where id = p_booking_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'booking_missing'); end if;

  select * into v_slot from public.session_slots where id = v_slot_id for update;   -- slot lock first
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if v_booking.status <> 'booked' then return jsonb_build_object('ok', false, 'reason', 'already_cancelled'); end if;

  -- NEW — captured from the PRE-cancel locked row, before free_slot_seat runs.
  v_was_confirmed := (v_slot.booked_count >= v_slot.capacity) or (v_slot.manually_confirmed_at is not null);

  perform tpa.free_slot_seat(v_slot);
  update public.bookings set status = 'cancelled', cancelled_at = now() where id = p_booking_id;
  if p_refund then perform tpa.refund_booking(p_booking_id); end if;

  -- NEW — same committed-state re-read as cancel_booking.
  select booked_count, capacity into v_new_count, v_new_capacity
    from public.session_slots where id = v_slot.id;

  -- ADDITIVE (069): resolved ONCE, before the first message that uses it.
  -- tpa.location_name coalesces a missing row to 'the academy' (066), so a
  -- concatenated body can never become NULL and violate notifications.body.
  v_loc_name := tpa.location_name(v_slot.location_id);

  if v_was_confirmed and v_new_count < v_new_capacity and v_slot.manually_confirmed_at is null then
    perform tpa.notify(
      b.player_id, 'session_reopened', 'Session reopened',
      'A player left your ' || initcap(v_slot.training_type) || ' session on ' || tpa.cairo_when(v_slot.starts_at)
        || ' at ' || v_loc_name || ' — it''s pending again until it fills.',
      v_slot.id, null)
    from public.bookings b
    where b.slot_id = v_slot.id and b.status = 'booked' and b.player_id <> v_booking.player_id;
  end if;

  -- v_slot is the PRE-update PL/pgSQL variable — still names the real type the
  -- player was removed from even though the column may have just been nulled.
  perform tpa.notify(
    v_booking.player_id, 'removed_from_session', 'Removed from a session',
    'You were removed from your ' || initcap(v_slot.training_type) || ' session on '
      || tpa.cairo_when(v_slot.starts_at) || ' at ' || v_loc_name || '. '
      || case when p_refund then 'Your credit was refunded.' else 'Your credit was not refunded.' end,
    v_slot_id, null);

  return jsonb_build_object('ok', true, 'refunded', p_refund);
end;
$fn$;


-- reschedule_session — a session moved in time. It cannot move BETWEEN branches
-- (no location parameter, and 062's trigger makes the column immutable), so naming
-- the slot's own branch is a restatement of where it still is, not a change.
create or replace function public.reschedule_session(p_slot_id text, p_coach_id text, p_capacity integer, p_starts_at timestamptz, p_ends_at timestamptz)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $fn$
declare
  v_slot  public.session_slots;
  v_moved boolean;
  v_loc_name text;   -- ADDITIVE (069, branch in session copy)
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

  -- ADDITIVE (069): resolved ONCE, before the first message that uses it.
  -- tpa.location_name coalesces a missing row to 'the academy' (066), so a
  -- concatenated body can never become NULL and violate notifications.body.
  v_loc_name := tpa.location_name(v_slot.location_id);

  if v_moved then
    perform tpa.notify(
      b.player_id, 'session_rescheduled', 'Session rescheduled',
      'Your ' || initcap(v_slot.training_type) || ' session moved to ' || tpa.cairo_when(p_starts_at)
        || ' at ' || v_loc_name || '.',
      p_slot_id, null)
    from public.bookings b
    where b.slot_id = p_slot_id and b.status = 'booked';
  end if;

  return jsonb_build_object('ok', true, 'moved', v_moved);
end;
$fn$;


-- tpa.send_session_reminders — both reminders, player and coach, in the one pass.
-- Idempotency is untouched: the reminded_at claim above still runs first and still
-- gates everything after it, so a slot is reminded at most once.
create or replace function tpa.send_session_reminders()
  returns integer
  language plpgsql
  security definer
  set search_path = ''
as $fn$
declare
  v_slot  record;
  v_count integer := 0;
begin
  for v_slot in
    select s.id,
           s.starts_at,
           s.training_type,
           s.coach_id,
           c.name as coach_name,
           -- ADDITIVE (069): resolved in the cursor, so both messages below
           -- name the same branch from one lookup per slot.
           tpa.location_name(s.location_id) as location_name,
           -- The real distance, rounded to 5 minutes, so the sentence stays true
           -- even on a catch-up run: normally "30 minutes", never a fixed claim.
           greatest(5, (5 * round(extract(epoch from (s.starts_at - now())) / 300.0))::int) as mins
      from public.session_slots s
      left join public.coaches c on c.id = s.coach_id
     where s.status = 'published'
       and s.reminded_at is null
       and s.starts_at > now()
       and s.starts_at <= now() + interval '35 minutes'
     order by s.starts_at
  loop
    -- Claim the slot FIRST. Anything after this line runs at most once per slot.
    update public.session_slots
       set reminded_at = now()
     where id = v_slot.id and reminded_at is null;
    if not found then continue; end if;

    -- Active bookings only: a cancelled booking is not court time anyone is owed a
    -- reminder about.
    perform tpa.notify(
      b.player_id,
      'session_reminder',
      'Starting soon',
      'Your ' || initcap(coalesce(v_slot.training_type, 'padel')) || ' session starts in '
        || v_slot.mins || ' minutes — ' || tpa.cairo_time_short(v_slot.starts_at)
        || ' with ' || coalesce(split_part(v_slot.coach_name, ' ', 1), 'your coach')
        || ' at ' || v_slot.location_name || '.',
      v_slot.id,
      b.id)
    from public.bookings b
    where b.slot_id = v_slot.id and b.status = 'booked';

    -- ── ADDITIVE (051): the coach of this session, in the SAME pass ────────
    -- Deliberately not a second function, a second window or a second stamp. The
    -- slot was already claimed above, so this line runs at most once per slot for
    -- exactly the same reason the players' reminders do — one pass, one stamp, all
    -- recipients. A coach record with no linked login resolves to no rows and
    -- nothing is sent; the players still get theirs either way.
    perform tpa.notify(
      p.id,
      'coach_session_reminder',
      'Starting soon',
      'You''re teaching a ' || initcap(coalesce(v_slot.training_type, 'padel'))
        || ' session in ' || v_slot.mins || ' minutes — '
        || tpa.cairo_time_short(v_slot.starts_at) || ' at ' || v_slot.location_name || '.',
      v_slot.id,
      null)
    from public.players p
    where p.coach_id = v_slot.coach_id and p.deleted_at is null;

    v_count := v_count + 1;
  end loop;
  return v_count;   -- slots reminded this run (for logging/alerting)
end;
$fn$;
