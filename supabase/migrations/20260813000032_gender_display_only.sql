-- ============================================================================
-- Gender becomes display-only — the SAME rule 4 already applies to level, now
-- extended to gender. Requirement change: men and women can book the same
-- session; gender is recorded and shown, never blocking. Ships as build 5.
--
-- This touches the most-reviewed file in the project (book_slot /
-- admin_book_player's guarded UPDATE), so the change is deliberately narrow:
--
-- TASK 1 — subtractive, ONLY the gender clause, in three places per RPC:
--   (a) the peek-time gate before the guarded UPDATE (book_slot's unconditional
--       check; admin_book_player's `if not p_override then ... end if` shell,
--       which — now that BOTH the things it used to gate, level_mismatch (a
--       prior migration) and gender_mismatch (this one), are gone — has
--       nothing left inside it and is deleted whole, not left as a dead `if
--       not p_override then end if`);
--   (b) the guarded WHERE itself: book_slot's unconditional
--       `and (gender is null or gender = v_pgender)`, and admin_book_player's
--       `and (p_override or gender is null or gender = v_pgender)` — both
--       clauses removed outright, not weakened;
--   (c) the "not found" diagnostic branch's gender_mismatch re-check in both
--       functions.
-- Everything else — the booked_count < capacity / status / starts_at / type
-- clauses in the SAME guarded WHERE, the lock order (slot row via the guarded
-- UPDATE, credit batch via its own guarded UPDATE, in that order), the
-- capacity `least(capacity, tpa.canonical_capacity(...))` logic, credit
-- selection (earliest-expiring usable batch), and every other {ok,reason}
-- path — is byte-identical to the live version (book_slot last redefined
-- 20260809000028_open_slot_capacity_fix.sql; admin_book_player last
-- redefined 20260811000030_admin_book_player_notify.sql, which only added the
-- admin_booked notify call on top of that same 20260809000028 body). The
-- capacity/type guard sitting in the same WHERE is untouched by construction:
-- deleting one `and (...)` conjunct cannot alter what the OTHER conjuncts
-- match — re-run concurrency.sh to prove it holds under real contention
-- (Scenarios H/I/J/L unchanged; Scenario K repurposed, see below).
--
-- p_override / v_committed_gender / v_mismatch / the `overridden` response
-- field in admin_book_player are DELIBERATELY left byte-identical (RULES:
-- additive/untouched outside the guarded WHERE + the two gender_mismatch
-- branches). p_override's ONLY reason to exist was to bypass the gender gate
-- (level_mismatch never had an override path); with nothing left to bypass,
-- it is now a vestigial parameter — still accepted, still threaded into
-- `overridden := (p_override and v_mismatch)`, which still computes a real
-- boolean (v_mismatch is just "does the committed gender differ from this
-- player's" — a fact, not a check outcome) but no longer means "a block was
-- waived", since nothing was ever going to block. Not resolved here — flagged
-- for Adam (see report Task 4) as a candidate for a follow-up signature
-- change, which is out of scope for this migration (admin app callers still
-- pass it; changing the signature is a separate, bigger call).
--
-- TASK 2 — the CHECK, carefully (the trap). session_slots_group_shape /
-- availability_templates_group_shape currently (last touched
-- 20260805000024 / 20260808000027 respectively — NOT 20260805000024 for
-- templates as initially assumed; verified by grep before writing this) share
-- the identical NULL-safe, three-branch shape:
--   (training_type is null and gender is null and level is null)
--   or (training_type is not null and training_type = 'group'
--       and gender is not null and level is not null)
--   or (training_type is not null and training_type <> 'group'
--       and gender is null and level is null)
-- Gender becomes unconstrained by type entirely — dropped from all three
-- branches, leaving ONLY the level shape (still tied to group-ness, per "keep
-- whatever the CHECK still legitimately enforces"):
--   (training_type is null and level is null)
--   or (training_type is not null and training_type = 'group' and level is not null)
--   or (training_type is not null and training_type <> 'group' and level is null)
-- Same explicit `is null` / `is not null` guards as the fixed version — no
-- bare equality reintroduced, so the three-valued-logic trap that
-- 20260805000024 fixed (a bare `training_type = 'group'` evaluates to NULL,
-- not FALSE, for an untyped row, and Postgres treats a NULL CHECK result as
-- SATISFIED) cannot recur: every branch here still leads with an explicit
-- `training_type is [not] null` before any equality on it.
-- This is a pure WEAKENING of both CHECKs (dropping conjuncts, adding no new
-- ones) — every row that satisfied the old CHECK still satisfies the new one,
-- so no existing row (dev or prod) can be invalidated. Applied to BOTH
-- session_slots AND availability_templates for consistency — the task named
-- only session_slots, but leaving the templates CHECK unchanged would forbid
-- an admin from ever creating a genuinely mixed-gender RECURRING group
-- template (only one-off group slots could go gender-null), a real product
-- gap the same requirement change is meant to close. Both CHECKs have always
-- evolved in lockstep (20260808000027 copied 20260805000024's fix verbatim,
-- s/slots/templates/) — this keeps that pattern.
--
-- TASK 3 — display-only, mirroring level exactly. The SET clause that records
-- gender (`gender = case when training_type is null and v_effective_type =
-- 'group' then v_pgender else gender end`) is UNCHANGED in both RPCs — it
-- already only records gender for a booking-driven GROUP type-set, the exact
-- same condition under which level is recorded. Nothing to change here:
-- gender was already being recorded identically to level: the only thing
-- that made it different was the WHERE clause guard just removed in Task 1.
-- Column kept (not dropped) — still shown on cards, still useful data.
--
-- TASK 6 — migration safety. Every existing row (dev seed data, and prod once
-- this ships) already satisfies the OLD, stricter CHECKs, and the new CHECKs
-- are a strict weakening of the old ones — so every existing row trivially
-- still satisfies the new CHECK; nothing is invalidated, no backfill needed.
-- The RPC changes touch behavior, not data — no column type/nullability
-- change, no UPDATE statement in this migration at all.
-- ============================================================================

-- ── TASK 2 — relax both group_shape CHECKs: gender unconstrained, level's
--    shape (tied to group-ness) unchanged ──────────────────────────────────
alter table public.session_slots drop constraint session_slots_group_shape;
alter table public.session_slots add constraint session_slots_group_shape check (
  (training_type is null and level is null)
  or
  (training_type is not null and training_type = 'group' and level is not null)
  or
  (training_type is not null and training_type <> 'group' and level is null)
);

alter table public.availability_templates drop constraint availability_templates_group_shape;
alter table public.availability_templates add constraint availability_templates_group_shape check (
  (training_type is null and level is null)
  or
  (training_type is not null and training_type = 'group' and level is not null)
  or
  (training_type is not null and training_type <> 'group' and level is null)
);

-- ── TASK 1 — book_slot: gender clause removed from the peek gate, the
--    guarded WHERE, and the diagnostic branch. Nothing else touched. ────────
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
  -- gender_mismatch removed here (this migration) — gender is now display-only,
  -- exactly like level_mismatch was removed before it (rule 4, extended).

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
    -- Guarded increment: WHERE keeps the type clause (20260804000023) and the
    -- capacity/status/time clauses — the gender clause (20260805000024's FIX 1)
    -- is REMOVED here (this migration). Every other SET term is unchanged.
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

-- ── TASK 1 — admin_book_player: identical treatment. p_override /
--    v_committed_gender / v_mismatch / the `overridden` field are left
--    byte-identical (see the header note above — vestigial, not resolved
--    here). ─────────────────────────────────────────────────────────────────
create or replace function public.admin_book_player(
  p_slot_id text, p_player_id text, p_override boolean, p_training_type text default null
)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_slot             public.session_slots;
  v_pgender          text;
  v_plevel           text;
  v_effective_type   text;
  v_batch_id         text;
  v_booking_id       text;
  v_mismatch         boolean;
  v_new_count        int;
  v_capacity         int;
  v_committed_gender text;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;

  select * into v_slot from public.session_slots where id = p_slot_id;
  if not found then                       return jsonb_build_object('ok', false, 'reason', 'slot_missing');    end if;
  select gender, level into v_pgender, v_plevel from public.players where id = p_player_id;
  if not found then                       return jsonb_build_object('ok', false, 'reason', 'player_missing');  end if;
  if v_slot.status <> 'published' then    return jsonb_build_object('ok', false, 'reason', 'slot_cancelled'); end if;
  if v_slot.starts_at <= now() then       return jsonb_build_object('ok', false, 'reason', 'slot_in_past');   end if;

  -- The `if not p_override then ... gender_mismatch ... end if` gate is
  -- REMOVED whole (this migration) — level_mismatch was already gone from
  -- here (rule 4), and gender_mismatch was the only other thing it gated, so
  -- nothing is left inside it. p_override itself stays (see header note).

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

    insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at, cancelled_at)
      values (v_booking_id, p_slot_id, p_player_id, v_batch_id, 'booked', now(), null);
  exception
    when sqlstate 'TP002'  then return jsonb_build_object('ok', false, 'reason', 'no_usable_credit');
    when unique_violation then return jsonb_build_object('ok', false, 'reason', 'already_booked');
  end;

  perform tpa.notify(
    p_player_id, 'admin_booked', 'Added to a session',
    'You''ve been added to a ' || initcap(v_effective_type) || ' session on '
      || tpa.cairo_when(v_slot.starts_at) || '.',
    p_slot_id, null);

  -- v_mismatch is now purely descriptive (does the committed gender differ
  -- from this player's?) — it no longer means "a block was waived", since
  -- gender never blocks. Left computing exactly as before (see header note).
  v_mismatch := (v_committed_gender is not null and v_committed_gender <> v_pgender);

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
