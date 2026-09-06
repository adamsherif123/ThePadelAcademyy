-- ============================================================================
-- Owner pings: nudge the academy's owners to go look at the admin whenever a
-- credit request is submitted or a session is booked.
--
-- ── why a flag, not a token list ──
-- The two owners use the consumer app as ordinary players, so their devices are
-- already in device_push_tokens. Recipients are therefore selected by a new
-- players.is_owner flag and the push pipeline resolves whatever token that player
-- currently has. Hardcoding the two Expo tokens would break silently the first
-- time either device reinstalled or rotated its token — and rotation is routine,
-- so the failure would be invisible until someone noticed the pings had stopped.
-- The flag also lets the academy change who counts as an owner with an UPDATE
-- instead of a deploy.
--
-- ── strictly additive to the two RPCs ──
-- request_credits and book_slot are reproduced here in full (create or replace
-- needs the whole body) but their logic is BYTE-IDENTICAL to
-- 20260816000035_delete_package.sql and 20260820000041_booking_window_guard.sql
-- respectively. The only changes are: two/three new `declare` locals, and one
-- `perform tpa.notify_owners(...)` immediately before the SUCCESS return. Every
-- validation, guard, lock, exception handler and {ok,reason} path is untouched,
-- and every rejection returns before reaching the ping — a booking that fails
-- notifies nobody. Proven by the concurrency suite (A-N) and the pgTAP deltas.
--
-- ── the fan-out bypasses tpa.notify, as create_news already does ──
-- tpa.notify inserts exactly one row per call. Selecting the owners and inserting
-- one row each in a single statement is behaviourally identical (notifications_
-- send_push is a row-level AFTER INSERT trigger with no WHEN clause, so it still
-- fires once per inserted row) and keeps the addition inside each money-critical
-- RPC down to a single PERFORM. Same reasoning create_news documents.
--
-- ── deep link ──
-- These land in the OWNERS' player app, which has no admin screens and no
-- browser-opening path in its tap handler. Rather than invent a destination the
-- client cannot honour, both types route to the in-app notifications centre,
-- where the message itself is the payload ("go check the admin"). See
-- apps/mobile/src/notifications/deepLink.ts.
-- ============================================================================

-- ── 1. the flag ───────────────────────────────────────────────────────────────
alter table public.players add column is_owner boolean not null default false;

comment on column public.players.is_owner is
  'Academy owner: receives owner_credit_request / owner_booking pings. Server-side only (not in @tpa/types), like the old is_admin flag was.';

-- Partial index: every fan-out below filters on exactly this predicate, and the
-- flagged set is two rows out of the whole roster.
create index players_is_owner_idx on public.players (id) where is_owner;

update public.players
   set is_owner = true
 where id in (
   'pl_5c59e21b-d07a-4940-8f21-bd8f50156144',  -- Mohamed elgaby
   'pl_75d072d8-fd9d-439d-aff2-fc60696b1a2d'   -- Aly Salem
 );

-- ── 2. Cairo time, short ──────────────────────────────────────────────────────
-- Sibling of tpa.cairo_when (20260727000014), same shape and same DST-correct
-- `at time zone 'Africa/Cairo'` conversion — cairo_when's "Sun 20 Jul at 6:00 AM"
-- is too long for "booked {time} slot with {coach}". Minutes appear only when
-- they're non-zero, so the common on-the-hour case reads "7pm", not "7:00pm".
create or replace function tpa.cairo_time_short(p_ts timestamptz)
  returns text
  language sql
  stable
  set search_path = ''
as $$
  select case
    when extract(minute from (p_ts at time zone 'Africa/Cairo')) = 0
      then lower(to_char(p_ts at time zone 'Africa/Cairo', 'FMHH12am'))
    else lower(to_char(p_ts at time zone 'Africa/Cairo', 'FMHH12:MIam'))
  end;
$$;

revoke all on function tpa.cairo_time_short(timestamptz) from public, anon, authenticated;

-- ── 3. the fan-out ────────────────────────────────────────────────────────────
-- One row per flagged owner, minus the actor (an owner requesting their own
-- credits or booking their own session must not ping themselves) and minus any
-- owner who has since deleted their account.
create or replace function tpa.notify_owners(
  p_type            text,
  p_title           text,
  p_body            text,
  p_exclude_player  text,
  p_slot            text default null
)
  returns void
  language sql
  security definer
  set search_path = ''
as $$
  insert into public.notifications
    (id, player_id, type, slot_id, booking_id, title, body, created_at, read_at, pushed_at)
  select 'nt_' || gen_random_uuid(), p.id, p_type, p_slot, null, p_title, p_body, now(), null, null
  from public.players p
  where p.is_owner
    and p.deleted_at is null
    and p.id is distinct from p_exclude_player;
$$;

revoke all on function tpa.notify_owners(text, text, text, text, text) from public, anon, authenticated;

-- ── 4. the two new notification types ─────────────────────────────────────────
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'session_confirmed', 'session_cancelled', 'removed_from_session',
    'session_rescheduled', 'credits_granted', 'credit_request_rejected',
    'admin_booked', 'session_reopened', 'news_published',
    'owner_credit_request', 'owner_booking'));

-- ── 5. request_credits — unchanged except the ping on the success return ──────
create or replace function public.request_credits(p_package_id text, p_payment_method text, p_proof_path text default null)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_player     text := public.current_player_id();
  v_pkg        public.packages;
  v_id         text := 'cr_' || gen_random_uuid();
  v_is_trial   boolean;
  v_constraint text;
  v_who        text;   -- ADDITIVE (owner ping)
begin
  if v_player is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;
  if p_payment_method not in ('instapay', 'cash') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payment_method');
  end if;
  if exists (select 1 from public.credit_requests where player_id = v_player and status = 'pending') then
    return jsonb_build_object('ok', false, 'reason', 'already_pending');
  end if;
  select * into v_pkg from public.packages where id = p_package_id;
  if not found then           return jsonb_build_object('ok', false, 'reason', 'package_missing');  end if;
  if not v_pkg.is_active then  return jsonb_build_object('ok', false, 'reason', 'package_inactive'); end if;

  v_is_trial := (v_pkg.training_type = 'trial');
  -- A trial is once-per-player, ever (A5). Reject a second cleanly, never as a crash.
  if v_is_trial and tpa.trial_used(v_player) then
    return jsonb_build_object('ok', false, 'reason', 'trial_already_used');
  end if;

  if p_proof_path is not null and split_part(p_proof_path, '/', 1) <> v_player then
    return jsonb_build_object('ok', false, 'reason', 'invalid_proof_path');
  end if;

  begin
    insert into public.credit_requests (id, player_id, package_id, payment_method, proof_path, status, created_at, is_trial)
      values (v_id, v_player, p_package_id, p_payment_method, p_proof_path, 'pending', now(), v_is_trial);
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'credit_requests_one_trial_per_player' then
        return jsonb_build_object('ok', false, 'reason', 'trial_already_used');
      end if;
      return jsonb_build_object('ok', false, 'reason', 'already_pending');
    when foreign_key_violation then
      -- The package was deleted (delete_package's hard-delete) between our read
      -- above and this insert — same clean reason as "no such package".
      return jsonb_build_object('ok', false, 'reason', 'package_missing');
  end;
  -- ── ADDITIVE: remind the owners to go look at the admin ──────────────────
  -- Emitted only here, on the success return, AFTER the request row is committed.
  -- Every early return above is a rejection and reaches none of this.
  select name into v_who from public.players where id = v_player;
  perform tpa.notify_owners(
    'owner_credit_request',
    'New credit request',
    coalesce(v_who, 'A player') || ' requested ' || v_pkg.session_count || ' '
      || initcap(v_pkg.training_type) || ' Credits',
    v_player,
    null);

  return jsonb_build_object('ok', true, 'request_id', v_id);
end;
$$;

-- ── 6. book_slot — unchanged except the ping on the success return ────────────
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

  return jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'credit_batch_id', v_batch_id);
end;
$$;

revoke all on function public.book_slot(text, text) from public;
grant execute on function public.book_slot(text, text) to authenticated;
revoke all on function public.request_credits(text, text, text) from public;
grant execute on function public.request_credits(text, text, text) to authenticated;
