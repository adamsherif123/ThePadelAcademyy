-- ============================================================================
-- One-off production data correction: remove two duo credit batches, the
-- attendance they were spent on, and the purchases behind them.
--
-- Administrative removal, authorised explicitly, with the coach-hours cost
-- accepted up front: Aly Salem −1h and Abdelrahman −1h for September 2026,
-- because a slot earns its hour by having at least one ATTENDED booking
-- (tpa.coach_hours_between) and both of those slots drop to zero attended.
--
-- ── why this is a migration and not a console session ──
-- It is the only transactional, reviewable, replayable path this repo has to
-- production. Everything below is idempotent and GUARDED: on any database where
-- the two batches are absent — every local reset, dev, CI — the whole block
-- returns before touching a row. That is why `supabase db reset` and the pgTAP
-- suite are unaffected by it.
--
-- ── the preconditions are assertions, not comments ──
-- Production is live and moved between the investigation and this write (the
-- players table grew by three in the interim). So the block re-checks, inside the
-- transaction, that all 12 target rows are still present and that both purchases
-- are still succeeded-and-UNPAID. If any of that has drifted, it raises and the
-- whole transaction rolls back rather than deleting something it did not survey.
-- `paid = false` is the load-bearing one: revenue is "succeeded AND paid", so
-- these two EGP 4,000 purchases contribute zero to collected revenue, and that is
-- the entire basis on which deleting them was approved.
--
-- ── what is deliberately NOT touched ──
--   * No session_slots row is deleted. Ever. Two slots are emptied and reverted
--     to untyped; they remain as the record that a session existed.
--   * sl_14c6e920 is a SHARED slot: Mostafa Hoballah's attended booking is its
--     only real occupant and is left exactly as it is, hour intact. The two rows
--     removed from it were already `cancelled` and had already handed their seats
--     back, so its booked_count must NOT move — asserted below, before and after.
--   * Each player's separate 1/1 duo admin_grant batch is out of scope.
--   * The two session_reminder notifications that point at deleted bookings keep
--     their row and their slot deep-link; only the dangling booking_id is
--     cleared. Those reminders really were sent, and a player's inbox history is
--     not this correction's business — but notifications.booking_id is a real FK
--     and would otherwise abort the delete.
-- ============================================================================

do $$
declare
  v_batches   int;
  v_bookings  int;
  v_purchases int;
  v_drifted   int;
  v_14_count  int;   -- booked_count on the shared slot, before
  v_14_real   int;   -- its genuine occupants, after
  v_notifs    int;
begin
  -- ── the guard: is this the database this correction was written for? ──
  select count(*) into v_batches from public.credit_batches
   where id in ('cb_4af673e9-5301-421e-b37c-d2b65bc5f673',
                'cb_b8f96178-7ffa-4abf-8f98-68ee155cda16');

  if v_batches = 0 then
    raise notice 'remove_two_credit_batches: target batches absent — nothing to do (not production).';
    return;
  end if;

  if v_batches <> 2 then
    raise exception 'expected exactly 2 target credit batches, found %', v_batches;
  end if;

  -- ── preconditions ──
  select count(*) into v_bookings from public.bookings
   where id in ('bk_671a4b82-b43f-4d18-a626-58a0d42f205d',
                'bk_4835350d-a171-4621-a13d-7ec1698724cd',
                'bk_7b90dca4-f251-4300-a762-178ef4dc0ef2',
                'bk_5d3b3a1e-aad1-4f6b-9961-2e0ab9148827',
                'bk_abb1c139-638e-4423-8e2a-848242dda051');
  if v_bookings <> 5 then
    raise exception 'expected exactly 5 target bookings, found %', v_bookings;
  end if;

  select count(*) into v_purchases from public.purchases
   where id in ('pu_2c27acb1-42ca-46cc-85b0-e6917a10cade',
                'pu_693d43e6-34e0-49f3-b9e4-d5b4c400fe62');
  if v_purchases <> 2 then
    raise exception 'expected exactly 2 target purchases, found %', v_purchases;
  end if;

  -- The approval rested on these being uncollected. Re-checked here, in the
  -- transaction, not trusted from the investigation.
  select count(*) into v_drifted from public.purchases
   where id in ('pu_2c27acb1-42ca-46cc-85b0-e6917a10cade',
                'pu_693d43e6-34e0-49f3-b9e4-d5b4c400fe62')
     and not (status = 'succeeded' and paid = false);
  if v_drifted <> 0 then
    raise exception
      'ABORT: % target purchase(s) are no longer succeeded-and-unpaid; deleting them would destroy collected revenue',
      v_drifted;
  end if;

  -- The shared slot's count, captured before anything moves.
  select booked_count into v_14_count from public.session_slots
   where id = 'sl_14c6e920-5d0b-4301-b774-035554216530';
  if v_14_count is null then
    raise exception 'shared slot sl_14c6e920 is missing';
  end if;

  -- ── 1. clear the dangling FK, keeping the notifications themselves ──
  update public.notifications
     set booking_id = null
   where booking_id in ('bk_671a4b82-b43f-4d18-a626-58a0d42f205d',
                        'bk_4835350d-a171-4621-a13d-7ec1698724cd',
                        'bk_7b90dca4-f251-4300-a762-178ef4dc0ef2',
                        'bk_5d3b3a1e-aad1-4f6b-9961-2e0ab9148827',
                        'bk_abb1c139-638e-4423-8e2a-848242dda051');
  get diagnostics v_notifs = row_count;
  raise notice 'detached % notification(s) from the bookings being removed', v_notifs;

  -- ── 2. the five booking rows ──
  delete from public.bookings
   where id in ('bk_671a4b82-b43f-4d18-a626-58a0d42f205d',
                'bk_4835350d-a171-4621-a13d-7ec1698724cd',
                'bk_7b90dca4-f251-4300-a762-178ef4dc0ef2',
                'bk_5d3b3a1e-aad1-4f6b-9961-2e0ab9148827',
                'bk_abb1c139-638e-4423-8e2a-848242dda051');

  -- ── 3. the two emptied slots ──
  -- Set to 0 outright, never decremented: sl_08d0fa5c's booked_count was ALREADY
  -- wrong (2, against a single booking row — the only such slot on production),
  -- so decrementing would have left another phantom seat behind. The type revert
  -- mirrors tpa.free_slot_seat's empty branch exactly, capacity restore included:
  -- both slots were typed BY a booking (set_by_booking_at is set), so emptying
  -- them hands them back to the calendar as open, untyped time.
  update public.session_slots
     set booked_count          = 0,
         training_type         = null,
         gender                = null,
         level                 = null,
         capacity              = coalesce(pre_booking_capacity, capacity),
         pre_booking_capacity  = null,
         set_by_booking_at     = null
   where id in ('sl_e2c0a236-b84f-41c1-a3b5-3a1d759484fb',
                'sl_08d0fa5c-1a9d-4a67-b6f7-03f428ba0133');

  -- ── 4. the batches ──
  delete from public.credit_batches
   where id in ('cb_4af673e9-5301-421e-b37c-d2b65bc5f673',
                'cb_b8f96178-7ffa-4abf-8f98-68ee155cda16');

  -- ── 5. the requests, then the purchases ──
  -- Both credit_requests.purchase_id and credit_batches.purchase_id point AT
  -- purchases, so every referrer has to go first. The batches are already gone.
  delete from public.credit_requests
   where purchase_id in ('pu_2c27acb1-42ca-46cc-85b0-e6917a10cade',
                         'pu_693d43e6-34e0-49f3-b9e4-d5b4c400fe62');

  delete from public.purchases
   where id in ('pu_2c27acb1-42ca-46cc-85b0-e6917a10cade',
                'pu_693d43e6-34e0-49f3-b9e4-d5b4c400fe62');

  -- ── postconditions: the shared slot is the one that must not have moved ──
  select count(*) into v_14_real from public.bookings
   where slot_id = 'sl_14c6e920-5d0b-4301-b774-035554216530'
     and status <> 'cancelled';
  if v_14_real <> v_14_count then
    raise exception
      'ABORT: shared slot sl_14c6e920 now holds % real booking(s) but booked_count is % — the two removed rows were supposed to be already-cancelled',
      v_14_real, v_14_count;
  end if;

  if not exists (select 1 from public.bookings
                  where id = 'bk_700de20b-178b-4d47-b37d-088250e43292'
                    and status = 'attended') then
    raise exception 'ABORT: Mostafa Hoballah''s attended booking on the shared slot did not survive';
  end if;

  raise notice 'remove_two_credit_batches: done. shared slot booked_count unchanged at %.', v_14_count;
end
$$;
