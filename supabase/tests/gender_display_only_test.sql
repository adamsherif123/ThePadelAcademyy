-- ============================================================================
-- Gender becomes display-only — pgTAP proof for 20260813000032.
--
-- Two things this file proves that no existing file covers end to end:
--   1) The FULL shape matrix the rewritten session_slots_group_shape /
--      availability_templates_group_shape CHECKs admit and reject, now that
--      gender is fully unconstrained by type (every combination of
--      training_type ∈ {null, group, non-group} × level ∈ {null, set} ×
--      gender ∈ {null, set} — 12 cells on session_slots; the templates CHECK
--      is identical in shape, spot-checked rather than fully duplicated here
--      since open_type_templates_test.sql already covers its own matrix).
--   2) book_slot / admin_book_player single-session proof that a MIXED-GENDER
--      group actually books end to end — two different-gender players join
--      the SAME slot, both succeed, gender is still recorded from the first
--      booker (display-only, not blocking).
--
-- Real-parallelism mixed-gender booking is concurrency.sh Scenario K
-- (repurposed by this same change) — this file is the deterministic,
-- single-session companion, same division of labour as
-- open_type_slots_test.sql's relationship to concurrency.sh H/I/J/L.
--
-- Run with:  supabase test db
-- ============================================================================
begin;
select plan(20);

-- ── seed as postgres (RLS bypassed; constraints still apply) ─────────────────
-- A1: the admin is a SEPARATE identity — its own auth user, no player row.
insert into auth.users (id) values
  ('21212121-2121-2121-2121-212121212121'), -- gdo_a — men, first booker
  ('22222222-2121-2121-2121-212121212121'), -- gdo_b — ladies, second booker, same slot
  ('23232323-2121-2121-2121-212121212121'), -- gdo_c — ladies, admin_book_player path
  ('24242424-2121-2121-2121-212121212121'); -- the admin

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_gdo_a', '+201900100001', 'GdoA', 'men',    'beginner', now(), '21212121-2121-2121-2121-212121212121'),
  ('pl_gdo_b', '+201900100002', 'GdoB', 'ladies', 'beginner', now(), '22222222-2121-2121-2121-212121212121'),
  ('pl_gdo_c', '+201900100003', 'GdoC', 'ladies', 'beginner', now(), '23232323-2121-2121-2121-212121212121');

insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('adm_gdo', '24242424-2121-2121-2121-212121212121', 'AdmGdo', now());

insert into public.coaches (id, name, bio, is_active) values
  ('co_gdo1','C','b',true), ('co_gdo2','C','b',true), ('co_gdo_chk','C','b',true);

-- sl_gdo1: untyped, cap 4 — the mixed-gender book_slot proof.
insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status) values
  ('sl_gdo1', 'co_gdo1', now()+interval '1 day', now()+interval '1 day 1 hour', null, 4, 0, null, null, 'published');

insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at) values
  ('cb_gdo_a', 'pl_gdo_a', 'signup_grant', null, 'group', 2, 2, now()+interval '30 day', now()),
  ('cb_gdo_b', 'pl_gdo_b', 'signup_grant', null, 'group', 2, 2, now()+interval '30 day', now());

-- ════════════════════════════════════════════════════════════════════════════
-- 1) book_slot: two DIFFERENT-gender players book the SAME group slot — both
--    succeed. Gender is still recorded from the first booker (display-only,
--    mirroring level exactly), the second booker's differing gender is never
--    even inspected.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"21212121-2121-2121-2121-212121212121","role":"authenticated"}', true);
select is(public.book_slot('sl_gdo1','group')->>'ok', 'true', 'A (men) books sl_gdo1 as group — first booking, sets the type and records gender');
select is((select gender from public.session_slots where id='sl_gdo1'), 'men', 'sl_gdo1.gender recorded from the first booker (A, men)');

select set_config('request.jwt.claims', '{"sub":"22222222-2121-2121-2121-212121212121","role":"authenticated"}', true);
select is(public.book_slot('sl_gdo1','group')->>'ok', 'true', 'B (ladies) joins the SAME, now men-recorded slot — ok (gender no longer blocks)');
select is((select booked_count from public.session_slots where id='sl_gdo1'), 2, 'sl_gdo1 booked_count 1 → 2 — a genuinely mixed-gender group session');
select is((select gender from public.session_slots where id='sl_gdo1'), 'men', 'the recorded gender is UNCHANGED by B''s join — only the FIRST booker sets it (mirrors level exactly)');
-- reset role: bookings_select_own_or_admin / players_select_self_or_admin only
-- let B's own authenticated session see HER row, not A's — bypass RLS to check
-- the raw truth across both bookings, same convention as every other test file.
reset role;
select is(
  (select count(distinct p.gender)::int from public.bookings bk join public.players p on p.id = bk.player_id
     where bk.slot_id = 'sl_gdo1' and bk.status = 'booked'),
  2, 'the slot now genuinely holds bookings from BOTH genders — the whole point of this migration');

-- ════════════════════════════════════════════════════════════════════════════
-- 2) admin_book_player: same proof, admin path. C (ladies) is admin-booked
--    with NO override onto the now-men-recorded slot — succeeds without
--    p_override needing to do anything (nothing left to waive).
-- ════════════════════════════════════════════════════════════════════════════
-- Raw fixture INSERT needs superuser privilege (RLS grants only allow
-- authenticated writes through the SECURITY DEFINER RPCs, not directly on the
-- tables) — already `reset role` from the block above.
insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at)
  values ('cb_gdo_c', 'pl_gdo_c', 'signup_grant', null, 'group', 1, 1, now()+interval '30 day', now());
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"24242424-2121-2121-2121-212121212121","role":"authenticated"}', true);
select is(public.admin_book_player('sl_gdo1','pl_gdo_c',false)->>'ok', 'true', 'admin books C (ladies) onto the men-recorded sl_gdo1 with override=FALSE — ok (nothing to override)');
select is((select booked_count from public.session_slots where id='sl_gdo1'), 3, 'sl_gdo1 booked_count 2 → 3 (C joined too — three players, two genders, one session)');

-- ════════════════════════════════════════════════════════════════════════════
-- 3) session_slots_group_shape — the full shape matrix the NEW CHECK admits
--    and rejects. Gender is now unconstrained in every branch; level's shape
--    (required for group, forbidden otherwise) is unchanged.
-- ════════════════════════════════════════════════════════════════════════════
reset role;
insert into public.coaches (id, name, bio, is_active) values ('co_gdo_shape','C','b',true);

-- All twelve share one coach — session_slots_coach_no_overlap (S5.1) blocks two
-- PUBLISHED slots on the same coach at overlapping times, so each gets its own
-- day offset (harmless for the throws_ok cases too, which never reach the
-- exclusion constraint since the CHECK fails first, but kept uniform so this
-- file never silently depends on constraint-evaluation ordering).

-- untyped (training_type IS NULL): legal iff level IS NULL, regardless of gender.
select lives_ok(
  $$ insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status)
       values ('sl_gdo_u1', 'co_gdo_shape', now()+interval '1 day', now()+interval '1 day 1 hour', null, 4, 0, null, null, 'published') $$,
  'untyped, gender NULL, level NULL → legal');
select lives_ok(
  $$ insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status)
       values ('sl_gdo_u2', 'co_gdo_shape', now()+interval '2 day', now()+interval '2 day 1 hour', null, 4, 0, 'men', null, 'published') $$,
  'untyped, gender SET, level NULL → legal (gender unconstrained)');
select throws_ok(
  $$ insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status)
       values ('sl_gdo_u3', 'co_gdo_shape', now()+interval '3 day', now()+interval '3 day 1 hour', null, 4, 0, null, 'beginner', 'published') $$,
  '23514', null, 'untyped, gender NULL, level SET → rejected (level still forbidden untyped)');
select throws_ok(
  $$ insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status)
       values ('sl_gdo_u4', 'co_gdo_shape', now()+interval '4 day', now()+interval '4 day 1 hour', null, 4, 0, 'men', 'beginner', 'published') $$,
  '23514', null, 'untyped, gender SET, level SET → rejected (level still forbidden untyped, regardless of gender)');

-- typed GROUP: legal iff level IS NOT NULL, regardless of gender.
select lives_ok(
  $$ insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status)
       values ('sl_gdo_g1', 'co_gdo_shape', now()+interval '5 day', now()+interval '5 day 1 hour', 'group', 4, 0, null, 'beginner', 'published') $$,
  'group, gender NULL, level SET → legal — THE new mixed-gender shape this migration exists for');
select lives_ok(
  $$ insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status)
       values ('sl_gdo_g2', 'co_gdo_shape', now()+interval '6 day', now()+interval '6 day 1 hour', 'group', 4, 0, 'ladies', 'beginner', 'published') $$,
  'group, gender SET, level SET → still legal — an admin may still choose a single-gender group');
select throws_ok(
  $$ insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status)
       values ('sl_gdo_g3', 'co_gdo_shape', now()+interval '7 day', now()+interval '7 day 1 hour', 'group', 4, 0, null, null, 'published') $$,
  '23514', null, 'group, gender NULL, level NULL → rejected — level is still REQUIRED for group, regardless of gender');
select throws_ok(
  $$ insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status)
       values ('sl_gdo_g4', 'co_gdo_shape', now()+interval '8 day', now()+interval '8 day 1 hour', 'group', 4, 0, 'ladies', null, 'published') $$,
  '23514', null, 'group, gender SET, level NULL → rejected — level still required for group even when gender is set');

-- typed NON-group (duo): legal iff level IS NULL, regardless of gender.
select lives_ok(
  $$ insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status)
       values ('sl_gdo_d1', 'co_gdo_shape', now()+interval '9 day', now()+interval '9 day 1 hour', 'duo', 2, 0, null, null, 'published') $$,
  'duo, gender NULL, level NULL → legal (the ordinary shape)');
select lives_ok(
  $$ insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status)
       values ('sl_gdo_d2', 'co_gdo_shape', now()+interval '10 day', now()+interval '10 day 1 hour', 'duo', 2, 0, 'men', null, 'published') $$,
  'duo, gender SET, level NULL → legal — gender is unconstrained for non-group too now');
select throws_ok(
  $$ insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status)
       values ('sl_gdo_d3', 'co_gdo_shape', now()+interval '11 day', now()+interval '11 day 1 hour', 'duo', 2, 0, null, 'beginner', 'published') $$,
  '23514', null, 'duo, gender NULL, level SET → rejected — level still forbidden for non-group');
select throws_ok(
  $$ insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status)
       values ('sl_gdo_d4', 'co_gdo_shape', now()+interval '12 day', now()+interval '12 day 1 hour', 'duo', 2, 0, 'men', 'beginner', 'published') $$,
  '23514', null, 'duo, gender SET, level SET → rejected — level still forbidden for non-group, regardless of gender');

select * from finish();
rollback;
