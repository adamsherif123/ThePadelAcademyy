-- ============================================================================
-- The 5h-empty-slot booking-window guard (Task 2). Single-session logical
-- proof — the real concurrent race is proven separately in concurrency.sh's
-- Scenario N. Proves:
--  * an EMPTY slot inside the window (+4h) is rejected with booking_window_closed;
--  * the boundary is inclusive-allow at exactly 5h (mirrors cancellation_window's
--    own strict-boundary convention: exactly-the-window counts as OUTSIDE/allowed
--    for booking, same ">=") and clearly allowed just past it (+5h 1s);
--  * a slot with an EXISTING booking is unaffected even deep inside the window
--    (+4h, booked_count=1 already) — the 2nd booking succeeds normally;
--  * the reason code is exactly 'booking_window_closed', not a generic slot_full;
--  * admin_book_player is DELIBERATELY untouched — an admin can still seat a
--    walk-in on an empty slot inside the window (the guard is player-only,
--    book_slot, by design — see the migration header).
--
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(10);

-- ── seed as postgres ─────────────────────────────────────────────────────────
insert into auth.users (id) values
  ('b0000000-b000-b000-b000-b00000000000'),   -- admin
  ('b1000000-b100-b100-b100-b10000000001'),   -- player X (empty-slot attempts)
  ('b1000000-b100-b100-b100-b10000000002'),   -- player Y (already-booked scenario, pre-existing)
  ('b1000000-b100-b100-b100-b10000000003');   -- player Z (already-booked scenario, the 2nd booker)

insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('adm_bw', 'b0000000-b000-b000-b000-b00000000000', 'AdmBw', now());

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_bw_x', '+201900005001', 'BwX', 'men', 'beginner', now(), 'b1000000-b100-b100-b100-b10000000001'),
  ('pl_bw_y', '+201900005002', 'BwY', 'men', 'beginner', now(), 'b1000000-b100-b100-b100-b10000000002'),
  ('pl_bw_z', '+201900005003', 'BwZ', 'men', 'beginner', now(), 'b1000000-b100-b100-b100-b10000000003');

insert into public.coaches (id, name, bio, is_active) values
  ('co_bw1', 'C', 'b', true), ('co_bw2', 'C', 'b', true), ('co_bw3', 'C', 'b', true),
  ('co_bw4', 'C', 'b', true), ('co_bw5', 'C', 'b', true);

insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, status) values
  ('sl_bw_4h',      'co_bw1', now()+interval '4 hour',          now()+interval '5 hour',  'trial', 4, 0, 'published'),
  ('sl_bw_5h',      'co_bw2', now()+interval '5 hour',          now()+interval '6 hour',  'trial', 4, 0, 'published'),
  ('sl_bw_5h1s',    'co_bw3', now()+interval '5 hour 1 second', now()+interval '6 hour',  'trial', 4, 0, 'published'),
  ('sl_bw_nonempty','co_bw4', now()+interval '4 hour',          now()+interval '5 hour',  'trial', 2, 1, 'published'),
  ('sl_bw_admin',   'co_bw5', now()+interval '2 hour',          now()+interval '3 hour',  'trial', 4, 0, 'published');

insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at) values
  ('cb_bw_x', 'pl_bw_x', 'signup_grant', null, 'trial', 3, 3, now()+interval '30 day', now()),
  ('cb_bw_y', 'pl_bw_y', 'signup_grant', null, 'trial', 1, 0, now()+interval '30 day', now()),  -- already spent (the pre-existing booking below)
  ('cb_bw_z', 'pl_bw_z', 'signup_grant', null, 'trial', 1, 1, now()+interval '30 day', now());

-- sl_bw_nonempty's pre-existing booking (the state a prior, pre-window booking left).
insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at) values
  ('bk_bw_pre', 'sl_bw_nonempty', 'pl_bw_y', 'cb_bw_y', 'booked', now());

-- ════════════════════════════════════════════════════════════════════════════
-- tpa.booking_window() itself
-- ════════════════════════════════════════════════════════════════════════════
select is(tpa.booking_window(), interval '5 hours', 'tpa.booking_window() = 5h (mirrors BOOKING_WINDOW_HOURS)');

-- ════════════════════════════════════════════════════════════════════════════
-- AS PLAYER X
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b1000000-b100-b100-b100-b10000000001","role":"authenticated"}',true);

select is(public.book_slot('sl_bw_4h')->>'reason', 'booking_window_closed', 'A) empty slot at +4h (inside window) → booking_window_closed, not slot_full');
select is((select booked_count from public.session_slots where id = 'sl_bw_4h'), 0, 'A) booked_count stays 0 — nothing landed');
select is((select count(*)::int from public.bookings where slot_id = 'sl_bw_4h'), 0, 'A) zero booking rows');
select is((select quantity_remaining from public.credit_batches where id = 'cb_bw_x'), 3, 'A) no credit spent on the rejected attempt');

select is(public.book_slot('sl_bw_5h')->>'ok', 'true', 'B) empty slot at EXACTLY +5h → allowed (boundary is inclusive, mirrors cancellation_window''s own strict-boundary convention)');
select is(public.book_slot('sl_bw_5h1s')->>'ok', 'true', 'C) empty slot at +5h 1s → clearly allowed (well outside the window)');

-- ════════════════════════════════════════════════════════════════════════════
-- AS PLAYER Z — sl_bw_nonempty already has ONE booking (pl_bw_y), same +4h window.
-- ════════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claims','{"sub":"b1000000-b100-b100-b100-b10000000003","role":"authenticated"}',true);
select is(public.book_slot('sl_bw_nonempty')->>'ok', 'true', 'D) a slot with an EXISTING booking is unaffected even inside the window — the 2nd booking succeeds');
select is((select booked_count from public.session_slots where id = 'sl_bw_nonempty'), 2, 'D) booked_count now 2/2 (the pre-existing seat + Z''s)');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- AS ADMIN — admin_book_player is DELIBERATELY untouched by this guard.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b0000000-b000-b000-b000-b00000000000","role":"authenticated"}',true);
select is(
  public.admin_book_player('sl_bw_admin', 'pl_bw_x', false, 'trial')->>'ok',
  'true', 'E) admin_book_player still seats a walk-in on an empty slot inside the window — the guard is player-only (book_slot), by design');
reset role;

select * from finish();
rollback;
