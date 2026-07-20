-- ============================================================================
-- delete_account (S6.x) — in-app account deletion is ANONYMISE, not destroy.
-- Proves: the RPC anonymises ONLY the caller (resolved via auth.uid(), no argument
-- path to another player); future bookings cancel and their seats free; past
-- bookings, purchases (incl. a pending one) and credits survive; credits are
-- abandoned (NOT refunded); auth_user_id ends null; it's idempotent; and it leaves
-- the auth.users delete to the Edge Function (the row is still here after the RPC).
--
-- Run with:  supabase test db
-- ============================================================================
begin;
select plan(21);

-- ── seed as postgres ─────────────────────────────────────────────────────────
insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),   -- pl_del (the account being deleted)
  ('22222222-2222-2222-2222-222222222222');   -- pl_keep (a bystander — must be untouched)

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_del',  '+201000000010', 'Deleteme', 'men', 'beginner', now(), '11111111-1111-1111-1111-111111111111'),
  ('pl_keep', '+201000000011', 'Keepme',   'men', 'beginner', now(), '22222222-2222-2222-2222-222222222222');

-- Two coaches: the coach_no_overlap exclusion constraint forbids one coach in two
-- slots at the same time, so the two concurrent future slots need distinct coaches.
insert into public.coaches (id, name, bio, is_active) values ('co_d','C','b',true), ('co_e','D','b',true);

insert into public.packages (id, training_type, session_count, price, name, is_active) values
  ('pk_i4','individual',4,600000,'Individual 4',true);

-- individual slots (no gender/level). booked_count seeded to match the bookings.
insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status) values
  ('sl_fut_del',  'co_d', now()+interval '2 day', now()+interval '2 day 1 hour', 'individual', 4, 1, null, null, 'published'),
  ('sl_fut_keep', 'co_e', now()+interval '2 day', now()+interval '2 day 1 hour', 'individual', 4, 1, null, null, 'published'),
  ('sl_past_del', 'co_d', now()-interval '2 day', now()-interval '2 day' + interval '1 hour', 'individual', 4, 1, null, null, 'published');

insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at) values
  ('cb_del',  'pl_del',  'signup_grant', null, 'individual', 4, 2, now()+interval '30 day', now()),
  ('cb_keep', 'pl_keep', 'signup_grant', null, 'individual', 2, 1, now()+interval '30 day', now());

insert into public.purchases (id, player_id, package_id, status, amount, created_at, payment_method) values
  ('pu_del',  'pl_del', 'pk_i4', 'succeeded', 600000, now(), 'paymob'),
  ('pu_pend', 'pl_del', 'pk_i4', 'pending',   600000, now(), 'paymob');  -- an abandoned pending

insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at) values
  ('bk_fd', 'sl_fut_del',  'pl_del',  'cb_del',  'booked', now()),   -- future → cancels, frees seat
  ('bk_fk', 'sl_fut_keep', 'pl_keep', 'cb_keep', 'booked', now()),   -- bystander → untouched
  ('bk_pd', 'sl_past_del', 'pl_del',  'cb_del',  'booked', now());   -- past → stays as history

-- ── an authenticated caller with NO player (sub absent) → not_authenticated ──
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select is(public.delete_account()->>'reason', 'not_authenticated', 'no auth.uid() → not_authenticated');
reset role;

-- ── anon may not execute it at all (privilege layer) ──
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select public.delete_account() $$, '42501', null, 'anon → delete_account DENIED at the privilege layer (42501)');
reset role;

-- ── delete pl_del's account (as pl_del) ──
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select is(public.delete_account()->>'already_deleted', 'false', 'first delete → anonymises (already_deleted=false)');
select is(public.delete_account()->>'already_deleted', 'true',  'idempotent → second delete is a no-op (already_deleted=true)');
reset role;

-- ── the anonymised tombstone (assert as postgres — RLS would now hide pl_del) ──
select is((select name from public.players where id='pl_del'), 'Deleted player', 'name stripped → "Deleted player"');
select is((select phone from public.players where id='pl_del'), 'deleted:pl_del', 'phone → unique non-PII sentinel');
select isnt((select deleted_at from public.players where id='pl_del'), null, 'deleted_at is set');
select is((select auth_user_id from public.players where id='pl_del'), null, 'auth_user_id nulled (RESTRICT satisfied)');

-- ── future booking cancelled, seat freed ──
select is((select booked_count from public.session_slots where id='sl_fut_del'), 0, 'future session seat freed (booked_count 1→0)');
select is((select status from public.bookings where id='bk_fd'), 'cancelled', 'future booking cancelled');
select isnt((select cancelled_at from public.bookings where id='bk_fd'), null, 'cancelled booking has cancelled_at');

-- ── past booking untouched (history) ──
select is((select booked_count from public.session_slots where id='sl_past_del'), 1, 'past session seat untouched');
select is((select status from public.bookings where id='bk_pd'), 'booked', 'past booking left as history');

-- ── the bystander is completely untouched (caller-only guarantee) ──
select is((select name from public.players where id='pl_keep'), 'Keepme', 'another player is NOT anonymised');
select isnt((select auth_user_id from public.players where id='pl_keep'), null, 'another player keeps their auth link');
select is((select booked_count from public.session_slots where id='sl_fut_keep'), 1, 'another player keeps their seat');
select is((select status from public.bookings where id='bk_fk'), 'booked', 'another player keeps their booking');

-- ── financial records survive, attributed to the tombstone ──
select is((select status from public.purchases where id='pu_del'), 'succeeded', 'succeeded purchase survives');
select is((select status from public.purchases where id='pu_pend'), 'pending', 'pending (abandoned) purchase survives as history');
select is((select quantity_remaining from public.credit_batches where id='cb_del'), 2, 'credits abandoned, NOT refunded (unchanged)');

-- ── the RPC leaves the auth.users delete to the Edge Function ──
select is((select count(*)::int from auth.users where id='11111111-1111-1111-1111-111111111111'), 1, 'auth user still present — RPC detaches, Edge Function deletes');

select * from finish();
rollback;
