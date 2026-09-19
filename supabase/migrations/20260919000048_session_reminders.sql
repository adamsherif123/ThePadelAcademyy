-- ============================================================================
-- S-R — two new player notifications.
--
--   booking_confirmation — REACTIVE. Emitted inside book_slot's success branch,
--     to the booker alone, the moment their seat is taken.
--   session_reminder     — SCHEDULED. Emitted ~30 minutes before a session, to
--     every player still holding an active booking on it. No event triggers
--     this, so it needs a clock: pg_cron, calling tpa.send_session_reminders().
--
-- Both ride the existing machinery untouched: tpa.notify writes the row, the
-- notifications_send_push trigger fires send-push, and send-push forwards
-- whatever title/body the row carries. The Edge Function is type-agnostic (it
-- receives only a notification_id and reads the row), so neither new type needs
-- it redeployed.
-- ============================================================================

-- ── 1. per-slot reminder stamp ───────────────────────────────────────────────
-- null = this slot has not been reminded. The whole idempotency argument rests on
-- this column: the cron's WHERE pins `reminded_at is null` and its UPDATE stamps it
-- in the same transaction as the fan-out, so a slot reminds EXACTLY once however
-- many times the job runs. Nullable and defaulted-null, so every existing slot is
-- simply "not reminded" — and the ones already in the past are excluded by the
-- window anyway, so applying this migration cannot retro-fire a single reminder.
alter table public.session_slots add column if not exists reminded_at timestamptz;

-- ── 2. the two new notification types ────────────────────────────────────────
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'session_confirmed', 'session_cancelled', 'removed_from_session',
    'session_rescheduled', 'credits_granted', 'credit_request_rejected',
    'admin_booked', 'session_reopened', 'news_published',
    'owner_credit_request', 'owner_booking', 'owner_cancellation',
    'session_reminder', 'booking_confirmation'));

-- ── 3. the reminder fan-out ──────────────────────────────────────────────────
-- WINDOW: `starts_at > now() and starts_at <= now() + 35 minutes`, run every 5
-- minutes. The upper bound is 35 rather than 30 so the steady-state reminder lands
-- 30-35 minutes ahead; the absence of a lower bound (other than "still in the
-- future") is what makes a MISS impossible. If a run is delayed, skipped, or the
-- database was down, the slot simply stays eligible on every subsequent run until
-- it starts — it can be late, it can never be lost. And it can never fire for a
-- session that has already begun.
--
-- NO-DOUBLE: `reminded_at is null` in the WHERE, plus a guarded UPDATE that re-pins
-- `reminded_at is null` and bails when it doesn't match. Two overlapping runs both
-- see the slot, both try to stamp it, exactly one succeeds and only that one fans
-- out — the same guarded-update discipline the booking path uses.
--
-- TIMEZONE: `starts_at` is timestamptz, so "30 minutes before" is arithmetic on an
-- absolute instant — no Cairo conversion is involved in the timing, and DST cannot
-- shift it. Cairo appears only in the DISPLAYED time (tpa.cairo_time_short).
--
-- COST: a range scan on the existing session_slots(starts_at) index over a 35-minute
-- window — a handful of rows per run, twelve runs an hour.
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

    v_count := v_count + 1;
  end loop;
  return v_count;   -- slots reminded this run (for logging/alerting)
end;
$$;

-- Cron-only surface, exactly like public.fail_stale_purchases (S13).
revoke all on function tpa.send_session_reminders() from public, anon, authenticated;

-- ── 4. the schedule ──────────────────────────────────────────────────────────
-- S13 deliberately kept its cron.schedule OUT of the migration because pg_cron
-- "isn't guaranteed on every local stack" and an unguarded CREATE EXTENSION would
-- break `supabase db reset`. That concern is honoured here rather than dropped: the
-- scheduling is wrapped in an availability check and executed dynamically, so on a
-- stack without pg_cron the whole block is a no-op and the reset still succeeds.
-- Where pg_cron IS available (both hosted projects, and the current local image)
-- the job is created by the migration, so the schedule is reproducible instead of
-- being a hand-run step someone can forget on one environment.
--
-- cron.schedule() upserts by job name, so re-running this is idempotent.
do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
    execute $c$ select cron.schedule('send-session-reminders', '*/5 * * * *',
                                     $job$ select tpa.send_session_reminders(); $job$) $c$;
  end if;
end
$do$;

-- ── 5. book_slot — the 044 body, with ONE addition in the success branch ─────
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
  v_coach         text;   -- ADDITIVE (owner ping)
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

  return jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'credit_batch_id', v_batch_id);
end;
$$;
revoke all on function public.book_slot(text, text) from public;
grant execute on function public.book_slot(text, text) to authenticated;
