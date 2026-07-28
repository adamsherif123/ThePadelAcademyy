-- ============================================================================
-- Bug fix — open-slot capacity must follow the booking-chosen type, not just
-- 'individual'. Proof for 20260809000028_open_slot_capacity_fix.sql.
--
-- Device repro this guards against: an admin creates an open slot (default
-- capacity 4); a player books it choosing 'duo'; training_type correctly
-- becomes 'duo' but capacity stayed at 4 (group's number), so the "needs N
-- more" math read 3 more instead of duo's real 1. Root cause was DB-side:
-- book_slot/admin_book_player only ever forced capacity to a canonical value
-- for 'individual'; every other type fell through an `else capacity end` that
-- left the admin's original default untouched.
--
-- Run with:  supabase test db  (alongside open_type_slots_test.sql)
-- ============================================================================
begin;
select plan(32);

-- ── tpa.canonical_capacity() itself — the SQL side of the parity discipline ──
select is(tpa.canonical_capacity('individual'), 1, 'canonical_capacity(individual) = 1');
select is(tpa.canonical_capacity('trial'),      1, 'canonical_capacity(trial) = 1');
select is(tpa.canonical_capacity('duo'),        2, 'canonical_capacity(duo) = 2');
select is(tpa.canonical_capacity('group'),      4, 'canonical_capacity(group) = 4');

-- ── seed as postgres (RLS bypassed; constraints still apply) ─────────────────
insert into auth.users (id) values
  ('a1111111-1111-1111-1111-111111111111'), -- oscf_a — books duo on an open slot
  ('a2222222-2222-2222-2222-222222222222'), -- oscf_b — books group on an open slot
  ('a3333333-3333-3333-3333-333333333333'), -- oscf_c — books trial on an open slot
  ('a4444444-4444-4444-4444-444444444444'), -- oscf_d — books individual on an open slot
  ('a5555555-5555-5555-5555-555555555555'), -- oscf_e — books an admin-preset (already-typed) slot
  ('a6666666-6666-6666-6666-666666666666'), -- oscf_f — first of two duo bookers (fill-confirmation)
  ('a7777777-7777-7777-7777-777777777777'), -- oscf_g — second of two duo bookers (fill-confirmation)
  ('a8888888-8888-8888-8888-888888888888'), -- oscf_h — sole booker on the revert-path slot
  ('a9999999-9999-9999-9999-999999999999'), -- oscf_i — first booker on the small (cap-1) open slot
  ('a1010101-0101-0101-0101-010101010101'), -- oscf_j — second booker, must be shut out at cap 1
  ('ffffffff-0000-0000-0000-ffffffffffff'); -- the admin (admin_book_player parity)

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_oscf_a', '+201900100001', 'OscfA', 'men',    'beginner', now(), 'a1111111-1111-1111-1111-111111111111'),
  ('pl_oscf_b', '+201900100002', 'OscfB', 'ladies', 'beginner', now(), 'a2222222-2222-2222-2222-222222222222'),
  ('pl_oscf_c', '+201900100003', 'OscfC', 'men',    'beginner', now(), 'a3333333-3333-3333-3333-333333333333'),
  ('pl_oscf_d', '+201900100004', 'OscfD', 'men',    'beginner', now(), 'a4444444-4444-4444-4444-444444444444'),
  ('pl_oscf_e', '+201900100005', 'OscfE', 'ladies', 'intermediate', now(), 'a5555555-5555-5555-5555-555555555555'),
  ('pl_oscf_f', '+201900100006', 'OscfF', 'men',    'beginner', now(), 'a6666666-6666-6666-6666-666666666666'),
  ('pl_oscf_g', '+201900100007', 'OscfG', 'men',    'beginner', now(), 'a7777777-7777-7777-7777-777777777777'),
  ('pl_oscf_h', '+201900100008', 'OscfH', 'men',    'beginner', now(), 'a8888888-8888-8888-8888-888888888888'),
  ('pl_oscf_i', '+201900100009', 'OscfI', 'men',    'beginner', now(), 'a9999999-9999-9999-9999-999999999999'),
  ('pl_oscf_j', '+201900100010', 'OscfJ', 'men',    'beginner', now(), 'a1010101-0101-0101-0101-010101010101');

insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('adm_oscf', 'ffffffff-0000-0000-0000-ffffffffffff', 'AdmOscf', now());

insert into public.coaches (id, name, bio, is_active) values
  ('co_oscf1','C','b',true), ('co_oscf2','C','b',true), ('co_oscf3','C','b',true), ('co_oscf4','C','b',true),
  ('co_oscf5','C','b',true), ('co_oscf6','C','b',true), ('co_oscf7','C','b',true), ('co_oscf8','C','b',true),
  ('co_oscf9','C','b',true);

-- sl_oscf_duo/group/trial/ind: OPEN slots, admin default capacity as noted.
-- sl_oscf_group uses a DELIBERATELY BIGGER admin default (6) than group's
-- canonical 4, so the assertion proves an actual override, not coincidence.
-- sl_oscf_preset: admin-PRESET 'group', capacity 6 (a genuinely odd class
-- size) — training_type is non-null from creation, so the fix's CASE (gated
-- on `training_type is null`) must never touch it.
-- sl_oscf_fill: OPEN, admin default 4 — two racers book 'duo' in turn.
-- sl_oscf_revert: OPEN, admin default 5 — one booker types it 'duo', then
-- cancels, and capacity must restore to 5 (not stay stuck at 2).
-- sl_oscf_small: OPEN, admin capacity 1 — SMALLER than duo's canonical (2).
-- Concurrency Scenario J caught the bug this fixture guards: a bare overwrite
-- to canonical would WIDEN this slot's capacity 1 → 2 the instant the first
-- booking chose 'duo', letting a genuine second racer past the admin's
-- explicit physical ceiling. least(capacity, canonical) must keep it at 1.
insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status) values
  ('sl_oscf_duo',    'co_oscf1', now()+interval '1 day', now()+interval '1 day 1 hour', null,    4, 0, null,    null, 'published'),
  ('sl_oscf_group',  'co_oscf2', now()+interval '1 day', now()+interval '1 day 1 hour', null,    6, 0, null,    null, 'published'),
  ('sl_oscf_trial',  'co_oscf3', now()+interval '1 day', now()+interval '1 day 1 hour', null,    4, 0, null,    null, 'published'),
  ('sl_oscf_ind',    'co_oscf4', now()+interval '1 day', now()+interval '1 day 1 hour', null,    4, 0, null,    null, 'published'),
  ('sl_oscf_preset', 'co_oscf5', now()+interval '1 day', now()+interval '1 day 1 hour', 'group', 6, 0, 'ladies', 'intermediate', 'published'),
  ('sl_oscf_fill',   'co_oscf6', now()+interval '1 day', now()+interval '1 day 1 hour', null,    4, 0, null,    null, 'published'),
  ('sl_oscf_revert', 'co_oscf7', now()+interval '1 day', now()+interval '1 day 1 hour', null,    5, 0, null,    null, 'published'),
  ('sl_oscf_small',  'co_oscf9', now()+interval '1 day', now()+interval '1 day 1 hour', null,    1, 0, null,    null, 'published');

insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at) values
  ('cb_oscf_a', 'pl_oscf_a', 'signup_grant', null, 'duo',        5, 5, now()+interval '30 day', now()),
  ('cb_oscf_b', 'pl_oscf_b', 'signup_grant', null, 'group',      5, 5, now()+interval '30 day', now()),
  ('cb_oscf_c', 'pl_oscf_c', 'signup_grant', null, 'trial',      5, 5, now()+interval '30 day', now()),
  ('cb_oscf_d', 'pl_oscf_d', 'signup_grant', null, 'individual', 5, 5, now()+interval '30 day', now()),
  ('cb_oscf_e', 'pl_oscf_e', 'signup_grant', null, 'group',      5, 5, now()+interval '30 day', now()),
  ('cb_oscf_f', 'pl_oscf_f', 'signup_grant', null, 'duo',        5, 5, now()+interval '30 day', now()),
  ('cb_oscf_g', 'pl_oscf_g', 'signup_grant', null, 'duo',        5, 5, now()+interval '30 day', now()),
  ('cb_oscf_h', 'pl_oscf_h', 'signup_grant', null, 'duo',        5, 5, now()+interval '30 day', now()),
  ('cb_oscf_i', 'pl_oscf_i', 'signup_grant', null, 'duo',        5, 5, now()+interval '30 day', now()),
  ('cb_oscf_j', 'pl_oscf_j', 'signup_grant', null, 'duo',        5, 5, now()+interval '30 day', now());

-- ════════════════════════════════════════════════════════════════════════════
-- 1) The core bug — each type forces capacity to ITS OWN canonical number,
--    not just 'individual'. sl_oscf_group's admin default (6) differs from
--    group's canonical (4), proving this is a real override.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select is(public.book_slot('sl_oscf_duo','duo')->>'ok', 'true', 'A books duo on an open (cap-4-default) slot → ok');
select is((select capacity from public.session_slots where id='sl_oscf_duo'), 2, 'sl_oscf_duo capacity forced 4 → 2 (duo canonical) — THE bug this fixes');
select is((select pre_booking_capacity from public.session_slots where id='sl_oscf_duo'), 4, 'sl_oscf_duo stashes the admin default (4) for a future revert');

select set_config('request.jwt.claims', '{"sub":"a2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
select is(public.book_slot('sl_oscf_group','group')->>'ok', 'true', 'B books group on an open (cap-6-default) slot → ok');
select is((select capacity from public.session_slots where id='sl_oscf_group'), 4, 'sl_oscf_group capacity forced 6 → 4 (group canonical, not the admin''s bigger default)');
select is((select pre_booking_capacity from public.session_slots where id='sl_oscf_group'), 6, 'sl_oscf_group stashes the admin default (6)');

select set_config('request.jwt.claims', '{"sub":"a3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select is(public.book_slot('sl_oscf_trial','trial')->>'ok', 'true', 'C books trial on an open slot → ok');
select is((select capacity from public.session_slots where id='sl_oscf_trial'), 1, 'sl_oscf_trial capacity forced 4 → 1 (trial canonical)');

select set_config('request.jwt.claims', '{"sub":"a4444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
select is(public.book_slot('sl_oscf_ind','individual')->>'ok', 'true', 'D books individual on an open slot → ok');
select is((select capacity from public.session_slots where id='sl_oscf_ind'), 1, 'sl_oscf_ind capacity forced 4 → 1 (individual canonical — regression, pre-dates this fix)');

-- ════════════════════════════════════════════════════════════════════════════
-- 2) admin_book_player gets the identical fix (parity between the two RPCs).
-- ════════════════════════════════════════════════════════════════════════════
reset role;
insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status) values
  ('sl_oscf_admin_duo', 'co_oscf8', now()+interval '1 day', now()+interval '1 day 1 hour', null, 4, 0, null, null, 'published');
insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at) values
  ('cb_oscf_admin', 'pl_oscf_a', 'admin_grant', null, 'duo', 5, 5, now()+interval '30 day', now());
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ffffffff-0000-0000-0000-ffffffffffff","role":"authenticated"}', true);
select is(public.admin_book_player('sl_oscf_admin_duo','pl_oscf_a',false,'duo')->>'ok', 'true', 'Admin books A as duo on an open slot via admin_book_player → ok');
select is((select capacity from public.session_slots where id='sl_oscf_admin_duo'), 2, 'admin_book_player ALSO forces capacity 4 → 2 for duo — parity with book_slot');

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Admin-PRESET typed slot: capacity is the admin's explicit choice and is
--    NEVER touched — training_type was never null, so the fix's CASE (gated
--    on the pre-image being null) doesn't fire at all.
-- ════════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claims', '{"sub":"a5555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
select is(public.book_slot('sl_oscf_preset')->>'ok', 'true', 'E books the admin-preset group/cap-6 slot (no type arg needed) → ok');
select is((select capacity from public.session_slots where id='sl_oscf_preset'), 6, 'sl_oscf_preset capacity UNTOUCHED at the admin''s explicit 6 (a bigger-than-canonical class)');
select is((select pre_booking_capacity from public.session_slots where id='sl_oscf_preset'), null, 'sl_oscf_preset pre_booking_capacity stays null — never an open slot, nothing to stash');

-- ════════════════════════════════════════════════════════════════════════════
-- 4) Fill-confirmation fires at the CORRECTED number — a duo slot confirms at
--    2 bookings, not 4 (the pre-fix bug would have needed 2 MORE bookings that
--    could never legitimately arrive on a duo credit).
-- ════════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claims', '{"sub":"a6666666-6666-6666-6666-666666666666","role":"authenticated"}', true);
select is(public.book_slot('sl_oscf_fill','duo')->>'ok', 'true', 'F books duo on sl_oscf_fill (fixes capacity 4 → 2, 1/2 booked)');
select is((select count(*)::int from public.notifications where slot_id='sl_oscf_fill' and type='session_confirmed'), 0, 'not yet confirmed at 1/2 — no notification yet');

select set_config('request.jwt.claims', '{"sub":"a7777777-7777-7777-7777-777777777777","role":"authenticated"}', true);
select is(public.book_slot('sl_oscf_fill','duo')->>'ok', 'true', 'G joins as the 2nd duo booker — 2/2, fills at duo''s REAL capacity');
-- notifications is RLS-restricted to the OWNING player (see s12_notifications_test.sql)
-- — reset to postgres to read F's row while still authenticated as G.
reset role;
select is((select count(*)::int from public.notifications where slot_id='sl_oscf_fill' and type='session_confirmed'), 1, 'session_confirmed fires at 2/2 (duo canonical) — would have needed 4 bookings under the old bug');
select is((select player_id from public.notifications where slot_id='sl_oscf_fill' and type='session_confirmed'), 'pl_oscf_f', '…addressed to F, the other booker, not G who just filled it');

-- ════════════════════════════════════════════════════════════════════════════
-- 5) Revert path — a booking-set duo slot that empties restores the admin's
--    ORIGINAL capacity (5), not stuck at duo's forced-down 2. Untouched by
--    this fix (tpa.free_slot_seat is not redefined here); this proves the
--    pre_booking_capacity this fix now correctly POPULATES for duo (never
--    populated before) is correctly CONSUMED by the pre-existing revert logic.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a8888888-8888-8888-8888-888888888888","role":"authenticated"}', true);
select is(public.book_slot('sl_oscf_revert','duo')->>'ok', 'true', 'H books duo on sl_oscf_revert (cap 5 → 2, stashes pre_booking_capacity=5)');
select is((select capacity from public.session_slots where id='sl_oscf_revert'), 2, 'sl_oscf_revert capacity forced to duo''s 2 before the revert');

select is(
  public.cancel_booking((select id from public.bookings where slot_id='sl_oscf_revert' and player_id='pl_oscf_h' and status='booked'))->>'ok',
  'true',
  'H cancels her sole booking on sl_oscf_revert'
);
reset role;
select is((select training_type from public.session_slots where id='sl_oscf_revert'), null, 'sl_oscf_revert REVERTS to untyped (booking-set, now empty)');
select is((select capacity from public.session_slots where id='sl_oscf_revert'), 5, 'sl_oscf_revert capacity RESTORED to the admin''s original 5 — not stuck at duo''s 2');

-- ════════════════════════════════════════════════════════════════════════════
-- 6) least() narrowing guard — an admin's open slot SMALLER than a type's
--    canonical capacity must NOT be widened. This is the exact bug
--    concurrency.sh's Scenario J caught: a bare `capacity := canonical(...)`
--    would grow this cap-1 slot to 2 the moment 'duo' won, letting a genuine
--    second racer past the admin's stated physical ceiling.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a9999999-9999-9999-9999-999999999999","role":"authenticated"}', true);
select is(public.book_slot('sl_oscf_small','duo')->>'ok', 'true', 'I books duo on sl_oscf_small (admin cap 1, SMALLER than duo''s canonical 2)');
select is((select capacity from public.session_slots where id='sl_oscf_small'), 1, 'sl_oscf_small capacity stays at the admin''s 1 — NOT widened to duo''s 2 (least(), not a bare overwrite)');

select set_config('request.jwt.claims', '{"sub":"a1010101-0101-0101-0101-010101010101","role":"authenticated"}', true);
select is(public.book_slot('sl_oscf_small','duo')->>'reason', 'slot_full', 'J is shut out at the admin''s real capacity of 1 — the physical ceiling holds, mirroring concurrency Scenario J');

select * from finish();
rollback;
