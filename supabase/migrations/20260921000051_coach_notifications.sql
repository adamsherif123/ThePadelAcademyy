-- ============================================================================
-- Coach mode, phase 4 — the two pushes a coach actually wants.
--
--   coach_booking_alert    — somebody just booked your session.
--   coach_session_reminder — you're teaching in ~30 minutes.
--
-- A coach is a player (migration 049), so they already have device tokens and the
-- whole notify → trigger → send-push chain works for them untouched. send-push is
-- type-agnostic (it receives a notification_id and reads the row), so neither new
-- type needs it redeployed.
--
-- ── the recipient ──
-- A slot points at a coaches ROW (session_slots.coach_id); the person to notify is
-- the LOGIN linked to it — `players where coach_id = <that id>`. A coaches record
-- with no linked account (created in the admin, never linked) resolves to no rows,
-- and nothing is sent. That is the correct outcome rather than an error: there is
-- nobody to notify. The partial unique index from 049 guarantees at most one
-- account per coach, so "resolve the coach's login" is always 0 or 1 rows.
--
-- ── no parallel machinery ──
-- The alert is one more emit in book_slot's success branch, beside the owner ping
-- and the booker's own confirmation. The reminder is one more recipient inside the
-- EXISTING pg_cron pass — same job, same 35-minute window, same reminded_at stamp.
-- No second function, no second schedule, no second idempotency argument to keep
-- true.
-- ============================================================================

-- ── 1. the two new notification types ────────────────────────────────────────
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'session_confirmed', 'session_cancelled', 'removed_from_session',
    'session_rescheduled', 'credits_granted', 'credit_request_rejected',
    'admin_booked', 'session_reopened', 'news_published',
    'owner_credit_request', 'owner_booking', 'owner_cancellation',
    'session_reminder', 'booking_confirmation',
    'coach_booking_alert', 'coach_session_reminder'));

-- ── 2. the reminder — the 048 body with ONE extra recipient in the same pass ──
create or replace function tpa.send_session_reminders()
  returns integer
  language plpgsql
  security definer
  set search_path = ''
as $$
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
        || ' with ' || coalesce(split_part(v_slot.coach_name, ' ', 1), 'your coach') || '.',
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
        || tpa.cairo_time_short(v_slot.starts_at) || '.',
      v_slot.id,
      null)
    from public.players p
    where p.coach_id = v_slot.coach_id and p.deleted_at is null;

    v_count := v_count + 1;
  end loop;
  return v_count;   -- slots reminded this run (for logging/alerting)
end;
$$;
revoke all on function tpa.send_session_reminders() from public, anon, authenticated;

-- ── 3. book_slot — the 050 body with ONE added emit in the success branch ────
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
  v_who           text;   -- ADDITIVE (owner ping)
  v_coach_player  text;   -- ADDITIVE (051, coach alert)
  v_coach         text;   -- ADDITIVE (owner ping)
begin
  v_player := public.current_player_id();
  if v_player is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  -- ADDITIVE (050): a coach account is a COACH, not a player who also books. The
  -- refusal sits here, immediately after identity and before the slot is even read,
  -- so a coach-caller never reaches the guarded UPDATE, never touches a credit
  -- batch, and never emits a notification. Nothing below this line changed.
  if (select public.current_coach_id()) is not null then
    return jsonb_build_object('ok', false, 'reason', 'coach_cannot_book');
  end if;

  select * into v_slot from public.session_slots where id = p_slot_id;
  if not found then           return jsonb_build_object('ok', false, 'reason', 'slot_missing');   end if;
  if v_slot.status <> 'published' then return jsonb_build_object('ok', false, 'reason', 'slot_cancelled'); end if;
  if v_slot.starts_at <= now() then    return jsonb_build_object('ok', false, 'reason', 'slot_in_past');  end if;

  select gender, level into v_pgender, v_plevel from public.players where id = v_player;
  -- gender_mismatch removed here (this migration) — gender is now display-only.

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
  where player_id = v_player and training_type = v_effective_type
    and quantity_remaining > 0 and expires_at > now()
  order by expires_at asc, id asc
  limit 1;
  if v_batch_id is null then return jsonb_build_object('ok', false, 'reason', 'no_usable_credit'); end if;

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
        -- NEW: an empty slot can't take its first booking inside the window.
        and (booked_count > 0 or starts_at - now() >= tpa.booking_window())
      returning booked_count, capacity into v_new_count, v_capacity;
    if not found then
      select * into v_slot from public.session_slots where id = p_slot_id;
      if not found then                    return jsonb_build_object('ok', false, 'reason', 'slot_missing');   end if;
      if v_slot.status <> 'published' then return jsonb_build_object('ok', false, 'reason', 'slot_cancelled'); end if;
      if v_slot.starts_at <= now() then    return jsonb_build_object('ok', false, 'reason', 'slot_in_past');  end if;
      if v_slot.training_type is not null and v_slot.training_type <> v_effective_type then
        return jsonb_build_object('ok', false, 'reason', 'type_mismatch');
      end if;
      -- NEW: report the specific reason before falling back to the generic
      -- slot_full — an empty slot inside the window isn't "full", it's closed.
      if v_slot.booked_count = 0 and v_slot.starts_at - now() < tpa.booking_window() then
        return jsonb_build_object('ok', false, 'reason', 'booking_window_closed');
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

  -- ── ADDITIVE: remind the owners to go look at the admin ──────────────────
  -- Emitted only here, on the success return, AFTER the guarded UPDATE has taken
  -- the seat, the credit is decremented and the booking row exists. Every
  -- rejection above returns earlier and notifies nobody. Nothing in the guarded
  -- block, the lock order, or any {ok,reason} is touched.
  -- v_slot is the row read BEFORE the update; starts_at and coach_id are not
  -- among the columns that update can change, so both are still correct here.
  select name into v_who from public.players where id = v_player;
  select name into v_coach from public.coaches where id = v_slot.coach_id;
  perform tpa.notify_owners(
    'owner_booking',
    'New booking',
    coalesce(v_who, 'A player') || ' booked ' || tpa.cairo_time_short(v_slot.starts_at)
      || ' slot with ' || coalesce(split_part(v_coach, ' ', 1), 'a coach'),
    v_player,
    p_slot_id);

  -- ── ADDITIVE (048): the booker's own confirmation ────────────────────────
  -- Same placement and the same preconditions as the owner ping directly above:
  -- the seat is taken, the credit is spent and the booking row exists, so a
  -- rejected booking can never reach this line. It goes to the BOOKER alone —
  -- `session_confirmed` above goes to the OTHER players when the slot fills
  -- (`player_id <> v_player`), so the two never double up on one person.
  -- v_coach is already resolved by the owner ping; v_effective_type is the type
  -- the booking actually took (the open-slot case resolves it from p_training_type).
  perform tpa.notify(
    v_player,
    'booking_confirmation',
    'You''re booked!',
    'Your ' || initcap(v_effective_type) || ' session on ' || tpa.cairo_when(v_slot.starts_at)
      || ' with ' || coalesce(split_part(v_coach, ' ', 1), 'your coach') || ' is booked.',
    p_slot_id,
    v_booking_id);

  -- ── ADDITIVE (051): tell the COACH somebody booked their session ─────────
  -- Same branch and the same preconditions as the two emits above, so a rejected
  -- booking can never reach it. The recipient is the PLAYER ACCOUNT linked to this
  -- slot's coach record (players.coach_id, migration 049) — a coaches row with no
  -- linked login resolves to null and nothing is sent, which is the correct
  -- outcome, not an error: there is simply nobody to notify.
  --
  -- No recipient can receive two of these. The booker gets booking_confirmation;
  -- the coach gets coach_booking_alert; and the two can never be the same person
  -- because a coach account cannot book at all (refused in this very function,
  -- migration 050).
  select id into v_coach_player
    from public.players
   where coach_id = v_slot.coach_id and deleted_at is null;

  if v_coach_player is not null then
    perform tpa.notify(
      v_coach_player,
      'coach_booking_alert',
      'New booking',
      coalesce(v_who, 'A player') || ' booked your ' || initcap(v_effective_type)
        || ' session on ' || tpa.cairo_when(v_slot.starts_at) || '.',
      p_slot_id,
      v_booking_id);
  end if;

  return jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'credit_batch_id', v_batch_id);
end;
$$;
revoke all on function public.book_slot(text, text) from public;
grant execute on function public.book_slot(text, text) to authenticated;
