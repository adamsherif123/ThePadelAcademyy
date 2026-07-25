-- ============================================================================
-- Booking rework (backend) — a slot's training_type starts UNSET; the first
-- booking picks it and fixes it permanently. Schema + book_slot/admin_book_player
-- + the once-empty revert rule. Client picker is a LATER session — nothing here
-- touches apps/mobile, apps/admin, or @tpa/types; see the session report for why
-- that boundary was chosen and what it defers.
--
-- ── TASK 0 (report) — blast radius, in one place ──
-- Everywhere training_type/capacity on session_slots was assumed present:
--   * book_slot / admin_book_player — credit match (`training_type = slot's`),
--     gender/level gate, the guarded capacity increment. All touched below.
--   * cancel_booking / remove_booking — read training_type only for notification
--     COPY (initcap(...)); read booked_count/capacity to free a seat. Both still
--     work once type/capacity are null on an UNBOOKED slot — no live slot reaches
--     these with training_type null (untyped ⟺ zero active bookings, an invariant
--     this migration's rules maintain), so the notification copy is never built
--     from a null value. Both gain the REVERT logic (Task 3).
--   * cancel_session — cancels every active booking AND the whole slot in one
--     move; a cancelled slot is retired, not reopened, so no revert applies here.
--     Untouched.
--   * confirm_session — touches only manually_confirmed_at. Untouched; capacity
--     is never null so `booked_count >= capacity` (S11.1's derived-fill read,
--     both SQL-side notify and @tpa/core's isSessionConfirmed) is always a valid
--     comparison, typed or not.
--   * reschedule_session — moves time/coach/capacity; never touches
--     training_type (already excluded from the admin UPDATE grant — see below).
--     Its own `capacity < booked_count` guard is untouched and still correct.
--   * grant_credits / record_cash_purchase / settle_purchase — mint against
--     packages.training_type or an explicit admin-chosen type; no session_slots
--     involvement at all. Untouched.
--   * RLS — session_slots' SELECT policies filter on status/is_admin() only, never
--     training_type. The INSERT grant already lists training_type as an
--     ADMIN-WRITABLE column (so an admin can leave it out of an insert once the
--     column is nullable — no grant change needed); the UPDATE grant already
--     EXCLUDES training_type (an admin edit already cannot change an existing
--     type — rule 1's immutability was, for the admin path, already true).
--   * Indexes — none index or partial-index on training_type; nothing to touch.
--   * session_slots_group_shape CHECK — DOES need strengthening: with
--     training_type nullable, 3-valued NULL logic makes the OLD two-branch OR
--     vacuously PASS for a null-typed row regardless of gender/level (neither
--     branch is FALSE, both are NULL, NULL OR NULL = NULL = "satisfied"). Fixed
--     below with an explicit null-type branch, additive to the existing two.
--   * @tpa/core (canBookSlot, isGroupSlot, templates.ts) and @tpa/types
--     (SessionSlot.trainingType, BookReason) — NOT touched this session (see the
--     report). canBookSlot would need null-handling and BookReason would need
--     the three new reasons below; both are deferred to the client-picker
--     session, since no client code path can create an untyped row yet (the
--     admin's create/edit forms still always send a concrete type) — so no real
--     row will have training_type null until that session ships. Flagged as the
--     known, temporary gap in "where this is weakest".
--   * Recurring templates (availability_templates, packages/core/templates.ts) —
--     NOT changed here. Recommendation (see report): yes, allow untyped
--     templates too, later — but TemplateDraft.trainingType is required
--     (non-nullable) and templates.ts's buildAvailabilityTemplate has no path to
--     construct one without a type, so that's a @tpa/core change, out of this
--     session's boundary. The one thing this migration's CHECK strengthening
--     already accounts for: availability_templates keeps its OWN unchanged,
--     already-strict group_shape CHECK (still training_type NOT NULL there) —
--     nothing here weakens template validation.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- TASK 1 — schema.
--
-- training_type: DROP NOT NULL. The existing CHECK (training_type in (...)) needs
-- no change — `NULL IN (...)` evaluates to NULL, which a CHECK treats as
-- satisfied, so a null value already passes that constraint once NOT NULL is
-- gone.
--
-- capacity: STAYS NOT NULL, unchanged CHECK (>= 1). Decision (see report): unlike
-- the task's two offered options (derive it, or make it nullable too), capacity
-- was NEVER a pure function of training_type in this codebase even for typed
-- slots — TemplateDraft.capacity is an independent admin-chosen number for every
-- type, including duo/individual (the admin is just expected to type 1/2
-- themselves; nothing derives it). The ONE genuine derivation rule the task
-- states is rule 5: individual is ALWAYS capacity 1. So: an untyped slot keeps
-- requiring a real admin-chosen capacity at creation (the physical ceiling of
-- that coach+time block, whichever type eventually claims it), and the FIRST
-- booking forces capacity to 1 ONLY when the chosen type is 'individual' —
-- exactly rule 5, "now triggered at type-set time". This needed nothing new in
-- the CHECK (booked_count <= capacity holds regardless) and no nullability
-- change to capacity at all.
--
-- pre_booking_capacity: NEW, nullable. Restores capacity on revert (Task 3) for
-- the one case that overwrote it (individual). Set ONLY alongside the forced
-- capacity=1 override, to the capacity value it's about to replace; cleared
-- whenever the slot is next typed OR reverted. Every OTHER chosen type never
-- touches capacity, so never needs this column populated.
--
-- set_by_booking_at: NEW, nullable, exact name/purpose per the task's rule 4.
-- NULL while untyped, or if an admin pre-set the type at creation/edit. Set to
-- now() the moment a FIRST BOOKING sets training_type. This is the single fact
-- Task 3's revert rule needs: "booking-set" ⟺ set_by_booking_at IS NOT NULL —
-- an admin-pre-typed slot never reverts, because this column never gets set for
-- it (the admin INSERT path writes training_type directly; nothing sets this
-- column there).
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.session_slots
  alter column training_type drop not null,
  add column pre_booking_capacity integer,
  add column set_by_booking_at timestamptz;

-- Strengthen the group-shape invariant with an explicit null-type branch —
-- additive: the two original branches (group ⟺ gender+level set; every other
-- CONCRETE type ⟺ both null) are unchanged, so every EXISTING row (always
-- training_type NOT NULL today) is validated by the identical logic as before
-- and passes trivially. Only the new, previously-vacuous null-type case is now
-- actually enforced (gender/level must both be null on an untyped slot — the
-- state every code path in this migration produces and expects).
alter table public.session_slots drop constraint session_slots_group_shape;
alter table public.session_slots add constraint session_slots_group_shape check (
  (training_type is null and gender is null and level is null)
  or
  (training_type = 'group' and gender is not null and level is not null)
  or
  (training_type is not null and training_type <> 'group' and gender is null and level is null)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- TASK 2 — book_slot learns to set the type.
--
-- New trailing optional parameter p_training_type (default null) — additive,
-- so any existing caller that omits it keeps working unchanged against an
-- ALREADY-TYPED slot (the only kind that exists in production today).
--
-- New reason codes (join the existing union, all still {ok:false, reason:…}
-- data, never an exception): type_required (untyped slot, no type given),
-- type_mismatch (a type was given that doesn't match — either an already-typed
-- slot's real type, or the type another booker's race just won), invalid_type
-- (an untyped slot, but the given string isn't one of the four valid types —
-- validated explicitly so a bad literal returns clean data instead of an
-- unhandled CHECK-violation exception).
--
-- level_mismatch REMOVED (rule 4: level is display-only; no code blocks a
-- mismatched join — a genuine, deliberate behaviour change flagged in the
-- report, not just for newly-typed slots but for every existing typed group
-- slot too, since the rule states the principle generally). gender_mismatch
-- STAYS exactly as it was (rule 4's parenthetical: preserve whatever rule
-- exists for ladies/men separation — confirmed a real, enforced, hard block
-- today, not just descriptive, so it is not touched).
--
-- THE ATOMIC STEP — protecting the proven line. The guarded WHERE
-- (id = ? and booked_count < capacity and status = 'published' and
-- starts_at > now()) is BYTE-IDENTICAL to the current (S12) body; the only
-- addition is one more AND-ed condition. The SET's original
-- `booked_count = booked_count + 1` is untouched; the new columns are
-- ADDITIONAL assignments in the same statement, evaluated (per standard SQL
-- UPDATE semantics) against the PRE-image of the row, so `coalesce(training_type,
-- v_effective_type)` and every `case when training_type is null …` correctly see
-- the OLD value even though they sit alongside the columns being changed. One
-- UPDATE, one row lock, one commit — there is no instant where the slot is
-- typed but unbooked, because the type and the booking are the same write.
--
-- Race behaviour this produces (Task 0 rule 3 + Task 4's new scenario), for
-- free, from the SAME EvalPlanQual re-evaluation that already proves the
-- existing same-type N-way race: two callers pick DIFFERENT types on the same
-- untyped slot — the first commits (training_type set, booked, capacity
-- resolved); the second, unblocked, re-evaluates
-- `(training_type is null or training_type = v_effective_type)` against the
-- now-committed row — training_type is no longer null and doesn't equal the
-- loser's choice, so the WHERE matches zero rows and they get a clean
-- type_mismatch. Two callers pick the SAME type — the second's re-evaluated
-- WHERE now reads `training_type = 'their own choice'` = true, so if capacity
-- allows they simply JOIN as an ordinary second booking on a now-typed slot —
-- decided in favour of "ideally joins" (Adam's stated preference), achieved
-- with no special-case code, just the existing guard doing its job on a
-- committed value instead of a pre-set one.
-- ─────────────────────────────────────────────────────────────────────────────
-- CREATE OR REPLACE cannot change a function's parameter COUNT — a 2-arg
-- signature is a distinct overload from the existing 1-arg one, not a
-- replacement of it, which would leave BOTH defined and every 1-argument call
-- ambiguous ("function is not unique"). Drop the old signature explicitly
-- first, so exactly one book_slot exists afterward.
drop function if exists public.book_slot(text);

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
  -- preserved unchanged.

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
    -- Guarded increment: WHERE gains exactly one AND clause; the original three
    -- conditions and the `booked_count = booked_count + 1` SET term are
    -- untouched. The additional SET terms only ever fire when training_type IS
    -- (pre-image) null — a no-op CASE for every already-typed slot, so an
    -- ordinary booking on a typed slot is byte-identical in effect to today.
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
      returning booked_count, capacity into v_new_count, v_capacity;
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

    insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at, cancelled_at)
      values (v_booking_id, p_slot_id, v_player, v_batch_id, 'booked', now(), null);
  exception
    when sqlstate 'TP002'  then return jsonb_build_object('ok', false, 'reason', 'no_usable_credit');
    when unique_violation then return jsonb_build_object('ok', false, 'reason', 'already_booked');
  end;

  -- Fill-confirmation notify: unchanged from S12 (still keys off the
  -- post-increment count vs. capacity — both now correctly resolved even on a
  -- just-typed slot, since the SAME statement wrote them before RETURNING).
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

-- A fresh function (the drop above means this is not an OR REPLACE of an
-- already-granted object) starts world-executable by default — revoke from
-- public first, matching the original S7a grant shape exactly.
revoke all on function public.book_slot(text, text) from public;
grant execute on function public.book_slot(text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- admin_book_player gets the identical treatment: a new TRAILING optional
-- p_training_type (additive — no existing call site breaks), the same
-- effective-type resolution + type_required/type_mismatch/invalid_type reasons,
-- the same atomic SET/WHERE augmentation. level_mismatch removed from both the
-- hard-reject path AND from v_mismatch's computation (the `overridden` flag
-- should only ever reflect a genuine, still-enforced gender override — level
-- was never blocking, so overriding it was never meaningful). override's
-- remaining job is exactly gender_mismatch, unchanged.
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists public.admin_book_player(text, text, boolean);

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
          -- An admin override can seat a player of a different gender onto a
          -- group slot; the slot's OWN gender identity (what it displays / what
          -- the NEXT non-overridden booker must match) still comes from the
          -- first booker actually seated, same as the player path.
          gender = case when training_type is null and v_effective_type = 'group'
                        then v_pgender else gender end,
          level = case when training_type is null and v_effective_type = 'group'
                       then v_plevel else level end,
          set_by_booking_at = case when training_type is null then now() else set_by_booking_at end
      where id = p_slot_id and booked_count < capacity
        and status = 'published' and starts_at > now()
        and (training_type is null or training_type = v_effective_type)
      returning booked_count, capacity into v_new_count, v_capacity;
    if not found then
      select * into v_slot from public.session_slots where id = p_slot_id;
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

revoke all on function public.admin_book_player(text, text, boolean, text) from public;
grant execute on function public.admin_book_player(text, text, boolean, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- TASK 3 — the revert rule.
--
-- Decision: a slot reverts to untyped (training_type, gender, level,
-- set_by_booking_at all → null; capacity restored from pre_booking_capacity if
-- that was populated) exactly when its LAST active booking is cancelled/removed
-- AND the type was booking-set (set_by_booking_at is not null). An admin-preset
-- type NEVER reverts — set_by_booking_at is never populated for that path, so
-- the condition is simply false forever for such a slot. Justification: this is
-- Adam's stated lean, and it's the one reading that actually delivers the
-- model's stated goal — maximising open inventory. Restoring
-- pre_booking_capacity (not just nulling the type) matters for exactly this
-- reason: an individual booking that reverted while stuck at capacity=1 would
-- only ever be re-bookable as another 1-seat session, defeating "open
-- inventory" for the group/duo slot it originally could have been.
--
-- Scope: cancel_session is UNTOUCHED — it retires the whole slot
-- (status='cancelled'), which book_slot already refuses regardless of type,
-- so there is nothing to revert there. Only cancel_booking (player self-cancel)
-- and remove_booking (admin removes one player) can leave a slot PUBLISHED with
-- zero active bookings, so only those two gain the logic.
--
-- Race-safety: both RPCs already take the slot's row lock (FOR UPDATE) BEFORE
-- decrementing booked_count, and the revert lives in the SAME UPDATE statement
-- that performs that decrement — same lock, same statement, same commit. No
-- new lock, no new acquisition order, so nothing new can deadlock. A book_slot
-- call racing this cancellation on the same slot blocks on the row lock exactly
-- as it already does today (S7b.1); when it unblocks it sees whichever state
-- actually committed — either the still-typed-but-now-full/empty slot (if
-- book_slot's own peek ran and lost before the cancel's lock), or the freshly
-- reverted untyped slot, in which case it proceeds as a genuine first booking
-- with its OWN chosen type. Both outcomes are internally consistent; proven in
-- concurrency.sh's new Scenario H.
--
-- Notifications: neither RPC gains a new notification for the revert itself. A
-- slot that just emptied to zero active bookings has, by definition, nobody
-- else booked on it — there is no other party to inform. remove_booking's
-- existing "you were removed" text still reads the type from v_slot, the
-- PL/pgSQL variable captured BEFORE this update runs, so it still names the
-- real type the player was removed from ("Your Individual session…") even
-- though the COLUMN is nulled by the same statement.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.cancel_booking(p_booking_id text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_player        text;
  v_slot_id       text;
  v_booking       public.bookings;
  v_slot          public.session_slots;
  v_refund        boolean;
  v_will_be_empty boolean;
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
  v_will_be_empty := (v_slot.booked_count - 1 <= 0) and (v_slot.set_by_booking_at is not null);

  -- Free the seat ALWAYS; revert to untyped ONLY if this empties a booking-set
  -- slot. Both under the row lock already held above — one statement, one commit.
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
  v_slot_id       text;
  v_slot          public.session_slots;
  v_booking       public.bookings;
  v_will_be_empty boolean;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;

  select slot_id into v_slot_id from public.bookings where id = p_booking_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'booking_missing'); end if;

  select * into v_slot from public.session_slots where id = v_slot_id for update;   -- slot lock first
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if v_booking.status <> 'booked' then return jsonb_build_object('ok', false, 'reason', 'already_cancelled'); end if;

  v_will_be_empty := (v_slot.booked_count - 1 <= 0) and (v_slot.set_by_booking_at is not null);

  update public.session_slots
    set booked_count = greatest(0, booked_count - 1),
        training_type = case when v_will_be_empty then null else training_type end,
        gender = case when v_will_be_empty then null else gender end,
        level = case when v_will_be_empty then null else level end,
        capacity = case when v_will_be_empty and pre_booking_capacity is not null
                        then pre_booking_capacity else capacity end,
        pre_booking_capacity = case when v_will_be_empty then null else pre_booking_capacity end,
        set_by_booking_at = case when v_will_be_empty then null else set_by_booking_at end
    where id = v_slot_id;

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
