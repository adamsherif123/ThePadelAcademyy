-- ============================================================================
-- delete_credit_batch — the admin undo for a mis-entered payment (pgTAP).
--
-- What has to be true: only an admin can call it; a batch that has ever been
-- booked against is refused rather than taking attendance history down with it;
-- a purchase-backed batch takes its purchase AND its credit request with it; a
-- comp grant (no purchase, no request) deletes on its own; and the player's OTHER
-- credits are untouched by any of it.
--
-- Each destructive call happens EXACTLY ONCE, into a temp table, and the
-- assertions read that row. Calling the function again per assertion would be
-- reading the second call's answer (batch_missing) and calling it proof of the
-- first — which is how the first draft of this file managed to "pass".
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(28);

insert into auth.users (id) values
  ('0d0d0d01-0000-0000-0000-00000000d001'),   -- the admin
  ('0d0d0d02-0000-0000-0000-00000000d002');   -- an ordinary player

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_dcb_adm',  '+201900020001', 'Admin Human', 'men', 'beginner', now(), '0d0d0d01-0000-0000-0000-00000000d001'),
  ('pl_dcb_p1',   '+201900020002', 'Payer',       'men', 'beginner', now(), '0d0d0d02-0000-0000-0000-00000000d002');

insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('ad_dcb', '0d0d0d01-0000-0000-0000-00000000d001', 'Admin', now());

insert into public.packages (id, training_type, session_count, price, name, is_active) values
  ('pk_dcb', 'group', 4, 200000, 'Four group', true);

insert into public.coaches (id, name, bio, is_active) values
  ('co_dcb', 'Coach', 'b', true);

-- ── the fixtures under test ─────────────────────────────────────────────────
-- A: a purchase-backed batch that came from an APPROVED credit request — the
--    full three-row chain, and the main case.
-- B: a purchase-backed batch with a BOOKING against it — must refuse.
-- C: an admin_grant comp — no purchase, no request.
-- D: a second grant nothing ever touches, the control that proves the delete is
--    surgical rather than "everything belonging to this player".
insert into public.purchases
  (id, player_id, package_id, status, amount, created_at, payment_method, paid) values
  ('pu_dcb_a', 'pl_dcb_p1', 'pk_dcb', 'succeeded', 200000, now(), 'instapay', true),
  ('pu_dcb_b', 'pl_dcb_p1', 'pk_dcb', 'succeeded', 200000, now(), 'instapay', true);

insert into public.credit_requests
  (id, player_id, package_id, payment_method, proof_path, status, created_at, resolved_at, resolved_by, purchase_id) values
  ('cr_dcb_a', 'pl_dcb_p1', 'pk_dcb', 'instapay', null, 'approved', now(), now(), 'ad_dcb', 'pu_dcb_a');

insert into public.credit_batches
  (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at, note, location_id) values
  ('cb_dcb_a', 'pl_dcb_p1', 'purchase',    'pu_dcb_a', 'group', 4, 4, now() + interval '30 days', now(), null, 'loc_oro_plaza'),
  ('cb_dcb_b', 'pl_dcb_p1', 'purchase',    'pu_dcb_b', 'group', 4, 4, now() + interval '30 days', now(), null, 'loc_oro_plaza'),
  ('cb_dcb_c', 'pl_dcb_p1', 'admin_grant', null,       'group', 2, 2, now() + interval '30 days', now(), 'comp', 'loc_oro_plaza'),
  ('cb_dcb_d', 'pl_dcb_p1', 'admin_grant', null,       'duo',   1, 1, now() + interval '30 days', now(), 'keep me', 'loc_oro_plaza');

insert into public.session_slots
  (id, coach_id, template_id, starts_at, ends_at, training_type, capacity, gender, level, status) values
  ('ss_dcb', 'co_dcb', null, now() + interval '2 days', now() + interval '2 days 1 hour',
   'group', 4, 'men', 'beginner', 'published');

-- B's batch has been spent against. The credit was REFUNDED (the booking is
-- cancelled), so quantity_remaining is back at its total — the exact case that
-- would look "untouched" to anything that only compared the two numbers.
insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at, cancelled_at, location_id) values
  ('bk_dcb', 'ss_dcb', 'pl_dcb_p1', 'cb_dcb_b', 'cancelled', now(), now(), 'loc_oro_plaza');

-- Each call's answer, recorded once. Created and granted as postgres, because
-- `authenticated` holds no TEMP privilege of its own.
create temporary table dcb_res (tag text primary key, r jsonb);
grant insert on dcb_res to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- Shape
-- ════════════════════════════════════════════════════════════════════════════
select has_function('public', 'delete_credit_batch', array['text'],
  'delete_credit_batch(text) exists');
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'delete_credit_batch'),
  true, 'it is SECURITY DEFINER — there is no admin DELETE policy on the money tables');
select ok(
  not has_function_privilege('anon', 'public.delete_credit_batch(text)', 'execute'),
  'anon cannot execute it');
select ok(
  has_function_privilege('authenticated', 'public.delete_credit_batch(text)', 'execute'),
  'authenticated can execute it — the is_admin() gate in the body is the authority');

-- ════════════════════════════════════════════════════════════════════════════
-- A non-admin is refused, and changes nothing
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"0d0d0d02-0000-0000-0000-00000000d002"}';
insert into dcb_res values ('player', public.delete_credit_batch('cb_dcb_a'));
reset role;

select is((select r ->> 'reason' from dcb_res where tag = 'player'), 'not_admin',
  'an ordinary player gets not_admin');
select is((select count(*) from public.credit_batches where id = 'cb_dcb_a'), 1::bigint,
  'the batch a non-admin tried to delete is still there');

-- ════════════════════════════════════════════════════════════════════════════
-- Admin — every call made once, in order
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local request.jwt.claims = '{"sub":"0d0d0d01-0000-0000-0000-00000000d001"}';
insert into dcb_res values
  ('missing', public.delete_credit_batch('cb_nope')),    -- no such batch
  ('booked',  public.delete_credit_batch('cb_dcb_b')),   -- refused: has a booking
  ('chain',   public.delete_credit_batch('cb_dcb_a')),   -- the full three-row chain
  ('again',   public.delete_credit_batch('cb_dcb_a')),   -- the same call, repeated
  ('grant',   public.delete_credit_batch('cb_dcb_c'));   -- a comp, no purchase
reset role;

-- the refusals
select is((select r ->> 'reason' from dcb_res where tag = 'missing'), 'batch_missing',
  'a batch id that does not exist is batch_missing, not a crash');
select is((select r ->> 'reason' from dcb_res where tag = 'booked'), 'batch_has_bookings',
  'a batch with a booking against it is refused');
select is((select r ->> 'bookings' from dcb_res where tag = 'booked'), '1',
  'the refusal names how many bookings are in the way');

-- the full chain
select is((select r ->> 'ok' from dcb_res where tag = 'chain'), 'true',
  'the purchase-backed batch deletes');
select is((select r ->> 'deleted_requests' from dcb_res where tag = 'chain'), '1',
  'it reports the credit request it took with it');
select is((select r ->> 'deleted_purchases' from dcb_res where tag = 'chain'), '1',
  'it reports the purchase it took with it');
select is((select r ->> 'reason' from dcb_res where tag = 'again'), 'batch_missing',
  'repeating the call is batch_missing — a double-click deletes nothing twice');

-- the comp grant
select is((select r ->> 'ok' from dcb_res where tag = 'grant'), 'true',
  'an admin_grant with no purchase behind it deletes');
select is((select r ->> 'deleted_purchases' from dcb_res where tag = 'grant'), '0',
  'a grant reports no purchase deleted, because it never had one');
select is((select r ->> 'deleted_requests' from dcb_res where tag = 'grant'), '0',
  'a grant reports no request deleted either');

-- ════════════════════════════════════════════════════════════════════════════
-- What actually came out of the tables
-- ════════════════════════════════════════════════════════════════════════════
select is((select count(*) from public.credit_batches where id = 'cb_dcb_a'), 0::bigint,
  'the batch row is gone');
select is((select count(*) from public.purchases where id = 'pu_dcb_a'), 0::bigint,
  'its purchase is gone');
select is((select count(*) from public.credit_requests where id = 'cr_dcb_a'), 0::bigint,
  'its credit request is gone');
select is((select count(*) from public.credit_batches where id = 'cb_dcb_c'), 0::bigint,
  'the comp grant is gone');

-- ════════════════════════════════════════════════════════════════════════════
-- And what did NOT come out
-- ════════════════════════════════════════════════════════════════════════════
select is((select count(*) from public.credit_batches where id = 'cb_dcb_b'), 1::bigint,
  'the booked-against batch survives the refusal');
select is((select count(*) from public.purchases where id = 'pu_dcb_b'), 1::bigint,
  'so does its purchase — a refused delete removes nothing at all');
select is((select count(*) from public.bookings where id = 'bk_dcb'), 1::bigint,
  'the booking is untouched — attendance history is never collateral');
select is((select count(*) from public.credit_batches where id = 'cb_dcb_d'), 1::bigint,
  'the control grant, which nothing ever called on, is still there');
select is((select count(*) from public.packages where id = 'pk_dcb'), 1::bigint,
  'the package is not touched');
select is((select count(*) from public.players where id = 'pl_dcb_p1'), 1::bigint,
  'the player is not touched');

-- ════════════════════════════════════════════════════════════════════════════
-- The wallet the player would now see
-- ════════════════════════════════════════════════════════════════════════════
select is((select count(*) from public.credit_batches where player_id = 'pl_dcb_p1'), 2::bigint,
  'two batches remain: the refused one and the control');
select is((select sum(quantity_remaining) from public.credit_batches where player_id = 'pl_dcb_p1'), 5::bigint,
  'the wallet total is exactly the two survivors — 4 + 1');

select * from finish();
rollback;
