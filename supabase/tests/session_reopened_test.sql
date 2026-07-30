-- ============================================================================
-- session_reopened — the mirror of session_confirmed: a cancellation that
-- drops a fill-confirmed session back below capacity notifies the remaining
-- players. Proves:
--  * a fill-confirmed slot losing one of two bookings → the ONE remaining
--    player gets exactly one session_reopened; the canceller gets none;
--  * a fill-confirmed slot losing one of three → BOTH remaining players get
--    one each;
--  * THE TRAP — a MANUALLY confirmed slot dropping below capacity does NOT
--    reopen (manually_confirmed_at still holds) → zero session_reopened;
--  * a cancel that empties a slot to zero (booking-set, so it reverts to
--    untyped) → zero session_reopened (the fan-out naturally targets zero
--    rows) and the revert itself is untouched by this migration;
--  * "a still-full slot after cancel" cannot actually occur — free_slot_seat
--    always decrements booked_count by exactly 1, and session_slots' own
--    session_slots_not_oversold CHECK (booked_count <= capacity) rejects any
--    row that would ever exceed capacity, so there is no state for the gate
--    to mishandle; proven by the CHECK itself refusing to seed one;
--  * remove_booking parity — the admin path emits the SAME session_reopened
--    to the remaining player, alongside its own unchanged removed_from_session.
--
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(27);

-- ── seed as postgres ─────────────────────────────────────────────────────────
insert into auth.users (id) values
  ('f0000000-f000-f000-f000-f00000000000'),   -- admin
  ('a1000000-a100-a100-a100-a10000000001'), ('a1000000-a100-a100-a100-a10000000002'),
  ('b2000000-b200-b200-b200-b20000000001'), ('b2000000-b200-b200-b200-b20000000002'), ('b2000000-b200-b200-b200-b20000000003'),
  ('c3000000-c300-c300-c300-c30000000001'), ('c3000000-c300-c300-c300-c30000000002'),
  ('d4000000-d400-d400-d400-d40000000001'),
  ('f6000000-f600-f600-f600-f60000000001'), ('f6000000-f600-f600-f600-f60000000002');

insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('adm_sr', 'f0000000-f000-f000-f000-f00000000000', 'AdmSr', now());

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_sr_a1', '+201900003001', 'SrA1', 'men', 'beginner', now(), 'a1000000-a100-a100-a100-a10000000001'),
  ('pl_sr_a2', '+201900003002', 'SrA2', 'men', 'beginner', now(), 'a1000000-a100-a100-a100-a10000000002'),
  ('pl_sr_b1', '+201900003003', 'SrB1', 'men', 'beginner', now(), 'b2000000-b200-b200-b200-b20000000001'),
  ('pl_sr_b2', '+201900003004', 'SrB2', 'men', 'beginner', now(), 'b2000000-b200-b200-b200-b20000000002'),
  ('pl_sr_b3', '+201900003005', 'SrB3', 'men', 'beginner', now(), 'b2000000-b200-b200-b200-b20000000003'),
  ('pl_sr_c1', '+201900003006', 'SrC1', 'men', 'beginner', now(), 'c3000000-c300-c300-c300-c30000000001'),
  ('pl_sr_c2', '+201900003007', 'SrC2', 'men', 'beginner', now(), 'c3000000-c300-c300-c300-c30000000002'),
  ('pl_sr_d1', '+201900003008', 'SrD1', 'men', 'beginner', now(), 'd4000000-d400-d400-d400-d40000000001'),
  ('pl_sr_f1', '+201900003011', 'SrF1', 'men', 'beginner', now(), 'f6000000-f600-f600-f600-f60000000001'),
  ('pl_sr_f2', '+201900003012', 'SrF2', 'men', 'beginner', now(), 'f6000000-f600-f600-f600-f60000000002');

insert into public.coaches (id, name, bio, is_active) values ('co_sr', 'C', 'b', true);

-- Dedicated slot per scenario, distinct start times (no overlap constraint hit).
insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, manually_confirmed_at, set_by_booking_at, pre_booking_capacity, status) values
  ('sl_sr_fill2',  'co_sr', now()+interval '2 day',  now()+interval '2 day 1 hour',  'group',      2, 2, 'men', 'beginner', null, null, null, 'published'),
  ('sl_sr_fill3',  'co_sr', now()+interval '3 day',  now()+interval '3 day 1 hour',  'group',      3, 3, 'men', 'beginner', null, null, null, 'published'),
  ('sl_sr_manual', 'co_sr', now()+interval '4 day',  now()+interval '4 day 1 hour',  'group',      4, 2, 'men', 'beginner', null, null, null, 'published'),
  ('sl_sr_empty',  'co_sr', now()+interval '5 day',  now()+interval '5 day 1 hour',  'individual', 1, 1, null,  null,       null, now(), 3,   'published'),
  ('sl_sr_rmv',    'co_sr', now()+interval '7 day',  now()+interval '7 day 1 hour',  'group',      2, 2, 'men', 'beginner', null, null, null, 'published');

insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at) values
  ('cb_sr_a1','pl_sr_a1','signup_grant',null,'group',      4,3,now()+interval '30 day',now()),
  ('cb_sr_a2','pl_sr_a2','signup_grant',null,'group',      4,3,now()+interval '30 day',now()),
  ('cb_sr_b1','pl_sr_b1','signup_grant',null,'group',      4,3,now()+interval '30 day',now()),
  ('cb_sr_b2','pl_sr_b2','signup_grant',null,'group',      4,3,now()+interval '30 day',now()),
  ('cb_sr_b3','pl_sr_b3','signup_grant',null,'group',      4,3,now()+interval '30 day',now()),
  ('cb_sr_c1','pl_sr_c1','signup_grant',null,'group',      4,3,now()+interval '30 day',now()),
  ('cb_sr_c2','pl_sr_c2','signup_grant',null,'group',      4,3,now()+interval '30 day',now()),
  ('cb_sr_d1','pl_sr_d1','signup_grant',null,'individual', 4,3,now()+interval '30 day',now()),
  ('cb_sr_f1','pl_sr_f1','signup_grant',null,'group',      4,3,now()+interval '30 day',now()),
  ('cb_sr_f2','pl_sr_f2','signup_grant',null,'group',      4,3,now()+interval '30 day',now());

insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at) values
  ('bk_sr_a1','sl_sr_fill2','pl_sr_a1','cb_sr_a1','booked',now()),
  ('bk_sr_a2','sl_sr_fill2','pl_sr_a2','cb_sr_a2','booked',now()),
  ('bk_sr_b1','sl_sr_fill3','pl_sr_b1','cb_sr_b1','booked',now()),
  ('bk_sr_b2','sl_sr_fill3','pl_sr_b2','cb_sr_b2','booked',now()),
  ('bk_sr_b3','sl_sr_fill3','pl_sr_b3','cb_sr_b3','booked',now()),
  ('bk_sr_c1','sl_sr_manual','pl_sr_c1','cb_sr_c1','booked',now()),
  ('bk_sr_c2','sl_sr_manual','pl_sr_c2','cb_sr_c2','booked',now()),
  ('bk_sr_d1','sl_sr_empty','pl_sr_d1','cb_sr_d1','booked',now()),
  ('bk_sr_f1','sl_sr_rmv','pl_sr_f1','cb_sr_f1','booked',now()),
  ('bk_sr_f2','sl_sr_rmv','pl_sr_f2','cb_sr_f2','booked',now());

-- ════════════════════════════════════════════════════════════════════════════
-- A) fill-confirmed 2/2 → 1/2: the ONE remaining player is notified, the
--    canceller is not.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"a1000000-a100-a100-a100-a10000000001","role":"authenticated"}',true);
select is(public.cancel_booking('bk_sr_a1')->>'ok', 'true', 'A: pl_sr_a1 cancels their booking on the fill-confirmed 2/2 slot');
reset role;
select is((select count(*)::int from public.notifications where slot_id='sl_sr_fill2' and type='session_reopened'), 1, 'A: exactly ONE session_reopened for the slot');
select is((select player_id from public.notifications where slot_id='sl_sr_fill2' and type='session_reopened'), 'pl_sr_a2', 'A: …addressed to the remaining player, pl_sr_a2');
select is((select count(*)::int from public.notifications where slot_id='sl_sr_fill2' and player_id='pl_sr_a1'), 0, 'A: the canceller (pl_sr_a1) gets none');
select is((select body from public.notifications where slot_id='sl_sr_fill2' and type='session_reopened') like '%pending again%', true, 'A: copy says pending again');

-- ════════════════════════════════════════════════════════════════════════════
-- A2) fill-confirmed 3/3 → 2/3: BOTH remaining players are notified.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"b2000000-b200-b200-b200-b20000000001","role":"authenticated"}',true);
select is(public.cancel_booking('bk_sr_b1')->>'ok', 'true', 'A2: pl_sr_b1 cancels on the fill-confirmed 3/3 slot');
reset role;
select is((select count(*)::int from public.notifications where slot_id='sl_sr_fill3' and type='session_reopened'), 2, 'A2: exactly TWO session_reopened (both remaining players)');
select is((select count(*)::int from public.notifications where slot_id='sl_sr_fill3' and type='session_reopened' and player_id='pl_sr_b2'), 1, 'A2: pl_sr_b2 got one');
select is((select count(*)::int from public.notifications where slot_id='sl_sr_fill3' and type='session_reopened' and player_id='pl_sr_b3'), 1, 'A2: pl_sr_b3 got one');
select is((select count(*)::int from public.notifications where slot_id='sl_sr_fill3' and player_id='pl_sr_b1'), 0, 'A2: the canceller (pl_sr_b1) gets none');

-- ════════════════════════════════════════════════════════════════════════════
-- B) THE TRAP — manually confirmed 2/4 dropping to 1/4 does NOT reopen.
-- ════════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claims','{"sub":"f0000000-f000-f000-f000-f00000000000","role":"authenticated"}',true);
select is(public.confirm_session('sl_sr_manual')->>'already_confirmed', 'false', 'B: admin manually confirms the pending 2/4 slot');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"c3000000-c300-c300-c300-c30000000001","role":"authenticated"}',true);
select is(public.cancel_booking('bk_sr_c1')->>'ok', 'true', 'B: pl_sr_c1 cancels — slot drops to 1/4');
reset role;
select is((select count(*)::int from public.notifications where slot_id='sl_sr_manual' and type='session_reopened'), 0, 'B: the TRAP — manually confirmed, so NO session_reopened even though booked_count < capacity');
select is((select manually_confirmed_at from public.session_slots where id='sl_sr_manual') is not null, true, 'B: manually_confirmed_at still holds — the slot is genuinely still confirmed');

-- ════════════════════════════════════════════════════════════════════════════
-- C) cancel empties a booking-set slot to zero → reverts to untyped, zero
--    notifications (the fan-out naturally targets zero rows).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"d4000000-d400-d400-d400-d40000000001","role":"authenticated"}',true);
select is(public.cancel_booking('bk_sr_d1')->>'ok', 'true', 'C: pl_sr_d1 cancels the only booking on the booking-set individual slot');
reset role;
select is((select count(*)::int from public.notifications where slot_id='sl_sr_empty' and type='session_reopened'), 0, 'C: zero session_reopened — no remaining players to notify');
select is((select training_type from public.session_slots where id='sl_sr_empty'), null, 'C: the revert itself is untouched — slot reverts to untyped');
select is((select capacity from public.session_slots where id='sl_sr_empty'), 3, 'C: capacity restored to pre_booking_capacity — the revert logic is byte-identical');

-- ════════════════════════════════════════════════════════════════════════════
-- D) "a still-full slot after cancel" cannot actually occur: free_slot_seat
--    always decrements booked_count by exactly 1, and session_slots' own
--    session_slots_not_oversold CHECK (booked_count <= capacity) refuses to
--    let such a row exist in the first place — on INSERT or UPDATE. There is
--    no state left for the gate to ever mishandle; proven by the CHECK itself.
-- ════════════════════════════════════════════════════════════════════════════
select throws_ok(
  $$ insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, status)
     values ('sl_sr_over', 'co_sr', now()+interval '6 day', now()+interval '6 day 1 hour', 'group', 3, 5, 'published') $$,
  '23514', null, 'D: seeding booked_count(5) > capacity(3) is rejected outright by session_slots_not_oversold');
select is((select count(*)::int from public.session_slots where id='sl_sr_over'), 0, 'D: the rejected row was never created');
select throws_ok(
  $$ update public.session_slots set booked_count = 3 where id = 'sl_sr_rmv' $$,
  '23514', null, 'D: the SAME constraint also rejects an UPDATE that would push booked_count above capacity(2)');
select is((select booked_count from public.session_slots where id='sl_sr_rmv'), 2, 'D: the rejected update left booked_count untouched');

-- ════════════════════════════════════════════════════════════════════════════
-- E) remove_booking parity — the admin path emits the SAME session_reopened,
--    alongside its own unchanged removed_from_session.
-- ════════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claims','{"sub":"f0000000-f000-f000-f000-f00000000000","role":"authenticated"}',true);
select is(public.remove_booking('bk_sr_f1', true)->>'ok', 'true', 'E: admin removes pl_sr_f1 from the fill-confirmed 2/2 slot');
select is((select count(*)::int from public.notifications where slot_id='sl_sr_rmv' and type='session_reopened'), 1, 'E: exactly ONE session_reopened');
select is((select player_id from public.notifications where slot_id='sl_sr_rmv' and type='session_reopened'), 'pl_sr_f2', 'E: …addressed to the remaining player, pl_sr_f2');
select is((select count(*)::int from public.notifications where slot_id='sl_sr_rmv' and type='removed_from_session' and player_id='pl_sr_f1'), 1, 'E: removed_from_session still fires for the removed player — parity, unchanged');
select is((select count(*)::int from public.notifications where slot_id='sl_sr_rmv' and player_id='pl_sr_f1' and type='session_reopened'), 0, 'E: the removed player gets removed_from_session, not session_reopened');

select * from finish();
rollback;
