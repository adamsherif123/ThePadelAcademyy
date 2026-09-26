-- ============================================================================
-- Location-locked credits: the money path learns about branches.
--
-- A credit is spendable only at the branch of the package it came from. That is
-- the whole rule, and everything here exists to make it impossible to violate
-- rather than merely unusual.
--
-- ── where each row's branch comes from ──
--   credit_batches  purchase → the PACKAGE, via the one mint rule.
--                   admin_grant → the grant's argument, default when null.
--   purchases       ALWAYS the package, forced by a trigger (see below).
--   credit_requests ALWAYS the package, same trigger pattern.
--   bookings        the SLOT, and the composite FKs make the batch agree.
-- No client ever chooses any of these.
--
-- ── why purchases/credit_requests use a FORCING trigger, not a default ──
-- 1.2 and 1.3 insert a pending purchase themselves and do not send the column.
-- A column DEFAULT would cover that, but it would also let a newer or hand-rolled
-- client SEND a location that disagrees with the package — and the purchase is
-- what the mint rule later reads. A BEFORE INSERT trigger that overwrites the
-- value unconditionally makes a mismatch unrepresentable instead of merely
-- discouraged, and keeps the legacy insert working untouched.
--
-- ── the composite FKs are the real guarantee ──
-- bookings gains location_id, then two composite foreign keys:
--   (slot_id, location_id)         → session_slots(id, location_id)
--   (credit_batch_id, location_id) → credit_batches(id, location_id)
-- Together those make "a booking's slot and the credit that paid for it are at
-- the same branch" a database fact. book_slot and admin_book_player both check
-- it too, because a clean {ok,reason} beats a 23503 — but if either ever stops
-- checking, the database still refuses. This is the same reasoning as
-- bookings_one_per_player_slot being a constraint rather than a rule.
-- ============================================================================

-- ── the location-name helper the notification copy needs ────────────────────
-- SECURITY DEFINER for the same reason tpa.default_location_id() is (063): its
-- body resolves public.locations at run time, and it is called from function
-- bodies that may execute as a client role. search_path pinned, one argument,
-- returns one name.
create or replace function tpa.location_name(p_location_id text)
  returns text
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select name from public.locations where id = p_location_id;
$$;

revoke all on function tpa.location_name(text) from public, anon, authenticated;

-- ── 1. the columns, nullable, with their FKs ────────────────────────────────
alter table public.credit_batches  add column location_id text references public.locations (id);
alter table public.purchases       add column location_id text references public.locations (id);
alter table public.credit_requests add column location_id text references public.locations (id);
alter table public.bookings        add column location_id text references public.locations (id);

-- ── 2. backfill from the row that already knows ─────────────────────────────
-- Everything predates the second branch, so every one of these resolves to the
-- original branch — but each is derived from its OWN source rather than being
-- set to the default wholesale, so the backfill states the real rule and stays
-- correct if it is ever re-run against mixed data.
update public.purchases p
   set location_id = pk.location_id
  from public.packages pk
 where pk.id = p.package_id and p.location_id is null;

update public.credit_requests cr
   set location_id = pk.location_id
  from public.packages pk
 where pk.id = cr.package_id and cr.location_id is null;

-- purchase-backed batches follow their purchase's package; grants have no
-- purchase and fall back to the default.
update public.credit_batches cb
   set location_id = pk.location_id
  from public.purchases p
  join public.packages pk on pk.id = p.package_id
 where p.id = cb.purchase_id and cb.location_id is null;
update public.credit_batches
   set location_id = tpa.default_location_id()
 where location_id is null;

update public.bookings b
   set location_id = s.location_id
  from public.session_slots s
 where s.id = b.slot_id and b.location_id is null;

-- ── 3. the pre-FK assertion ─────────────────────────────────────────────────
-- Before the composite FKs can be trusted, the existing data has to satisfy
-- them. If any booking's credit batch is at a different branch from its slot,
-- this migration must stop rather than fail obscurely on the ALTER below.
do $$
declare v_bad int;
begin
  select count(*) into v_bad
    from public.bookings b
    join public.credit_batches cb on cb.id = b.credit_batch_id
   where cb.location_id is distinct from b.location_id;
  if v_bad > 0 then
    raise exception
      'ABORT: % booking(s) use a credit batch from a different branch than their slot; the composite FK cannot be added until that is resolved',
      v_bad;
  end if;
end $$;

-- ── 4. NOT NULL ─────────────────────────────────────────────────────────────
alter table public.credit_batches  alter column location_id set not null;
alter table public.purchases       alter column location_id set not null;
alter table public.credit_requests alter column location_id set not null;
alter table public.bookings        alter column location_id set not null;

-- ── 5. the forcing triggers ─────────────────────────────────────────────────
-- SECURITY DEFINER: the body resolves public.packages at run time and these fire
-- on inserts made by `authenticated`, which holds no USAGE on schema tpa. This
-- is the Session 3.5 lesson — a non-definer trigger here would raise
-- "42501 permission denied for schema tpa" on the 1.2/1.3 Paymob insert.
create or replace function tpa.force_location_from_package()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  -- Unconditional: whatever the client sent is discarded. The package is the
  -- only authority on which branch a purchase or request belongs to.
  select pk.location_id into new.location_id
    from public.packages pk where pk.id = new.package_id;
  return new;
end;
$$;

revoke all on function tpa.force_location_from_package() from public, anon, authenticated;

create trigger purchases_force_location
  before insert on public.purchases
  for each row execute function tpa.force_location_from_package();
create trigger credit_requests_force_location
  before insert on public.credit_requests
  for each row execute function tpa.force_location_from_package();

-- ── 6. immutability ─────────────────────────────────────────────────────────
-- credit_batches and bookings reuse 062's trigger function. purchases and
-- credit_requests are covered by the forcing trigger on insert; their location
-- is derived, and no client holds UPDATE on either table at all.
create trigger credit_batches_location_immutable
  before update on public.credit_batches
  for each row execute function tpa.location_id_is_immutable();
create trigger bookings_location_immutable
  before update on public.bookings
  for each row execute function tpa.location_id_is_immutable();

-- ── 7. the composite FKs ────────────────────────────────────────────────────
alter table public.session_slots  add constraint session_slots_id_location_key  unique (id, location_id);
alter table public.credit_batches add constraint credit_batches_id_location_key unique (id, location_id);

alter table public.bookings
  add constraint bookings_slot_same_location
  foreign key (slot_id, location_id) references public.session_slots (id, location_id);
alter table public.bookings
  add constraint bookings_batch_same_location
  foreign key (credit_batch_id, location_id) references public.credit_batches (id, location_id);

-- ── 8. one pending credit request per player PER BRANCH ─────────────────────
-- A player waiting on an Oro Plaza approval must still be able to ask for
-- credits at the new branch. The trial index is deliberately untouched: one free
-- trial per player EVER, across all branches.
drop index public.credit_requests_one_pending_per_player;
create unique index credit_requests_one_pending_per_player_location
  on public.credit_requests (player_id, location_id) where status = 'pending';

-- ── 9. indexes for the new predicates ───────────────────────────────────────
-- book_slot's credit selection is now (player_id, training_type, location_id).
create index credit_batches_player_location_idx on public.credit_batches (player_id, location_id);


-- ============================================================================
-- tpa.mint_credits_for_purchase — the one purchase-mint rule (2-arg, the LIVE signature)
-- ============================================================================

create or replace function tpa.mint_credits_for_purchase(p_purchase_id text, p_quantity int default null)
  returns text
  language plpgsql
  set search_path = ''
as $$
declare
  v_batch_id text := 'cb_' || gen_random_uuid();
  v_pu       public.purchases;
  v_pkg      public.packages;
  v_qty      int;
begin
  select * into v_pu  from public.purchases where id = p_purchase_id;
  select * into v_pkg from public.packages  where id = v_pu.package_id;
  v_qty := coalesce(p_quantity, v_pkg.session_count);  -- override or the package default
  insert into public.credit_batches
    (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at, note, location_id)
  values
    (v_batch_id, v_pu.player_id, 'purchase', p_purchase_id, v_pkg.training_type,
     v_qty, v_qty, now() + tpa.credit_expiry(), now(), null,
     -- ADDITIVE (065): the branch comes from the PACKAGE, never from the caller.
     -- This is the one purchase-mint rule, so every purchase-backed batch in the
     -- system gets its location here and nowhere else.
     v_pkg.location_id);
  return v_batch_id;
end;
$$;

-- ============================================================================
-- public.book_slot — the only time this is touched in the whole build
-- ============================================================================

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
  v_loc_name      text;   -- ADDITIVE (065, location-locked credits)
  v_other_loc     text;   -- ADDITIVE (065)
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

  -- ADDITIVE (065): a credit is spendable only at the branch it was bought for.
  -- The predicate goes HERE, in the selection, and NOT in the guarded decrement
  -- below: by the time that runs the batch has already been chosen correctly, and
  -- adding a second copy of the rule to the hot path would be two places to keep
  -- in step for no gain.
  select id into v_batch_id
  from public.credit_batches
  where player_id = v_player and training_type = v_effective_type
    and quantity_remaining > 0 and expires_at > now()
    and location_id = v_slot.location_id
  order by expires_at asc, id asc
  limit 1;
  if v_batch_id is null then
    -- ADDITIVE (065): tell the two cases apart. "You have no credit" and "your
    -- credit is for the other branch" need different words and different actions,
    -- and collapsing them into no_usable_credit would send a player to buy
    -- credits they already own.
    select cb.location_id into v_other_loc
    from public.credit_batches cb
    where cb.player_id = v_player and cb.training_type = v_effective_type
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

    insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at, cancelled_at, location_id)
      values (v_booking_id, p_slot_id, v_player, v_batch_id, 'booked', now(), null, v_slot.location_id);
  exception
    when sqlstate 'TP002'  then return jsonb_build_object('ok', false, 'reason', 'no_usable_credit');
    when unique_violation then return jsonb_build_object('ok', false, 'reason', 'already_booked');
  end;

  -- ADDITIVE (065): resolved once, BEFORE the first message that uses it. The
  -- session_confirmed emit directly below is the earliest consumer; assigning it
  -- later left that one message concatenating NULL, which made the whole body
  -- NULL and violated notifications.body NOT NULL.
  v_loc_name := tpa.location_name(v_slot.location_id);

  if v_new_count = v_capacity then
    perform tpa.notify(
      b.player_id, 'session_confirmed', 'Session confirmed',
      'Your ' || initcap(v_effective_type) || ' session on ' || tpa.cairo_when(v_slot.starts_at)
        || ' at ' || v_loc_name || ' is confirmed.',
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
      || ' slot with ' || coalesce(split_part(v_coach, ' ', 1), 'a coach')
      || ' at ' || v_loc_name,
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
      || ' with ' || coalesce(split_part(v_coach, ' ', 1), 'your coach')
      || ' at ' || v_loc_name || ' is booked.',
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
        || ' session on ' || tpa.cairo_when(v_slot.starts_at) || ' at ' || v_loc_name || '.',
      p_slot_id,
      v_booking_id);
  end if;

  return jsonb_build_object('ok', true, 'booking_id', v_booking_id, 'credit_batch_id', v_batch_id);
end;
$$;


-- ============================================================================
-- public.admin_book_player — same rule, no override
-- ============================================================================

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

  perform tpa.notify(
    p_player_id, 'admin_booked', 'Added to a session',
    'You''ve been added to a ' || initcap(v_effective_type) || ' session on '
      || tpa.cairo_when(v_slot.starts_at) || '.',
    p_slot_id, null);

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


-- ============================================================================
-- public.grant_credits — p_location_id, null = default
-- ============================================================================

create or replace function public.grant_credits(p_player_id text, p_training_type text, p_quantity int, p_note text, p_location_id text default null)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_batch_id text := 'cb_' || gen_random_uuid();
  -- ADDITIVE (065). NULL means the default branch, which is what the deployed
  -- admin sends: it has no location picker on the grant form and calls this with
  -- four arguments. Defaulting rather than refusing is what keeps that working.
  v_loc      text := coalesce(p_location_id, tpa.default_location_id());
  v_loc_name text;
begin
  if not public.is_admin() then return jsonb_build_object('ok', false, 'reason', 'not_admin'); end if;
  if not exists (select 1 from public.players where id = p_player_id) then
    return jsonb_build_object('ok', false, 'reason', 'player_missing');
  end if;
  if p_note is null or btrim(p_note) = '' then
    return jsonb_build_object('ok', false, 'reason', 'reason_required');
  end if;
  if p_quantity < 1 then return jsonb_build_object('ok', false, 'reason', 'quantity_below_one'); end if;

  -- ADDITIVE (065): comping credits at a branch that is closed would mint value
  -- nobody can spend. The default branch can never be inactive (set_location_active
  -- refuses it), so the NULL path above cannot trip this.
  if not exists (select 1 from public.locations where id = v_loc and is_active) then
    return jsonb_build_object('ok', false, 'reason', 'location_unavailable');
  end if;
  v_loc_name := tpa.location_name(v_loc);

  insert into public.credit_batches
    (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at, note, location_id)
  values
    (v_batch_id, p_player_id, 'admin_grant', null, p_training_type, p_quantity, p_quantity,
     now() + tpa.credit_expiry(), now(), btrim(p_note), v_loc);

  perform tpa.notify(
    p_player_id, 'credits_granted', 'Credits added',
    'You received ' || p_quantity || ' ' || initcap(p_training_type) || ' credit'
      || case when p_quantity = 1 then '' else 's' end
      -- ADDITIVE (065): credits are spendable at ONE branch now, so the message
      -- that announces them has to say which.
      || ' for ' || v_loc_name || '.',
    null, null);

  return jsonb_build_object('ok', true, 'credit_batch_id', v_batch_id, 'location_id', v_loc);
end;
$$;


-- ============================================================================
-- public.request_credits — issue #2 (is distinct from) + the not_null race
-- ============================================================================

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

  -- ADDITIVE (050): a coach account never acquires credits for itself.
  if (select public.current_coach_id()) is not null then
    return jsonb_build_object('ok', false, 'reason', 'coach_cannot_buy');
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

  -- ADDITIVE (063): a pre-1.4 client cannot buy outside the default branch.
  -- Placed after the package is resolved so the answer distinguishes "no such
  -- package" from "a real package you are too old to buy", and before anything
  -- is written.
  -- 065: `is distinct from`, not `<>`. With no default row `<>` yields NULL, the
  -- AND yields NULL, the IF does not fire and the guard fails OPEN — while the
  -- RLS policies using the same value fail CLOSED. Same condition, opposite
  -- directions, which is the shape of a latent hole.
  if v_pkg.location_id is distinct from tpa.default_location_id()
     and not tpa.client_is_location_aware() then
    return jsonb_build_object('ok', false, 'reason', 'update_required');
  end if;

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
    when not_null_violation then
      -- ADDITIVE (065): the SAME race, now surfacing one constraint earlier.
      -- tpa.force_location_from_package copies location_id from the package; if
      -- the package has just been hard-deleted the copy is NULL and location_id
      -- NOT NULL fires before the foreign key ever gets a chance. Concurrency
      -- scenario M caught this as a raw error where it used to be a clean reason.
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


-- grant_credits gained a parameter, so the 4-arg signature is dropped or both
-- would resolve. The deployed admin calls it with four arguments and binds to
-- the new one by default — the same move create_news made in migration 055.
drop function if exists public.grant_credits(text, text, int, text);
revoke all on function public.grant_credits(text, text, int, text, text) from public, anon;
grant execute on function public.grant_credits(text, text, int, text, text) to authenticated;
