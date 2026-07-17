-- ============================================================================
-- S7a — the atomic booking engine: book_slot + cancel_booking.
--
-- bookings and credit_batches have NO client write policy — deliberately, because
-- every write there is money (spend a credit + take a seat; free a seat + refund a
-- credit) and must be atomic. These two SECURITY DEFINER RPCs are how those writes
-- happen. They NEVER trust a caller-supplied player id: the acting player is always
-- resolved from the JWT via current_player_id(). Expected rejections come back as
-- DATA ({ok:false, reason}) — mirroring @tpa/core's canBookSlot / cancelBooking
-- result unions — so the client renders reasons instead of parsing SQLSTATEs.
--
-- Concurrency: the capacity guard is the guarded increment the schema was built
-- for (UPDATE ... WHERE booked_count < capacity); the credit guard is the same
-- shape on quantity_remaining. Under READ COMMITTED a second racer blocks on the
-- row lock, then re-evaluates the WHERE against the just-committed row (EvalPlanQual)
-- and matches zero rows — so no oversell and no double-spend. Proven by the
-- N-connection test in supabase/tests/concurrency.sh, which pgTAP (single session)
-- cannot express. CHECK (booked_count <= capacity) is the backstop.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- TASK 0 — one rule: only CANCELLATION frees a seat.
--
-- booked_count counts NON-CANCELLED bookings (booked + attended + no_show), so
-- marking attendance never moves it and a past 4/4 session stays 4/4. That makes
-- the uniqueness guard status-aware too: a player who CANCELS may re-book the same
-- slot (they changed their mind — the app already allowed this, filtering
-- status='booked'), but two live bookings for one slot are still forbidden.
--
-- The old constraint was a plain UNIQUE (player_id, slot_id) with no status
-- filter, so the DB rejected the re-book the app permits — an app/DB divergence.
-- Replace it with a PARTIAL unique index over non-cancelled rows (same shape as
-- credit_batches_one_signup_grant_per_player). A UNIQUE *constraint* cannot carry
-- a WHERE, so this must be an index, and the old constraint is dropped first.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.bookings drop constraint bookings_one_per_player_slot;

create unique index bookings_one_active_per_player_slot
  on public.bookings (player_id, slot_id)
  where status <> 'cancelled';

-- ─────────────────────────────────────────────────────────────────────────────
-- TASK 3 (constants) — the two domain constants that also live in @tpa/core
-- (constants.ts: CANCELLATION_WINDOW_HOURS = 3, CREDIT_EXPIRY_DAYS = 30) get ONE
-- definition on the SQL side too, as immutable functions in a private `tpa`
-- schema — never scattered literals. The RPCs below reference tpa.* instead of
-- writing `interval '3 hours'` inline.
--
-- Drift control (no codegen — see the session report for the argument): each side
-- is single-sourced and points at the other, AND a mechanical test reads BOTH —
-- packages/core/src/sql-parity.test.ts parses these interval literals out of this
-- migration and asserts they equal the core constants, so a change to one side
-- that misses the other fails CI loudly. A future change must touch: the core
-- constant, its "mirrored in SQL" comment, this function, and the parity test's
-- expectation (which just derives from the core constant, so it moves for free).
-- The `tpa` schema is NOT exposed to any client role; only the SECURITY DEFINER
-- RPCs (owned by the migration role) call these.
-- ─────────────────────────────────────────────────────────────────────────────
create schema if not exists tpa;

-- Mirrors @tpa/core CANCELLATION_WINDOW_HOURS. Free-cancel refund boundary.
create or replace function tpa.cancellation_window()
  returns interval language sql immutable
  as $$ select interval '3 hours' $$;

-- Mirrors @tpa/core CREDIT_EXPIRY_DAYS. Used by the S7b mint RPCs; defined here
-- so both money constants share one home from the first RPC session.
create or replace function tpa.credit_expiry()
  returns interval language sql immutable
  as $$ select interval '30 days' $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TASK 1 — book_slot(slot_id): an authenticated player books THEMSELVES onto a
-- published, not-yet-started slot, spending their earliest-expiring usable credit
-- of the slot's training type, atomically. Returns { ok, reason? }.
--
-- Reason set mirrors @tpa/core canBookSlot + the app's bookSlot union:
--   slot_missing, slot_cancelled, slot_in_past, slot_full,
--   gender_mismatch, level_mismatch, no_usable_credit, already_booked.
-- (not_authenticated is an RPC-only guard: a logged-out caller has no player.)
-- ─────────────────────────────────────────────────────────────────────────────
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
begin
  v_player := public.current_player_id();
  if v_player is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  -- Pre-mutation reads for the reasons that don't depend on the increment.
  select * into v_slot from public.session_slots where id = p_slot_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'slot_missing');
  end if;
  if v_slot.status <> 'published' then
    return jsonb_build_object('ok', false, 'reason', 'slot_cancelled');
  end if;
  if v_slot.starts_at <= now() then          -- the DB clock is the only clock
    return jsonb_build_object('ok', false, 'reason', 'slot_in_past');
  end if;

  -- Group slots carry gender AND level; both must match the player. Checked in
  -- canBookSlot's order (gender before level) so the reason matches the preview.
  select gender, level into v_pgender, v_plevel from public.players where id = v_player;
  if v_slot.gender is not null and v_slot.gender <> v_pgender then
    return jsonb_build_object('ok', false, 'reason', 'gender_mismatch');
  end if;
  if v_slot.level is not null and v_slot.level <> v_plevel then
    return jsonb_build_object('ok', false, 'reason', 'level_mismatch');
  end if;

  -- Earliest-expiring usable batch of the matching type (use credits before they
  -- lapse). id tiebreak keeps the choice deterministic.
  select id into v_batch_id
  from public.credit_batches
  where player_id = v_player
    and training_type = v_slot.training_type
    and quantity_remaining > 0
    and expires_at > now()
  order by expires_at asc, id asc
  limit 1;
  if v_batch_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_usable_credit');
  end if;

  v_booking_id := 'bk_' || gen_random_uuid();

  -- Mutations in a subtransaction so a lost race on the SECOND resource rolls the
  -- FIRST back cleanly and still returns data (not an exception).
  begin
    -- Guarded capacity increment. Zero rows ⇒ full ⇒ abort (nothing else touched
    -- yet, so a plain return is safe here).
    update public.session_slots
      set booked_count = booked_count + 1
      where id = p_slot_id and booked_count < capacity;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'slot_full');
    end if;

    -- Guarded credit decrement. Zero rows ⇒ the credit was spent by a concurrent
    -- booking between our pick and here ⇒ raise so the slot increment above rolls
    -- back, then report it as data.
    update public.credit_batches
      set quantity_remaining = quantity_remaining - 1
      where id = v_batch_id and quantity_remaining > 0;
    if not found then
      raise exception 'credit race lost' using errcode = 'TP002';
    end if;

    insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at, cancelled_at)
      values (v_booking_id, p_slot_id, v_player, v_batch_id, 'booked', now(), null);
  exception
    when sqlstate 'TP002' then
      return jsonb_build_object('ok', false, 'reason', 'no_usable_credit');
    when unique_violation then                 -- the partial index caught a live dup
      return jsonb_build_object('ok', false, 'reason', 'already_booked');
  end;

  return jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'credit_batch_id', v_batch_id);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TASK 2 — cancel_booking(booking_id): the caller cancels THEIR OWN booking. The
-- seat is always freed; the credit is refunded to its ORIGINAL batch (original
-- expiry) only OUTSIDE the 3-hour window. Idempotent — an already-cancelled
-- booking is rejected, so a double-cancel can't double-refund (S3e's bug, with the
-- DB as arbiter via the row lock). Returns { ok, refunded?, reason? }.
--
-- SECURITY: takes NO time argument. The refund decision uses the database's now().
-- A caller who could pass now = yesterday would earn a refund on every late
-- cancellation; the only clock is the server's.
--
-- The boundary is STRICT: refund iff (starts_at - now()) > window. At exactly
-- starts_at − 3h the difference equals the window, `>` is false, and the credit is
-- forfeit — matching @tpa/core's msUntilStart > WINDOW.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.cancel_booking(p_booking_id text)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_player  text;
  v_booking public.bookings;
  v_slot    public.session_slots;
  v_refund  boolean;
begin
  v_player := public.current_player_id();
  if v_player is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  -- Lock the booking: this is what serialises two concurrent cancels so only the
  -- first refunds.
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'booking_missing');
  end if;
  if v_booking.player_id <> v_player then
    return jsonb_build_object('ok', false, 'reason', 'not_owner');
  end if;
  if v_booking.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'reason', 'already_cancelled');
  end if;
  if v_booking.status <> 'booked' then          -- attended / no_show are terminal
    return jsonb_build_object('ok', false, 'reason', 'not_cancellable');
  end if;

  select * into v_slot from public.session_slots where id = v_booking.slot_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'slot_missing');
  end if;
  if v_slot.starts_at <= now() then             -- can't cancel a started session
    return jsonb_build_object('ok', false, 'reason', 'not_cancellable');
  end if;

  v_refund := (v_slot.starts_at - now()) > tpa.cancellation_window();

  -- Free the seat ALWAYS, refund or not, so someone else can take it.
  update public.session_slots
    set booked_count = greatest(0, booked_count - 1)
    where id = v_slot.id;

  update public.bookings
    set status = 'cancelled', cancelled_at = now()
    where id = v_booking.id;

  -- Refund to the exact batch that paid, keeping its original expiry (we only bump
  -- quantity_remaining). If that batch has since expired the credit still returns —
  -- ledger truth — and is simply unusable (isBatchUsable / expires_at rejects it).
  if v_refund then
    update public.credit_batches
      set quantity_remaining = quantity_remaining + 1
      where id = v_booking.credit_batch_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'refunded', v_refund,
    'credit_batch_id', case when v_refund then v_booking.credit_batch_id else null end
  );
end;
$$;

-- ── grants: authenticated players only (a booking needs a player). Not anon. ──
revoke all on function public.book_slot(text) from public;
revoke all on function public.cancel_booking(text) from public;
grant execute on function public.book_slot(text) to authenticated;
grant execute on function public.cancel_booking(text) to authenticated;
