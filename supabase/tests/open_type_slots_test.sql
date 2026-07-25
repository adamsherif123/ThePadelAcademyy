-- ============================================================================
-- Booking rework (open type slots) — pgTAP proof for Task 5.
--
-- Proves the single-session behaviour of the first-booking-sets-the-type
-- model: type-set-on-first-booking, immutability after, credit-of-the-CHOSEN-
-- type enforcement, individual auto-confirm at type-set time, the revert rule
-- (booking-set reverts to untyped when it empties; admin-set NEVER reverts),
-- admin pre-typed flow unchanged, level recorded but display-only (rule 4),
-- and gender still a hard block (rule 4's preserved half). The real-parallelism
-- race guarantees (type-set atomicity, different-type racers, revert racing a
-- new booking) are NOT provable in one session — see concurrency.sh Scenarios
-- H/I/J; this file's "ordering b" test proves that specific code branch
-- deterministically instead, since it wasn't reliably reproducible by wall-
-- clock racing (book_slot's extra credit-check query makes its lock-acquiring
-- UPDATE consistently slower to fire than cancel_booking's shorter path).
--
-- Run with:  supabase test db  (alongside rpc_test.sql / rpc_admin_test.sql)
-- ============================================================================
begin;
select plan(79);

-- ── seed as postgres (RLS bypassed; constraints still apply) ─────────────────
insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'), -- ots_a — first booker on sl_ots1/3
  ('22222222-2222-2222-2222-222222222222'), -- ots_b — second booker, same type, different level
  ('33333333-3333-3333-3333-333333333333'), -- ots_c — wrong-gender booker
  ('44444444-4444-4444-4444-444444444444'), -- ots_d — no credit of the CHOSEN type
  ('55555555-5555-5555-5555-555555555555'), -- ots_e — individual booker
  ('66666666-6666-6666-6666-666666666666'), -- ots_f — books the admin-pretyped slot
  ('ffffffff-ffff-ffff-ffff-ffffffffffff'), -- the admin
  ('77777777-7777-7777-7777-777777777777'), -- ots_g — admin_book_player, sets duo
  ('88888888-8888-8888-8888-888888888888'), -- ots_h — admin_book_player, mismatched type
  ('99999999-9999-9999-9999-999999999999'); -- ots_i — admin_book_player, joins after (no type arg)

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_ots_a', '+201900000001', 'OtsA', 'ladies', 'intermediate', now(), '11111111-1111-1111-1111-111111111111'),
  ('pl_ots_b', '+201900000002', 'OtsB', 'ladies', 'beginner',     now(), '22222222-2222-2222-2222-222222222222'),
  ('pl_ots_c', '+201900000003', 'OtsC', 'men',    'beginner',     now(), '33333333-3333-3333-3333-333333333333'),
  ('pl_ots_d', '+201900000004', 'OtsD', 'ladies', 'beginner',     now(), '44444444-4444-4444-4444-444444444444'),
  ('pl_ots_e', '+201900000005', 'OtsE', 'men',    'beginner',     now(), '55555555-5555-5555-5555-555555555555'),
  ('pl_ots_f', '+201900000006', 'OtsF', 'men',    'beginner',     now(), '66666666-6666-6666-6666-666666666666'),
  ('pl_ots_g', '+201900000007', 'OtsG', 'men',    'beginner',     now(), '77777777-7777-7777-7777-777777777777'),
  ('pl_ots_h', '+201900000008', 'OtsH', 'men',    'beginner',     now(), '88888888-8888-8888-8888-888888888888'),
  ('pl_ots_i', '+201900000009', 'OtsI', 'men',    'beginner',     now(), '99999999-9999-9999-9999-999999999999');

-- A1: the admin is NOT a player — an auth user linked to an admins row.
insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('adm_ots', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'Adm', now());

insert into public.coaches (id, name, bio, is_active) values
  ('co_ots1','C','b',true), ('co_ots2','C','b',true), ('co_ots3','C','b',true), ('co_ots4','C','b',true),
  ('co_ots5','C','b',true), ('co_ots7','C','b',true), ('co_ots8','C','b',true), ('co_ots9','C','b',true);

-- sl_ots1: untyped, cap 4 — primary type-set/immutability/gender/level slot.
-- sl_ots2: untyped, cap 1 — individual auto-confirm (no-op capacity case).
-- sl_ots3: untyped, cap 4 — the revert-on-empty (booking-set) slot.
-- sl_ots4: ADMIN-pretyped ('trial'), cap 4 — proves admin-set NEVER reverts.
-- sl_ots5: untyped, cap 4 — the credit-of-chosen-type slot.
-- sl_ots7: typed ('trial'), cap 1, FULL — the deterministic "ordering b" proof.
-- sl_ots8: untyped, cap 3 — individual auto-confirm, capacity ACTUALLY forced (3→1).
-- sl_ots9: untyped, cap 4 — admin_book_player parity (sets type, immutable, regression).
insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status) values
  ('sl_ots1', 'co_ots1', now()+interval '1 day', now()+interval '1 day 1 hour', null,    4, 0, null, null, 'published'),
  ('sl_ots2', 'co_ots2', now()+interval '1 day', now()+interval '1 day 1 hour', null,    1, 0, null, null, 'published'),
  ('sl_ots3', 'co_ots3', now()+interval '1 day', now()+interval '1 day 1 hour', null,    4, 0, null, null, 'published'),
  ('sl_ots4', 'co_ots4', now()+interval '1 day', now()+interval '1 day 1 hour', 'trial', 4, 0, null, null, 'published'),
  ('sl_ots5', 'co_ots5', now()+interval '1 day', now()+interval '1 day 1 hour', null,    4, 0, null, null, 'published'),
  ('sl_ots7', 'co_ots7', now()+interval '1 day', now()+interval '1 day 1 hour', 'trial', 1, 1, null, null, 'published'),
  ('sl_ots8', 'co_ots8', now()+interval '1 day', now()+interval '1 day 1 hour', null,    3, 0, null, null, 'published'),
  ('sl_ots9', 'co_ots9', now()+interval '1 day', now()+interval '1 day 1 hour', null,    4, 0, null, null, 'published');

insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at) values
  ('cb_ots_a_grp',   'pl_ots_a', 'signup_grant', null, 'group',      5, 5, now()+interval '30 day', now()),
  ('cb_ots_a_duo',   'pl_ots_a', 'admin_grant',  null, 'duo',        2, 2, now()+interval '30 day', now()),
  ('cb_ots_b_grp',   'pl_ots_b', 'signup_grant', null, 'group',      5, 5, now()+interval '30 day', now()),
  ('cb_ots_c_grp',   'pl_ots_c', 'signup_grant', null, 'group',      5, 5, now()+interval '30 day', now()),
  ('cb_ots_d_trial', 'pl_ots_d', 'signup_grant', null, 'trial',      5, 5, now()+interval '30 day', now()), -- NOT group — the credit-of-chosen-type test
  ('cb_ots_e_ind',   'pl_ots_e', 'signup_grant', null, 'individual', 2, 2, now()+interval '30 day', now()),
  ('cb_ots_f_trial', 'pl_ots_f', 'signup_grant', null, 'trial',      5, 5, now()+interval '30 day', now()),
  ('cb_ots_g_duo',   'pl_ots_g', 'signup_grant', null, 'duo',        2, 2, now()+interval '30 day', now()),
  ('cb_ots_h_grp',   'pl_ots_h', 'signup_grant', null, 'group',      2, 2, now()+interval '30 day', now()),
  ('cb_ots_i_duo',   'pl_ots_i', 'signup_grant', null, 'duo',        2, 2, now()+interval '30 day', now());

-- ════════════════════════════════════════════════════════════════════════════
-- 1) TYPE-SET-ON-FIRST-BOOKING, IMMUTABILITY, credit-of-the-CHOSEN-type,
--    gender still blocks, level is recorded but display-only (rule 4).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

select is(public.book_slot('sl_ots1')->>'reason',        'type_required', 'untyped slot + no type given → type_required');
select is(public.book_slot('sl_ots1','bogus')->>'reason', 'invalid_type',  'untyped slot + unrecognised type string → invalid_type');

select is(public.book_slot('sl_ots1','group')->>'ok', 'true', 'A books sl_ots1 as group → ok (first booking sets the type)');
select is((select training_type from public.session_slots where id='sl_ots1'), 'group',        'sl_ots1.training_type set to group by the first booking');
select is((select gender       from public.session_slots where id='sl_ots1'), 'ladies',        'sl_ots1.gender recorded from the first booker (gate for later bookers)');
select is((select level        from public.session_slots where id='sl_ots1'), 'intermediate',  'sl_ots1.level recorded from the first booker (display-only, rule 4)');
select isnt((select set_by_booking_at from public.session_slots where id='sl_ots1'), null, 'set_by_booking_at populated — this type-set was booking-driven');
select is((select quantity_remaining from public.credit_batches where id='cb_ots_a_grp'), 4, 'A''s group credit spent (5 → 4)');

-- Immutability: a DIFFERENT type from a second player is rejected.
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select is(public.book_slot('sl_ots1','duo')->>'reason', 'type_mismatch', 'a second player choosing a DIFFERENT type on an already-typed slot → type_mismatch (immutable)');

-- Level is display-only: B's level ('beginner') differs from the recorded level
-- ('intermediate') yet still joins (matching type, matching gender).
select is(public.book_slot('sl_ots1','group')->>'ok', 'true', 'B books the SAME type despite a LEVEL mismatch with the recorded level → ok (level never blocks, rule 4)');
select is((select booked_count from public.session_slots where id='sl_ots1'), 2, 'sl_ots1 booked_count 1 → 2 (B joined)');
select is((select level from public.session_slots where id='sl_ots1'), 'intermediate', 'the recorded level is UNCHANGED by B''s join — only the FIRST booker sets it');

-- Gender STILL blocks (rule 4's preserved half).
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select is(public.book_slot('sl_ots1','group')->>'reason', 'gender_mismatch', 'a men player is blocked by the recorded gender (ladies, from the first booker) — gender is NOT display-only');

-- credit-of-the-CHOSEN-type enforced server-side, regardless of what a picker offers.
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
select is(public.book_slot('sl_ots5','group')->>'reason', 'no_usable_credit', 'D picks group but only holds a trial credit → no_usable_credit (server-enforced)');
select is((select training_type from public.session_slots where id='sl_ots5'), null, 'sl_ots5 stays untyped — a rejected credit check never sets the type');

-- ════════════════════════════════════════════════════════════════════════════
-- 2) INDIVIDUAL AUTO-CONFIRM AT TYPE-SET TIME (rule 5).
-- ════════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);

select is(public.book_slot('sl_ots2','individual')->>'ok', 'true', 'E books individual on an untyped slot → ok');
select is((select training_type from public.session_slots where id='sl_ots2'), 'individual', 'sl_ots2.training_type set to individual');
select is((select booked_count >= capacity from public.session_slots where id='sl_ots2'), true, 'derived fill-confirmation (S11.1) reads TRUE immediately — auto-confirmed at type-set time');

-- Same, but with an original capacity ≠ 1 — actually exercises the forcing CASE.
select is(public.book_slot('sl_ots8','individual')->>'ok', 'true', 'E books individual on an untyped, capacity-3 slot → ok');
select is((select capacity from public.session_slots where id='sl_ots8'), 1, 'capacity FORCED from 3 → 1 for individual (rule 5, genuinely exercised)');
select is((select pre_booking_capacity from public.session_slots where id='sl_ots8'), 3, 'the original capacity (3) is stashed in pre_booking_capacity for a future revert');
select is((select booked_count >= capacity from public.session_slots where id='sl_ots8'), true, 'derived fill-confirmation reads confirmed immediately (1 >= 1)');

-- ════════════════════════════════════════════════════════════════════════════
-- 3) THE REVERT RULE — booking-set reverts to untyped when it empties;
--    an ADMIN-SET type NEVER reverts.
-- ════════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select is(public.book_slot('sl_ots3','group')->>'ok', 'true', 'A books sl_ots3 as group (booking-set; the sole booking)');
select isnt((select set_by_booking_at from public.session_slots where id='sl_ots3'), null, 'sl_ots3 is booking-set');

select is(
  public.cancel_booking((select id from public.bookings where slot_id='sl_ots3' and player_id='pl_ots_a' and status='booked'))->>'ok',
  'true', 'A cancels her sole booking on sl_ots3');
select is((select training_type   from public.session_slots where id='sl_ots3'), null, 'sl_ots3 REVERTS to untyped — booking-set + emptied to zero (Task 3)');
select is((select booked_count    from public.session_slots where id='sl_ots3'), 0,    'sl_ots3 booked_count back to 0');
select is((select set_by_booking_at from public.session_slots where id='sl_ots3'), null, 'set_by_booking_at cleared on revert');
select is((select gender          from public.session_slots where id='sl_ots3'), null, 'gender cleared on revert');
select is((select level           from public.session_slots where id='sl_ots3'), null, 'level cleared on revert');

-- Genuinely open inventory: A can now re-book sl_ots3 with a DIFFERENT type.
select is(public.book_slot('sl_ots3','duo')->>'ok', 'true', 'sl_ots3 accepts a DIFFERENT type after reverting — genuinely open inventory');
select is((select training_type from public.session_slots where id='sl_ots3'), 'duo', 'sl_ots3 is now typed duo — not stuck on the old (group) type');

-- ADMIN-SET type never reverts: sl_ots4 was created ALREADY typed 'trial'
-- (set_by_booking_at never populated on the admin path).
select set_config('request.jwt.claims', '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}', true);
select is((select set_by_booking_at from public.session_slots where id='sl_ots4'), null, 'sl_ots4 (admin-created, pre-typed) starts with set_by_booking_at null');
select is(public.book_slot('sl_ots4')->>'ok', 'true', 'F books the admin-pretyped sl_ots4 — no type argument needed (regression, unchanged flow)');
select is((select booked_count from public.session_slots where id='sl_ots4'), 1, 'sl_ots4 booked_count 0 → 1');
select is(
  public.cancel_booking((select id from public.bookings where slot_id='sl_ots4' and player_id='pl_ots_f' and status='booked'))->>'ok',
  'true', 'F cancels her sole booking on the admin-pretyped sl_ots4');
select is((select training_type from public.session_slots where id='sl_ots4'), 'trial', 'sl_ots4 STAYS typed trial — admin-set types NEVER revert');
select is((select booked_count  from public.session_slots where id='sl_ots4'), 0,       'sl_ots4 booked_count back to 0, still typed');

-- ════════════════════════════════════════════════════════════════════════════
-- 4) The deterministic "ordering b" proof (concurrency.sh Scenario H's race,
--    reproduced here without contention): a MISMATCHED type on an ALREADY-
--    typed, FULL slot must return type_mismatch from the diagnostic branch,
--    not slot_full.
-- ════════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select is(public.book_slot('sl_ots7','group')->>'reason', 'type_mismatch',
  'a full, ALREADY-typed slot with a MISMATCHED type request → type_mismatch, not slot_full');

select set_config('request.jwt.claims', '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}', true);
select is(public.book_slot('sl_ots7')->>'reason', 'slot_full',
  'the SAME (matching, implicit) type on a full slot → slot_full — contrast with the type_mismatch case above');

-- ════════════════════════════════════════════════════════════════════════════
-- 5) admin_book_player gets IDENTICAL treatment (parity with book_slot).
-- ════════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claims', '{"sub":"ffffffff-ffff-ffff-ffff-ffffffffffff","role":"authenticated"}', true);

select is(public.admin_book_player('sl_ots9','pl_ots_g',false,'duo')->>'ok', 'true', 'admin books G as duo on an untyped slot → ok (sets the type)');
select is((select training_type from public.session_slots where id='sl_ots9'), 'duo', 'sl_ots9.training_type set to duo by the admin''s first booking');

select is(public.admin_book_player('sl_ots9','pl_ots_h',false,'group')->>'reason', 'type_mismatch',
  'admin path: a DIFFERENT type on an already-typed slot → type_mismatch (immutability holds for admin_book_player too)');

select is(public.admin_book_player('sl_ots9','pl_ots_i',false)->>'ok', 'true',
  'admin books I with NO type argument on the now-typed slot → ok (regression: admin can omit the type once set, exactly like before)');
select is((select booked_count from public.session_slots where id='sl_ots9'), 2, 'sl_ots9 booked_count 0 → 2 (G + I)');

-- ════════════════════════════════════════════════════════════════════════════
-- 6) FIX 2 — session_slots_group_shape CHECK: the four (gender,level) nullness
--    shapes under training_type IS NULL. Branch 2's old bare
--    `training_type = 'group'` equality evaluates to NULL (not FALSE) when
--    training_type IS NULL — three-valued logic let an untyped row with BOTH
--    gender and level set slip through (FALSE OR NULL OR FALSE = NULL =
--    "satisfied"). Fixed to `training_type is not null and training_type =
--    'group' and ...`, a hard FALSE for every untyped row.
-- ════════════════════════════════════════════════════════════════════════════
-- Raw fixture INSERTs from here need superuser privilege (RLS grants only
-- allow authenticated writes through the SECURITY DEFINER RPCs, not directly
-- on the tables) — reset to postgres for seeding, same as the file's own
-- top-of-file convention; switched back to authenticated at each RPC call.
reset role;
insert into public.coaches (id, name, bio, is_active) values ('co_ots_chk','C','b',true);

select lives_ok(
  $$ insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status)
       values ('sl_ots_chk1', 'co_ots_chk', now()+interval '1 day', now()+interval '1 day 1 hour', null, 4, 0, null, null, 'published') $$,
  'untyped + gender NULL + level NULL → legal (the only valid untyped shape)');

select throws_ok(
  $$ insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status)
       values ('sl_ots_chk2', 'co_ots_chk', now()+interval '1 day', now()+interval '1 day 1 hour', null, 4, 0, 'ladies', null, 'published') $$,
  '23514', null, 'untyped + gender SET + level NULL → rejected');

select throws_ok(
  $$ insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status)
       values ('sl_ots_chk3', 'co_ots_chk', now()+interval '1 day', now()+interval '1 day 1 hour', null, 4, 0, null, 'beginner', 'published') $$,
  '23514', null, 'untyped + gender NULL + level SET → rejected');

select throws_ok(
  $$ insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status)
       values ('sl_ots_chk4', 'co_ots_chk', now()+interval '1 day', now()+interval '1 day 1 hour', null, 4, 0, 'ladies', 'beginner', 'published') $$,
  '23514', null, 'untyped + gender SET + level SET → rejected — THE exploit shape the old branch 2 vacuously passed');

-- ════════════════════════════════════════════════════════════════════════════
-- 7) FIX 3 — delete_account shares the revert: a lone booking-set booker
--    deletes their account → the slot reverts to untyped with capacity
--    restored, not stuck typed-but-empty (the state Scenario H asserts
--    impossible).
-- ════════════════════════════════════════════════════════════════════════════
insert into auth.users (id) values ('12121212-1212-1212-1212-121212121212');
insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_ots_j', '+201900000010', 'OtsJ', 'men', 'beginner', now(), '12121212-1212-1212-1212-121212121212');
insert into public.coaches (id, name, bio, is_active) values ('co_ots_da','C','b',true);
insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status) values
  ('sl_ots_da', 'co_ots_da', now()+interval '1 day', now()+interval '1 day 1 hour', null, 3, 0, null, null, 'published');
insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at) values
  ('cb_ots_j_ind', 'pl_ots_j', 'signup_grant', null, 'individual', 2, 2, now()+interval '30 day', now());

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"12121212-1212-1212-1212-121212121212","role":"authenticated"}', true);
select is(public.book_slot('sl_ots_da','individual')->>'ok', 'true', 'J books individual on sl_ots_da (untyped, cap 3) → ok (booking-set, capacity forced 3→1)');
select is((select pre_booking_capacity from public.session_slots where id='sl_ots_da'), 3, 'sl_ots_da stashes pre_booking_capacity=3 before delete_account runs');

select is(public.delete_account()->>'ok', 'true', 'J deletes her account (her sole booking is on a FUTURE slot)');
-- J's own JWT is now anonymised (auth_user_id nulled) — RLS correctly hides her
-- own booking/player rows from that former identity from here on, so the
-- remaining assertions read as postgres (bypassing RLS), same as the seed step.
reset role;
select is((select training_type from public.session_slots where id='sl_ots_da'), null, 'sl_ots_da REVERTS to untyped via delete_account — shares the same revert as cancel_booking (FIX 3)');
select is((select booked_count  from public.session_slots where id='sl_ots_da'), 0,    'sl_ots_da booked_count back to 0');
select is((select capacity      from public.session_slots where id='sl_ots_da'), 3,    'capacity RESTORED to 3 — not stuck at the individual-forced 1');
select is((select status from public.bookings where slot_id='sl_ots_da' and player_id='pl_ots_j'), 'cancelled', 'J''s booking is cancelled by delete_account');
select is((select name from public.players where id='pl_ots_j'), 'Deleted player', 'J''s player row is anonymised as before (regression)');

-- ════════════════════════════════════════════════════════════════════════════
-- 8) FIX 4 — reschedule_session reconciles pre_booking_capacity: cleared ONLY
--    when the admin genuinely changes capacity; left alone when they don't.
-- ════════════════════════════════════════════════════════════════════════════
reset role;
insert into auth.users (id) values ('13131313-1313-1313-1313-131313131313'), ('14141414-1414-1414-1414-141414141414');
insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_ots_k', '+201900000011', 'OtsK', 'men', 'beginner', now(), '13131313-1313-1313-1313-131313131313'),
  ('pl_ots_l', '+201900000012', 'OtsL', 'men', 'beginner', now(), '14141414-1414-1414-1414-141414141414');
insert into public.coaches (id, name, bio, is_active) values ('co_ots_rs1','C','b',true), ('co_ots_rs2','C','b',true);
insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status) values
  ('sl_ots_rs1', 'co_ots_rs1', now()+interval '1 day', now()+interval '1 day 1 hour', null, 3, 0, null, null, 'published'),
  ('sl_ots_rs2', 'co_ots_rs2', now()+interval '1 day', now()+interval '1 day 1 hour', null, 3, 0, null, null, 'published');
insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at) values
  ('cb_ots_k_ind', 'pl_ots_k', 'signup_grant', null, 'individual', 1, 1, now()+interval '30 day', now()),
  ('cb_ots_l_ind', 'pl_ots_l', 'signup_grant', null, 'individual', 1, 1, now()+interval '30 day', now());

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"13131313-1313-1313-1313-131313131313","role":"authenticated"}', true);
select is(public.book_slot('sl_ots_rs1','individual')->>'ok', 'true', 'K books individual on sl_ots_rs1 (cap 3→1, pre_booking_capacity=3)');
select set_config('request.jwt.claims', '{"sub":"14141414-1414-1414-1414-141414141414","role":"authenticated"}', true);
select is(public.book_slot('sl_ots_rs2','individual')->>'ok', 'true', 'L books individual on sl_ots_rs2 (cap 3→1, pre_booking_capacity=3)');

-- Admin reschedules rs1 WITHOUT touching capacity (p_capacity = current = 1) —
-- the stash must survive.
select set_config('request.jwt.claims', '{"sub":"ffffffff-ffff-ffff-ffff-ffffffffffff","role":"authenticated"}', true);
select is(public.reschedule_session('sl_ots_rs1','co_ots_rs1',1,now()+interval '2 day',now()+interval '2 day 1 hour')->>'ok', 'true', 'admin reschedules rs1 (time only, capacity unchanged at 1)');
select is((select pre_booking_capacity from public.session_slots where id='sl_ots_rs1'), 3, 'pre_booking_capacity SURVIVES — capacity was not touched, so the original stash is still correct');
-- cancel_booking is a self-service RPC (current_player_id()-scoped) — switch the
-- JWT claim back to K (it was left on the admin's for the reschedule call above).
select set_config('request.jwt.claims', '{"sub":"13131313-1313-1313-1313-131313131313","role":"authenticated"}', true);
select is(
  public.cancel_booking((select id from public.bookings where slot_id='sl_ots_rs1' and player_id='pl_ots_k' and status='booked'))->>'ok',
  'true', 'K cancels her sole booking on rs1');
select is((select capacity from public.session_slots where id='sl_ots_rs1'), 3, 'rs1 revert restores the ORIGINAL 3 — the stash was never touched by the untouched-capacity reschedule');

-- Admin reschedules rs2 WHILE explicitly changing capacity (1 → 2) — the stash
-- must be cleared; a later revert must NOT overwrite the admin's new number.
-- Switch the JWT back to the admin (it was left on K's for her cancel above).
select set_config('request.jwt.claims', '{"sub":"ffffffff-ffff-ffff-ffff-ffffffffffff","role":"authenticated"}', true);
select is(public.reschedule_session('sl_ots_rs2','co_ots_rs2',2,now()+interval '2 day',now()+interval '2 day 1 hour')->>'ok', 'true', 'admin reschedules rs2, explicitly re-capacitying 1 → 2');
select is((select pre_booking_capacity from public.session_slots where id='sl_ots_rs2'), null, 'pre_booking_capacity CLEARED — the admin''s new capacity supersedes the pre-individual stash');
-- Switch the JWT to L for her own self-service cancel.
select set_config('request.jwt.claims', '{"sub":"14141414-1414-1414-1414-141414141414","role":"authenticated"}', true);
select is(
  public.cancel_booking((select id from public.bookings where slot_id='sl_ots_rs2' and player_id='pl_ots_l' and status='booked'))->>'ok',
  'true', 'L cancels her sole booking on rs2');
select is((select capacity from public.session_slots where id='sl_ots_rs2'), 2, 'rs2 revert KEEPS the admin''s explicit 2 — does NOT silently restore the stale pre-individual 3 (FIX 4)');

-- ════════════════════════════════════════════════════════════════════════════
-- 9) admin_book_player's `overridden` field: true only when override was
--    ACTUALLY needed (a genuine mismatch existed), never just because
--    p_override was passed true.
-- ════════════════════════════════════════════════════════════════════════════
reset role;
insert into auth.users (id) values ('15151515-1515-1515-1515-151515151515'), ('16161616-1616-1616-1616-161616161616');
insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_ots_m', '+201900000013', 'OtsM', 'ladies', 'beginner', now(), '15151515-1515-1515-1515-151515151515'),
  ('pl_ots_n', '+201900000014', 'OtsN', 'men',    'beginner', now(), '16161616-1616-1616-1616-161616161616');
insert into public.coaches (id, name, bio, is_active) values ('co_ots_ov','C','b',true);
insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status) values
  ('sl_ots_ov', 'co_ots_ov', now()+interval '1 day', now()+interval '1 day 1 hour', null, 4, 0, null, null, 'published');
insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at) values
  ('cb_ots_m_grp', 'pl_ots_m', 'signup_grant', null, 'group', 2, 2, now()+interval '30 day', now()),
  ('cb_ots_n_grp', 'pl_ots_n', 'signup_grant', null, 'group', 2, 2, now()+interval '30 day', now());

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ffffffff-ffff-ffff-ffff-ffffffffffff","role":"authenticated"}', true);

-- M: override=true but sl_ots_ov has no gender YET (untyped) — override was
-- never actually needed. Captured once (a second call would be already_booked).
create temporary table tmp_ots_verdict_m as select public.admin_book_player('sl_ots_ov','pl_ots_m',true,'group') as v;
select is((select v->>'ok' from tmp_ots_verdict_m), 'true', 'admin books M (ladies) as group with override=true — no gender recorded yet, sets the type');
select is((select v->>'overridden' from tmp_ots_verdict_m), 'false', 'overridden=FALSE — override was passed but never actually needed (v_mismatch was false)');
drop table tmp_ots_verdict_m;

-- N: override=true, joining the now-ladies-recorded sl_ots_ov as men — a
-- GENUINE mismatch this time.
create temporary table tmp_ots_verdict_n as select public.admin_book_player('sl_ots_ov','pl_ots_n',true) as v;
select is((select v->>'ok' from tmp_ots_verdict_n), 'true', 'admin books N (men) onto the now-ladies-recorded sl_ots_ov with override=true — a genuine mismatch, seated anyway');
select is((select v->>'overridden' from tmp_ots_verdict_n), 'true', 'overridden=TRUE — override was genuinely needed this time (a real gender mismatch existed)');
drop table tmp_ots_verdict_n;

-- ════════════════════════════════════════════════════════════════════════════
-- 10) THE DELETE_ACCOUNT RACE RESIDUAL — deterministic single-session proof of
--     the "lost race" branch (mirrors concurrency.sh's real Scenario L): O's
--     booking is ALREADY cancelled (simulating a concurrent cancel_booking
--     having already won) by the time delete_account runs for her. It must
--     skip the seat-free entirely — not double-decrement booked_count, not
--     wrongly revert a slot where P's booking is still live.
-- ════════════════════════════════════════════════════════════════════════════
reset role;
insert into auth.users (id) values ('17171717-1717-1717-1717-171717171717'), ('18181818-1818-1818-1818-181818181818');
insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_ots_o', '+201900000015', 'OtsO', 'men', 'beginner', now(), '17171717-1717-1717-1717-171717171717'),
  ('pl_ots_p', '+201900000016', 'OtsP', 'men', 'beginner', now(), '18181818-1818-1818-1818-181818181818');
insert into public.coaches (id, name, bio, is_active) values ('co_ots_da2','C','b',true);
insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, set_by_booking_at, status) values
  ('sl_ots_da2', 'co_ots_da2', now()+interval '5 hour', now()+interval '6 hour', 'group', 4, 2, 'men', 'beginner', now(), 'published');
insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at) values
  ('cb_ots_o_grp', 'pl_ots_o', 'signup_grant', null, 'group', 1, 0, now()+interval '30 day', now()),
  ('cb_ots_p_grp', 'pl_ots_p', 'signup_grant', null, 'group', 1, 0, now()+interval '30 day', now());
insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at) values
  ('bk_ots_o', 'sl_ots_da2', 'pl_ots_o', 'cb_ots_o_grp', 'booked', now()),
  ('bk_ots_p', 'sl_ots_da2', 'pl_ots_p', 'cb_ots_p_grp', 'booked', now());

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"17171717-1717-1717-1717-171717171717","role":"authenticated"}', true);
-- O cancels her OWN booking first — simulates the concurrent cancel_booking
-- having already WON the race before delete_account's loop reaches it.
select is(public.cancel_booking('bk_ots_o')->>'ok', 'true', 'O cancels her own booking on sl_ots_da2 BEFORE delete_account runs (simulates the winning racer)');
select is((select booked_count from public.session_slots where id='sl_ots_da2'), 1, 'sl_ots_da2 booked_count correctly down to 1 (P remains) via the ordinary cancel_booking path');
select is((select training_type from public.session_slots where id='sl_ots_da2'), 'group', 'sl_ots_da2 stays typed — P is still booked, so it does not revert');

-- O now deletes her account. Her booking is ALREADY cancelled — delete_account's
-- loop must find zero rows on the guarded booking-cancel and skip the seat-free.
select is(public.delete_account()->>'ok', 'true', 'O deletes her account after her booking was already cancelled');
reset role;
select is((select booked_count from public.session_slots where id='sl_ots_da2'), 1, 'booked_count UNCHANGED by delete_account (1) — NOT double-decremented to 0');
select is((select training_type from public.session_slots where id='sl_ots_da2'), 'group', 'training_type UNCHANGED — delete_account did NOT wrongly revert a slot where P is still live');
select is((select status from public.bookings where id='bk_ots_p'), 'booked', 'P''s booking is completely untouched');
select is((select name from public.players where id='pl_ots_o'), 'Deleted player', 'O''s player row is still anonymised regardless — that part of delete_account is unconditional');

select * from finish();
rollback;
