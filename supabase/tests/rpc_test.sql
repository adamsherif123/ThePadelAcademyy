-- ============================================================================
-- S7a — book_slot + cancel_booking proof (pgTAP, single session).
--
-- Rule parity: every @tpa/core canBookSlot block reason has an assertion here
-- proving book_slot rejects it the same way (see the session report's map).
-- Concurrency is NOT provable in a single session — that is concurrency.sh.
--
-- Run with:  supabase test db   (alongside rls_test.sql)
-- ============================================================================
begin;
select plan(33);

-- ── seed as postgres (RLS bypassed; constraints still apply) ─────────────────
-- S8: auth_user_id now FK-references auth.users — seed the linked auth rows first.
insert into auth.users (id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd');

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_a', '+201000000001', 'Ali',   'men',    'beginner',     now(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('pl_b', '+201000000002', 'Bea',   'ladies', 'intermediate', now(), 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('pl_c', '+201000000003', 'Cy',    'men',    'beginner',     now(), 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  ('pl_d', '+201000000004', 'Dina',  'men',    'beginner',     now(), 'dddddddd-dddd-dddd-dddd-dddddddddddd');

insert into public.coaches (id, name, bio, is_active) values
  ('co_ok','C','b',true), ('co_full','C','b',true), ('co_cancel','C','b',true), ('co_past','C','b',true),
  ('co_glady','C','b',true), ('co_gint','C','b',true), ('co_nocred','C','b',true), ('co_exp','C','b',true),
  ('co_b','C','b',true), ('co_ff','C','b',true), ('co_rf','C','b',true), ('co_cxl','C','b',true);

insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status) values
  ('sl_ok',      'co_ok',     now()+interval '1 day', now()+interval '1 day 1 hour', 'trial',      4, 0, null,     null,       'published'),
  ('sl_full',    'co_full',   now()+interval '1 day', now()+interval '1 day 1 hour', 'trial',      1, 1, null,     null,       'published'),
  ('sl_cancel',  'co_cancel', now()+interval '1 day', now()+interval '1 day 1 hour', 'trial',      4, 0, null,     null,       'cancelled'),
  ('sl_past',    'co_past',   now()-interval '2 hour', now()-interval '1 hour',      'trial',      4, 0, null,     null,       'published'),
  ('sl_glady',   'co_glady',  now()+interval '1 day', now()+interval '1 day 1 hour', 'group',      4, 0, 'ladies', 'beginner', 'published'),
  ('sl_gint',    'co_gint',   now()+interval '1 day', now()+interval '1 day 1 hour', 'group',      4, 0, 'men',    'intermediate','published'),
  ('sl_nocred',  'co_nocred', now()+interval '1 day', now()+interval '1 day 1 hour', 'trial',      4, 0, null,     null,       'published'),
  ('sl_expired', 'co_exp',    now()+interval '1 day', now()+interval '1 day 1 hour', 'trial',      4, 0, null,     null,       'published'),
  ('sl_b',       'co_b',      now()+interval '1 day', now()+interval '1 day 1 hour', 'trial',      4, 0, null,     null,       'published'),
  ('sl_forfeit', 'co_ff',     now()+interval '2 hour', now()+interval '3 hour',      'trial',      4, 0, null,     null,       'published'),
  ('sl_refund',  'co_rf',     now()+interval '5 hour', now()+interval '6 hour',      'trial',      4, 0, null,     null,       'published'),
  ('sl_cxl',     'co_cxl',    now()+interval '1 day', now()+interval '1 day 1 hour', 'trial',      4, 0, null,     null,       'published');

insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at) values
  ('cb_a',     'pl_a', 'signup_grant', null, 'trial', 10, 10, now()+interval '30 day', now()),
  ('cb_b',     'pl_b', 'signup_grant', null, 'trial', 2,  2,  now()+interval '30 day', now()),
  ('cb_d_exp', 'pl_d', 'signup_grant', null, 'trial', 2,  2,  now()-interval '1 day',  now()-interval '31 day');

-- B holds a booking (for the not_owner test); A holds one on a PAST slot (not_cancellable).
insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at) values
  ('bk_b',       'sl_b',   'pl_b', 'cb_b', 'booked', now()),
  ('bk_started', 'sl_past','pl_a', 'cb_a', 'booked', now()-interval '2 hour');

-- ── constants mirror @tpa/core, and the boundary is STRICT (as postgres) ─────
select is(tpa.cancellation_window(), interval '3 hours', 'tpa.cancellation_window() = 3h (mirrors CANCELLATION_WINDOW_HOURS)');
select is(tpa.credit_expiry(),       interval '30 days', 'tpa.credit_expiry() = 30d (mirrors CREDIT_EXPIRY_DAYS)');
select is((interval '3 hours'          > tpa.cancellation_window()), false, 'boundary strict: exactly the window is INSIDE → forfeit');
select is((interval '3 hours 1 second' > tpa.cancellation_window()), true,  'boundary strict: just past the window is OUTSIDE → refund');

-- ════════════════════════════════════════════════════════════════════════════
-- AS PLAYER A (men / beginner)
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);

-- book_slot rejection parity with canBookSlot:
select is(public.book_slot('sl_nope')->>'reason',   'slot_missing',   'canBookSlot slot_missing  ↔ RPC slot_missing (unknown slot)');
select is(public.book_slot('sl_cancel')->>'reason', 'slot_cancelled', 'canBookSlot slot_cancelled ↔ RPC slot_cancelled');
select is(public.book_slot('sl_past')->>'reason',   'slot_in_past',   'canBookSlot slot_in_past   ↔ RPC slot_in_past');
select is(public.book_slot('sl_glady')->>'reason',  'gender_mismatch','canBookSlot gender_mismatch ↔ RPC gender_mismatch (A is men, slot ladies)');
select is(public.book_slot('sl_gint')->>'reason',   'level_mismatch', 'canBookSlot level_mismatch  ↔ RPC level_mismatch (A is beginner, slot intermediate)');

-- ok path: books, takes a seat, spends exactly one credit, records the booking as A's.
select is(public.book_slot('sl_ok')->>'ok', 'true', 'A books sl_ok → ok');
select is((select booked_count from public.session_slots where id = 'sl_ok'), 1, 'sl_ok booked_count 0 → 1');
select is((select quantity_remaining from public.credit_batches where id = 'cb_a'), 9, 'cb_a spent one credit (10 → 9)');
select is((select player_id from public.bookings where slot_id = 'sl_ok' and status <> 'cancelled'), 'pl_a',
  'the booking belongs to A — player resolved from the JWT, never an argument');

-- already_booked (the partial unique index, mapped from 23505 to data):
select is(public.book_slot('sl_ok')->>'reason', 'already_booked', 'canBookSlot n/a ↔ RPC already_booked (second live booking)');

-- full (guarded increment yields 0 rows; no oversell):
select is(public.book_slot('sl_full')->>'reason', 'slot_full', 'canBookSlot slot_full ↔ RPC slot_full');
select is((select booked_count from public.session_slots where id = 'sl_full'), 1, 'sl_full stays 1/1 — no oversell');

-- cancel FORFEIT (inside the 3h window: slot starts in 2h):
select is(public.book_slot('sl_forfeit')->>'ok', 'true', 'A books sl_forfeit (+2h)');
select is(
  public.cancel_booking((select id from public.bookings where slot_id='sl_forfeit' and player_id='pl_a' and status='booked'))->>'refunded',
  'false', 'cancel inside window → forfeit (refunded=false)');
select is((select quantity_remaining from public.credit_batches where id = 'cb_a'), 8,
  'forfeit keeps the credit spent (cb_a stays 8, no refund)');
select is((select booked_count from public.session_slots where id = 'sl_forfeit'), 0, 'the seat is freed even on a forfeit');

-- cancel REFUND (outside the window: slot starts in 5h):
select is(public.book_slot('sl_refund')->>'ok', 'true', 'A books sl_refund (+5h) (cb_a 8 → 7)');
select is(
  public.cancel_booking((select id from public.bookings where slot_id='sl_refund' and player_id='pl_a' and status='booked'))->>'refunded',
  'true', 'cancel outside window → refund (refunded=true)');
select is((select quantity_remaining from public.credit_batches where id = 'cb_a'), 8, 'refund returns the credit to its batch (7 → 8)');

-- idempotent cancel — a double-cancel cannot double-refund:
select is(public.book_slot('sl_cxl')->>'ok', 'true', 'A books sl_cxl (cb_a 8 → 7)');
select is(
  public.cancel_booking((select id from public.bookings where slot_id='sl_cxl' and player_id='pl_a' and status='booked'))->>'ok',
  'true', 'first cancel of sl_cxl succeeds (7 → 8)');
select is(
  public.cancel_booking((select id from public.bookings where slot_id='sl_cxl' and player_id='pl_a' and status='cancelled' order by cancelled_at desc limit 1))->>'reason',
  'already_cancelled', 'second cancel → already_cancelled (no double refund)');
select is((select quantity_remaining from public.credit_batches where id = 'cb_a'), 8, 'cb_a still 8 — the credit was refunded exactly once');

-- cancel_booking guards:
select is(public.cancel_booking('bk_b')->>'reason',       'not_owner',       'A cannot cancel B''s booking → not_owner');
select is(public.cancel_booking('bk_started')->>'reason', 'not_cancellable', 'cannot cancel a started session → not_cancellable');
select is(public.cancel_booking('bk_nope')->>'reason',    'booking_missing', 'unknown booking → booking_missing');

-- cancel→rebook the SAME slot succeeds (the app allows it; the partial index now does too):
select is(public.book_slot('sl_cxl')->>'ok', 'true', 'A re-books sl_cxl after cancelling → ok (partial unique index)');

-- ════════════════════════════════════════════════════════════════════════════
-- AS PLAYER C (no credits) and D (only an EXPIRED credit) → no_usable_credit
-- ════════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claims', '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}', true);
select is(public.book_slot('sl_nocred')->>'reason', 'no_usable_credit', 'canBookSlot no_usable_credit ↔ RPC no_usable_credit (no credit at all)');

select set_config('request.jwt.claims', '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}', true);
select is(public.book_slot('sl_expired')->>'reason', 'no_usable_credit', 'no_usable_credit also covers an EXPIRED credit (expires_at > now() fails)');

select * from finish();
rollback;
