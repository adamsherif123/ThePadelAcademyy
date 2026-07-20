-- ============================================================================
-- S12 — notifications data layer: the rows, the emit helper, the emit in every
-- event RPC, the device-token table, and the push-send trigger. Client wiring
-- (permissions, token registration, the in-app centre) and the real Android push
-- proof are the NEXT session.
--
-- INVARIANT (the whole point): a notification row is minted ONLY by a SECURITY
-- DEFINER RPC, through the single tpa.notify() helper — exactly like credit_batches.
-- No role (anon/authenticated/admin) may INSERT. That is what stops a player forging
-- "you received 100 credits". A player may read only their own, and may write only
-- read_at (column-grant, the same mechanism that stops is_admin self-promotion).
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- TASK 0 — the notifications table.
-- Taxonomy: the five server-side events that change a player's session/wallet state.
-- NOT credits_expiring (time-based → needs a pg_cron scan; the Home banner already
-- covers it in-app) — deferred, not built. No `data jsonb`: slot_id/booking_id are
-- typed, FK-validated deep-link targets; a freeform payload would duplicate them
-- without referential integrity and invite drift. Add it only when a type needs more.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.notifications (
  id          text primary key,                                   -- nt_… supplied by tpa.notify, no default
  player_id   text not null references public.players (id),
  type        text not null check (type in (
                'session_confirmed', 'session_cancelled', 'removed_from_session',
                'session_rescheduled', 'credits_granted')),
  slot_id     text references public.session_slots (id),           -- deep-link (session-related types)
  booking_id  text references public.bookings (id),                -- reserved for future per-booking types
  title       text not null,
  body        text not null,
  created_at  timestamptz not null,
  read_at     timestamptz,                                         -- null = unread
  pushed_at   timestamptz                                          -- null = the push-send trigger hasn't claimed it
);

-- The history feed (newest first) and the unread-badge path.
create index notifications_player_created on public.notifications (player_id, created_at desc);
create index notifications_unread on public.notifications (player_id) where read_at is null;

alter table public.notifications enable row level security;
-- Wipe Supabase's default grants on this NEW table first (it auto-grants
-- authenticated full INSERT/UPDATE/DELETE via ALTER DEFAULT PRIVILEGES). Without
-- this, the column-limited UPDATE below is defeated — a player would hold UPDATE on
-- every column. Same known-baseline discipline as S5's rls.sql.
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
-- Column-limited UPDATE: a player may flip read_at on their own rows and NOTHING
-- else. Rewriting body/title/type or reassigning player_id is rejected at the
-- privilege layer (42501) before RLS is even consulted — the anti-forgery guard.
grant update (read_at) on public.notifications to authenticated;
-- (No INSERT/DELETE grant to anyone: rows are minted by tpa.notify in the RPCs.)

create policy notifications_select_own on public.notifications
  for select to authenticated
  using (player_id = (select public.current_player_id()));

create policy notifications_update_own on public.notifications
  for update to authenticated
  using (player_id = (select public.current_player_id()))
  with check (player_id = (select public.current_player_id()));

-- ─────────────────────────────────────────────────────────────────────────────
-- TASK 4 — device_push_tokens. A player upserts + reads only their own. Client
-- registration is the next session; the table + own-only policies exist now.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.device_push_tokens (
  id               text primary key,                              -- dpt_… supplied by the client
  player_id        text not null references public.players (id),
  expo_push_token  text not null unique,                          -- one row per physical device token
  platform         text not null check (platform in ('ios', 'android')),
  created_at       timestamptz not null,
  last_seen_at     timestamptz not null
);
create index device_push_tokens_player on public.device_push_tokens (player_id);

alter table public.device_push_tokens enable row level security;
revoke all on public.device_push_tokens from anon, authenticated;   -- clear default grants first
grant select, insert, update on public.device_push_tokens to authenticated;

create policy device_push_tokens_select_own on public.device_push_tokens
  for select to authenticated
  using (player_id = (select public.current_player_id()));

create policy device_push_tokens_insert_own on public.device_push_tokens
  for insert to authenticated
  with check (player_id = (select public.current_player_id()));

create policy device_push_tokens_update_own on public.device_push_tokens
  for update to authenticated
  using (player_id = (select public.current_player_id()))
  with check (player_id = (select public.current_player_id()));

-- ─────────────────────────────────────────────────────────────────────────────
-- TASK 1 — the ONE emit helper + a Cairo time formatter. tpa.* is private (not in
-- the PostgREST API); execute is revoked from the client roles. Every event RPC
-- runs as its (postgres) definer, so it can call these and INSERT past the no-INSERT
-- grants — the only path that ever writes a notification row.
-- ─────────────────────────────────────────────────────────────────────────────

-- Cairo wall-clock, DST-correct (Postgres tzdata handles the 2023+ DST). One place
-- so every notification phrases a time the same way: "Sun 20 Jul at 6:00 AM".
create or replace function tpa.cairo_when(p_ts timestamptz)
  returns text
  language sql
  stable
  set search_path = ''
as $$
  select to_char(p_ts at time zone 'Africa/Cairo', 'FMDy DD FMMon "at" FMHH12:MI AM');
$$;

create or replace function tpa.notify(
  p_player  text,
  p_type    text,
  p_title   text,
  p_body    text,
  p_slot    text default null,
  p_booking text default null
)
  returns void
  language sql
  security definer
  set search_path = ''
as $$
  insert into public.notifications
    (id, player_id, type, slot_id, booking_id, title, body, created_at, read_at, pushed_at)
  values
    ('nt_' || gen_random_uuid(), p_player, p_type, p_slot, p_booking, p_title, p_body, now(), null, null);
$$;

revoke all on function tpa.cairo_when(timestamptz) from public, anon, authenticated;
revoke all on function tpa.notify(text, text, text, text, text, text) from public, anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- TASK 2 — wire the straightforward events (each INSIDE the RPC's transaction).
-- ═════════════════════════════════════════════════════════════════════════════

-- ── cancel_session: notify every refunded player (rebased on the S7b.1 body — the
-- deterministic credit-lock order that fixed the two-cancel deadlock is preserved
-- byte-for-byte; the ONLY addition is the tpa.notify inside the loop). ──
create or replace function public.cancel_session(p_slot_id text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_slot  public.session_slots;
  v_bk    record;
  v_count int := 0;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;

  select * into v_slot from public.session_slots where id = p_slot_id for update;
  if not found then                   return jsonb_build_object('ok', false, 'reason', 'slot_missing');      end if;
  if v_slot.status = 'cancelled' then return jsonb_build_object('ok', false, 'reason', 'already_cancelled'); end if;

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
        || ' was cancelled and your credit refunded.',
      p_slot_id, null);
    v_count := v_count + 1;
  end loop;

  update public.session_slots set status = 'cancelled', booked_count = 0 where id = p_slot_id;

  return jsonb_build_object('ok', true, 'refunded_count', v_count);
end;
$$;

-- ── remove_booking: notify the removed player, with the refund/forfeit truth. ──
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

  update public.session_slots set booked_count = greatest(0, booked_count - 1) where id = v_slot_id;
  update public.bookings set status = 'cancelled', cancelled_at = now() where id = p_booking_id;
  if p_refund then perform tpa.refund_booking(p_booking_id); end if;

  perform tpa.notify(
    v_booking.player_id, 'removed_from_session', 'Removed from a session',
    'You were removed from your ' || initcap(v_slot.training_type) || ' session on '
      || tpa.cairo_when(v_slot.starts_at) || '. '
      || case when p_refund then 'Your credit was refunded.' else 'Your credit was not refunded.' end,
    v_slot_id, null);

  return jsonb_build_object('ok', true, 'refunded', p_refund);
end;
$$;

-- ── grant_credits: notify the player of the comp. ──
create or replace function public.grant_credits(p_player_id text, p_training_type text, p_quantity int, p_note text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_batch_id text := 'cb_' || gen_random_uuid();
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;
  if not exists (select 1 from public.players where id = p_player_id) then
    return jsonb_build_object('ok', false, 'reason', 'player_missing');
  end if;
  if p_note is null or btrim(p_note) = '' then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;
  if p_quantity < 1 then return jsonb_build_object('ok', false, 'reason', 'quantity_below_one'); end if;

  insert into public.credit_batches
    (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at, note)
  values
    (v_batch_id, p_player_id, 'admin_grant', null, p_training_type, p_quantity, p_quantity,
     now() + tpa.credit_expiry(), now(), btrim(p_note));

  perform tpa.notify(
    p_player_id, 'credits_granted', 'Credits added',
    'You received ' || p_quantity || ' ' || initcap(p_training_type) || ' credit'
      || case when p_quantity = 1 then '' else 's' end || '.',
    null, null);

  return jsonb_build_object('ok', true, 'credit_batch_id', v_batch_id);
end;
$$;

-- ── reschedule_session: NEW SECURITY DEFINER RPC. The reschedule was a direct
-- column-limited admin UPDATE (apps/admin data layer); it moves here so the emit can
-- be atomic with the time change and minted by an RPC (the invariant). Sets ONLY the
-- four editable columns (never status/booked_count), keeps the same validations, maps
-- the coach-overlap EXCLUDE (23P01) to a clean reason, and — only when the start
-- actually moves — notifies every booked player. This is the notification the S4c.3
-- reschedule warning has been promising; the modal can stop saying "you must tell them".
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
    update public.session_slots
      set coach_id = p_coach_id, capacity = p_capacity, starts_at = p_starts_at, ends_at = p_ends_at
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

revoke all on function public.reschedule_session(text, text, int, timestamptz, timestamptz) from public;
grant execute on function public.reschedule_session(text, text, int, timestamptz, timestamptz) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- TASK 3 — confirmation emission. Fill-confirmation is DERIVED (S11.1:
-- booked_count >= capacity), so there is no event when the Nth booking fills a slot.
-- We detect the pending→full transition in the booking RPCs and the pending→confirmed
-- transition in confirm_session, and announce "confirmed" EXACTLY ONCE:
--   * book_slot / admin_book_player emit only when THIS booking fills the slot
--     (v_new = capacity), to the OTHER active bookings.
--   * confirm_session emits only when the slot was genuinely pending (not already
--     full, not already manually confirmed) — so a slot that already filled (and
--     already announced) is not announced again.
-- PROTECT THE PROVEN LINE: the guarded WHERE and the `+ 1` SET are byte-identical to
-- S11.1; the only change is a RETURNING to read the post-increment count, and the
-- emit is a NON-LOCKING select of the other bookings + inserts that reference only
-- slot_id (a row THIS txn already holds) — no new lock ordering, no new deadlock.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.book_slot(p_slot_id text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_player     text;
  v_slot       public.session_slots;
  v_pgender    text;
  v_plevel     text;
  v_batch_id   text;
  v_booking_id text;
  v_new_count  int;
  v_capacity   int;
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
  if v_slot.level is not null and v_slot.level <> v_plevel then
    return jsonb_build_object('ok', false, 'reason', 'level_mismatch');
  end if;

  select id into v_batch_id
  from public.credit_batches
  where player_id = v_player and training_type = v_slot.training_type
    and quantity_remaining > 0 and expires_at > now()
  order by expires_at asc, id asc
  limit 1;
  if v_batch_id is null then return jsonb_build_object('ok', false, 'reason', 'no_usable_credit'); end if;

  v_booking_id := 'bk_' || gen_random_uuid();
  begin
    -- Guarded increment: WHERE + SET byte-identical to S11.1 (the oversell/no-orphan
    -- guarantees). The added RETURNING reads the post-increment count under the row
    -- lock — accurate for the fill test below.
    update public.session_slots
      set booked_count = booked_count + 1
      where id = p_slot_id and booked_count < capacity
        and status = 'published' and starts_at > now()
      returning booked_count, capacity into v_new_count, v_capacity;
    if not found then
      select * into v_slot from public.session_slots where id = p_slot_id;
      if not found then                    return jsonb_build_object('ok', false, 'reason', 'slot_missing');   end if;
      if v_slot.status <> 'published' then return jsonb_build_object('ok', false, 'reason', 'slot_cancelled'); end if;
      if v_slot.starts_at <= now() then    return jsonb_build_object('ok', false, 'reason', 'slot_in_past');  end if;
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

  -- This booking filled the slot → the OTHER active bookings are now confirmed. The
  -- booker gets their in-app booked-success feedback, so they need no row. Non-locking
  -- read; notifications reference slot_id (locked by this txn) only, booking_id null.
  if v_new_count = v_capacity then
    perform tpa.notify(
      b.player_id, 'session_confirmed', 'Session confirmed',
      'Your ' || initcap(v_slot.training_type) || ' session on ' || tpa.cairo_when(v_slot.starts_at)
        || ' is confirmed.',
      p_slot_id, null)
    from public.bookings b
    where b.slot_id = p_slot_id and b.status = 'booked' and b.player_id <> v_player;
  end if;

  return jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'credit_batch_id', v_batch_id);
end;
$$;

create or replace function public.admin_book_player(p_slot_id text, p_player_id text, p_override boolean)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_slot        public.session_slots;
  v_pgender     text;
  v_plevel      text;
  v_batch_id    text;
  v_booking_id  text;
  v_mismatch    boolean := false;
  v_new_count   int;
  v_capacity    int;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;

  select * into v_slot from public.session_slots where id = p_slot_id;
  if not found then                       return jsonb_build_object('ok', false, 'reason', 'slot_missing');    end if;
  select gender, level into v_pgender, v_plevel from public.players where id = p_player_id;
  if not found then                       return jsonb_build_object('ok', false, 'reason', 'player_missing');  end if;
  if v_slot.status <> 'published' then    return jsonb_build_object('ok', false, 'reason', 'slot_cancelled'); end if;
  if v_slot.starts_at <= now() then       return jsonb_build_object('ok', false, 'reason', 'slot_in_past');   end if;

  v_mismatch := (v_slot.gender is not null and v_slot.gender <> v_pgender)
             or (v_slot.level  is not null and v_slot.level  <> v_plevel);
  if not p_override then
    if v_slot.gender is not null and v_slot.gender <> v_pgender then
      return jsonb_build_object('ok', false, 'reason', 'gender_mismatch');
    end if;
    if v_slot.level is not null and v_slot.level <> v_plevel then
      return jsonb_build_object('ok', false, 'reason', 'level_mismatch');
    end if;
  end if;

  select id into v_batch_id
  from public.credit_batches
  where player_id = p_player_id and training_type = v_slot.training_type
    and quantity_remaining > 0 and expires_at > now()
  order by expires_at asc, id asc
  limit 1;
  if v_batch_id is null then return jsonb_build_object('ok', false, 'reason', 'no_usable_credit'); end if;

  v_booking_id := 'bk_' || gen_random_uuid();
  begin
    update public.session_slots
      set booked_count = booked_count + 1
      where id = p_slot_id and booked_count < capacity
        and status = 'published' and starts_at > now()
      returning booked_count, capacity into v_new_count, v_capacity;
    if not found then
      select * into v_slot from public.session_slots where id = p_slot_id;
      if v_slot.status <> 'published' then return jsonb_build_object('ok', false, 'reason', 'slot_cancelled'); end if;
      if v_slot.starts_at <= now() then    return jsonb_build_object('ok', false, 'reason', 'slot_in_past');  end if;
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

  -- Filling by an admin add → the OTHER active bookings are confirmed. The just-added
  -- player is excluded (an admin-added player's own "you've been booked" is a future
  -- notification type, not in the S12 taxonomy).
  if v_new_count = v_capacity then
    perform tpa.notify(
      b.player_id, 'session_confirmed', 'Session confirmed',
      'Your ' || initcap(v_slot.training_type) || ' session on ' || tpa.cairo_when(v_slot.starts_at)
        || ' is confirmed.',
      p_slot_id, null)
    from public.bookings b
    where b.slot_id = p_slot_id and b.status = 'booked' and b.player_id <> p_player_id;
  end if;

  return jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'credit_batch_id', v_batch_id,
    'overridden', (p_override and v_mismatch));
end;
$$;

-- ── confirm_session: emit session_confirmed to all booked players ONLY on the
-- genuine pending→confirmed transition (not already full, not already manually
-- confirmed), so "confirmed" is announced exactly once whether it filled or Rania
-- confirmed it. Body of S11.1 unchanged except the one emit. ──
create or replace function public.confirm_session(p_slot_id text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_slot public.session_slots;
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
  if v_slot.booked_count < v_slot.capacity then
    perform tpa.notify(
      b.player_id, 'session_confirmed', 'Session confirmed',
      'Your ' || initcap(v_slot.training_type) || ' session on ' || tpa.cairo_when(v_slot.starts_at)
        || ' is confirmed.',
      p_slot_id, null)
    from public.bookings b
    where b.slot_id = p_slot_id and b.status = 'booked';
  end if;

  return jsonb_build_object('ok', true, 'already_confirmed', false);
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- TASK 5 — push-send trigger. On a notification INSERT, fire the send-push Edge
-- Function asynchronously via pg_net (fire-and-forget: it does NOT block or roll back
-- the event RPC). The URL + shared secret live in a private, single-row config table
-- populated out-of-band (never hard-coded, never the service_role key); if unset the
-- trigger no-ops, so the migration is safe to run before the function is configured.
-- ═════════════════════════════════════════════════════════════════════════════
create extension if not exists pg_net;

-- Private config (tpa is not in the PostgREST API). One row, id fixed to 1. Holds the
-- send-push URL and the shared x-trigger-secret only — NOT the service_role key.
create table if not exists tpa.push_config (
  id             int primary key default 1 check (id = 1),
  send_push_url  text,
  trigger_secret text
);
insert into tpa.push_config (id) values (1) on conflict do nothing;
revoke all on table tpa.push_config from public, anon, authenticated;

create or replace function tpa.on_notification_created()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  select send_push_url, trigger_secret into v_url, v_secret from tpa.push_config where id = 1;
  if v_url is not null and v_url <> '' then
    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-trigger-secret', coalesce(v_secret, '')),
      body    := jsonb_build_object('notification_id', new.id)
    );
  end if;
  return null;
end;
$$;

create trigger notifications_send_push
  after insert on public.notifications
  for each row execute function tpa.on_notification_created();
