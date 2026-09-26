-- ============================================================================
-- Coach mode phase 2 — hours self-read, the roster RPC, and the coach-can't-buy
-- guard (pgTAP).
--
-- The three claims under test are all NEGATIVE ones, which is why they are worth
-- writing down: a coach sees their OWN hours and no one else's; the roster hands
-- back two columns and never a player's contact details; and a coach account
-- cannot reach ANY of the three paths that end in credits — including the direct
-- Paymob INSERT, which is not an RPC and would have been missed by guarding
-- functions alone.
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(32);

insert into auth.users (id) values
  ('0d0d0d01-0000-0000-0000-00000000d001'),   -- coach A (linked)
  ('0d0d0d02-0000-0000-0000-00000000d002'),   -- coach B (linked)
  ('0d0d0d03-0000-0000-0000-00000000d003'),   -- an ordinary player, booked on A's session
  ('0d0d0d04-0000-0000-0000-00000000d004'),   -- an admin
  ('0d0d0d05-0000-0000-0000-00000000d005');   -- a second ordinary player (cancelled booking)

insert into public.coaches (id, name, bio, is_active) values
  ('co_da', 'Coach Ay', 'b', true),
  ('co_db', 'Coach Bee', 'b', true);

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id, email, coach_id) values
  ('pl_da',   '+201900020001', 'Ay Coach',   'men',   'beginner',     now(), '0d0d0d01-0000-0000-0000-00000000d001', 'ay@x.eg',   'co_da'),
  ('pl_db',   '+201900020002', 'Bee Coach',  'men',   'beginner',     now(), '0d0d0d02-0000-0000-0000-00000000d002', 'bee@x.eg',  'co_db'),
  ('pl_stud', '+201900020003', 'Zara Player','ladies', 'intermediate', now(), '0d0d0d03-0000-0000-0000-00000000d003', 'zara@x.eg', null),
  ('pl_quit2','+201900020005', 'Gone Player','men',   'beginner',     now(), '0d0d0d05-0000-0000-0000-00000000d005', 'gone@x.eg', null);

insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('ad_da', '0d0d0d04-0000-0000-0000-00000000d004', 'Admin', now());

insert into public.packages (id, training_type, session_count, price, name, is_active) values
  ('pk_da', 'group', 4, 140000, '4-pack', true);

-- Two FINISHED sessions this Cairo month, one per coach, each with an attended
-- booking so both qualify for coach_hours_coached. A's runs 2h, B's runs 1h, so the
-- two coaches' numbers can never be confused for each other.
insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status) values
  ('sl_da_done', 'co_da', now() - interval '3 hours', now() - interval '1 hour',  'group', 4, 2, 'men', 'beginner', 'published'),
  ('sl_db_done', 'co_db', now() - interval '3 hours', now() - interval '2 hours', 'group', 4, 1, 'men', 'beginner', 'published'),
  -- A future session of A's, for the roster reads.
  ('sl_da_next', 'co_da', now() + interval '2 days', now() + interval '2 days 1 hour', 'group', 4, 2, 'ladies', 'intermediate', 'published'),
  ('sl_db_next', 'co_db', now() + interval '2 days', now() + interval '2 days 1 hour', 'group', 4, 0, 'men', 'beginner', 'published');

insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at, location_id) values
  ('cb_stud', 'pl_stud',  'signup_grant', null, 'group', 9, 9, now()+interval '30 day', now(), 'loc_oro_plaza'),
  ('cb_quit2','pl_quit2', 'signup_grant', null, 'group', 9, 9, now()+interval '30 day', now(), 'loc_oro_plaza'),
  ('cb_da',   'pl_da',    'admin_grant',  null, 'group', 9, 9, now()+interval '30 day', now(), 'loc_oro_plaza');

insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at, cancelled_at, location_id) values
  ('bk_da_done1', 'sl_da_done', 'pl_stud',  'cb_stud',  'attended', now(), null, 'loc_oro_plaza'),
  ('bk_db_done1', 'sl_db_done', 'pl_stud',  'cb_stud',  'attended', now(), null, 'loc_oro_plaza'),
  ('bk_da_next1', 'sl_da_next', 'pl_stud',  'cb_stud',  'booked',   now(), null, 'loc_oro_plaza'),
  ('bk_da_next2', 'sl_da_next', 'pl_quit2', 'cb_quit2', 'cancelled',now(), now(), 'loc_oro_plaza');

-- ════════════════════════════════════════════════════════════════════════════
-- 1. HOURS — self-read only
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0d0d0d01-0000-0000-0000-00000000d001","role":"authenticated"}', true);
select is((select count(*)::int from public.coach_hours_coached()), 1,
  'a coach gets exactly ONE row from coach_hours_coached — their own');
select is((select coach_id from public.coach_hours_coached()), 'co_da', '…and it is their own coach id');
select is((select hours from public.coach_hours_coached()), 2::numeric, '…with their own hours (2h), not anyone else''s');
select is((select count(*)::int from public.coach_hours_coached() where coach_id = 'co_db'), 0,
  'a coach can NEVER see another coach''s hours');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0d0d0d02-0000-0000-0000-00000000d002","role":"authenticated"}', true);
select is((select coach_id from public.coach_hours_coached()), 'co_db', 'the other coach symmetrically sees only theirs');
select is((select hours from public.coach_hours_coached()), 1::numeric, '…with their own 1h');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0d0d0d03-0000-0000-0000-00000000d003","role":"authenticated"}', true);
select is((select count(*)::int from public.coach_hours_coached()), 0,
  'an ordinary player gets NOTHING — current_coach_id() is null, so the join matches nothing');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0d0d0d04-0000-0000-0000-00000000d004","role":"authenticated"}', true);
select is((select count(*)::int from public.coach_hours_coached()), 2,
  'an ADMIN still sees every coach — the widening did not narrow the admin view');
select is((select hours from public.coach_hours_coached() where coach_id = 'co_da'), 2::numeric,
  'and the admin''s numbers are unchanged');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. ROSTER — own slot, two columns, cancelled excluded
-- ════════════════════════════════════════════════════════════════════════════
select is(
  (select array_agg(a.attname::text order by a.attnum)
     from pg_proc p
     join unnest(p.proargnames, p.proargmodes) with ordinality t(nm, md, ord) on true
     join lateral (select t.nm as attname, t.ord as attnum) a on true
    where p.proname = 'coach_session_roster' and t.md = 't'),
  array['name','level'],
  'the RPC returns EXACTLY (name, level) — no email, phone, gender or auth_user_id can leak through it');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0d0d0d01-0000-0000-0000-00000000d001","role":"authenticated"}', true);
select is((select count(*)::int from public.coach_session_roster('sl_da_next')), 1,
  'a coach sees the roster of their OWN session');
select is((select name from public.coach_session_roster('sl_da_next')), 'Zara Player', '…the booked player''s name');
select is((select level from public.coach_session_roster('sl_da_next')), 'intermediate', '…and their level');
select is((select count(*)::int from public.coach_session_roster('sl_da_next') where name = 'Gone Player'), 0,
  'a CANCELLED booking is not on the roster');
select is((select count(*)::int from public.coach_session_roster('sl_db_next')), 0,
  'a coach asking for ANOTHER coach''s session gets an empty roster, not an error');
select is((select count(*)::int from public.coach_session_roster('sl_nonexistent')), 0,
  'a slot that does not exist is the same empty answer — nothing to probe with');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0d0d0d03-0000-0000-0000-00000000d003","role":"authenticated"}', true);
select is((select count(*)::int from public.coach_session_roster('sl_da_next')), 0,
  'an ordinary player gets nothing, even for a session they are booked on themselves');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. THE GUARD — a coach cannot book or acquire credits
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0d0d0d01-0000-0000-0000-00000000d001","role":"authenticated"}', true);

select is(public.book_slot('sl_db_next', null)->>'reason', 'coach_cannot_book',
  'a COACH is refused from book_slot');
select is((select booked_count from public.session_slots where id = 'sl_db_next'), 0,
  '…no seat was taken');
select is((select count(*)::int from public.bookings where player_id = 'pl_da'), 0,
  '…no booking row was written');
select is((select quantity_remaining from public.credit_batches where id = 'cb_da'), 9,
  '…and no credit was spent');
select is((select count(*)::int from public.notifications), 0,
  '…and nothing was notified — the refusal is before every emit');

select is(public.request_credits('pk_da', 'instapay', null)->>'reason', 'coach_cannot_buy',
  'a COACH is refused from request_credits');
select is((select count(*)::int from public.credit_requests where player_id = 'pl_da'), 0,
  '…and no request row was written');

-- The path that is NOT an RPC: the direct Paymob checkout insert.
select throws_ok(
  $$ insert into public.purchases (id, player_id, package_id, status, payment_method, amount, created_at, gateway_order_id, gateway_transaction_id)
       values ('pu_coach', 'pl_da', 'pk_da', 'pending', 'paymob', 140000, now(), null, null) $$,
  '42501', null, 'a COACH cannot open a Paymob checkout either — the policy, not just the RPCs');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3b. an ordinary player is completely unaffected
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0d0d0d03-0000-0000-0000-00000000d003","role":"authenticated"}', true);
select is(public.book_slot('sl_db_next', null)->>'ok', 'true', 'an ordinary player still books normally');
select is((select booked_count from public.session_slots where id = 'sl_db_next'), 1, '…and the seat is taken');
select lives_ok(
  $$ insert into public.purchases (id, player_id, package_id, status, payment_method, amount, created_at, gateway_order_id, gateway_transaction_id)
       values ('pu_player', 'pl_stud', 'pk_da', 'pending', 'paymob', 140000, now(), null, null) $$,
  'an ordinary player still opens a Paymob checkout');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 3c. ADMIN actions on a coach are untouched — the guard is caller-is-coach
-- ════════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claims', '{"sub":"0d0d0d04-0000-0000-0000-00000000d004","role":"authenticated"}', true);
select is(public.grant_credits('pl_da', 'group', 2, 'comp for the coach')->>'ok', 'true',
  'an ADMIN can still grant credits to a coach — the guard is about the CALLER, not the subject');
select is(public.record_cash_purchase('pl_da', 'pk_da', 140000)->>'ok', 'true',
  'an ADMIN can still record a cash sale for a coach');
select is(public.admin_book_player('sl_db_next', 'pl_da', false, null)->>'ok', 'true',
  'an ADMIN can still book a coach into a session deliberately');
select is(public.set_player_coach('pl_stud', null)->>'ok', 'true',
  'and the phase-1 admin RPC is unaffected');

select * from finish();
rollback;
