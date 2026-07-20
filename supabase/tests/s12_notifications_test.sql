-- ============================================================================
-- S12 — notifications: emit-on-event + RLS + token policies.
-- Proves: each event RPC mints the right row(s) via tpa.notify; the confirmation
-- transition emits exactly once (fill → others; manual → all, but not when already
-- full); a player reads only their own and may write only read_at; NOBODY can INSERT
-- a notification; device-token policies are own-only.
--
-- Run with:  supabase test db
-- ============================================================================
begin;
select plan(31);

-- ── seed as postgres ─────────────────────────────────────────────────────────
insert into auth.users (id) values
  ('ffffffff-ffff-ffff-ffff-ffffffffffff'),   -- pl_adm
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),   -- pl_1
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),   -- pl_2
  ('cccccccc-cccc-cccc-cccc-cccccccccccc');   -- pl_3

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id, is_admin) values
  ('pl_adm','+201000000090','Adm','men','beginner',now(),'ffffffff-ffff-ffff-ffff-ffffffffffff', true),
  ('pl_1',  '+201000000091','P1', 'men','beginner',now(),'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false),
  ('pl_2',  '+201000000092','P2', 'men','beginner',now(),'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false),
  ('pl_3',  '+201000000093','P3', 'men','beginner',now(),'cccccccc-cccc-cccc-cccc-cccccccccccc', false);

insert into public.coaches (id,name,bio,is_active) values ('co_n','C','b',true);

-- Dedicated slot per scenario (co_n at distinct times → no overlap constraint hit).
insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status) values
  ('sl_fill',  'co_n', now()+interval '2 day', now()+interval '2 day 1 hour', 'group', 2, 1, 'men','beginner','published'),
  ('sl_ind',   'co_n', now()+interval '3 day', now()+interval '3 day 1 hour', 'individual', 1, 0, null,null,'published'),
  ('sl_cancel','co_n', now()+interval '4 day', now()+interval '4 day 1 hour', 'group', 4, 2, 'men','beginner','published'),
  ('sl_rmf',   'co_n', now()+interval '5 day', now()+interval '5 day 1 hour', 'group', 4, 2, 'men','beginner','published'),
  ('sl_res',   'co_n', now()+interval '6 day', now()+interval '6 day 1 hour', 'group', 4, 1, 'men','beginner','published'),
  ('sl_conf',  'co_n', now()+interval '7 day', now()+interval '7 day 1 hour', 'group', 4, 2, 'men','beginner','published'),
  ('sl_fullc', 'co_n', now()+interval '8 day', now()+interval '8 day 1 hour', 'group', 2, 2, 'men','beginner','published');

insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at) values
  ('cb_1', 'pl_1','signup_grant',null,'group',      20,10,now()+interval '30 day',now()),
  ('cb_2', 'pl_2','signup_grant',null,'group',      20,10,now()+interval '30 day',now()),
  ('cb_3i','pl_3','signup_grant',null,'individual',  5, 5,now()+interval '30 day',now());

insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at) values
  ('bk_fill_1','sl_fill',  'pl_1','cb_1','booked',now()),
  ('bk_can_1', 'sl_cancel','pl_1','cb_1','booked',now()),
  ('bk_can_2', 'sl_cancel','pl_2','cb_2','booked',now()),
  ('bk_rmf_1', 'sl_rmf',   'pl_1','cb_1','booked',now()),
  ('bk_rmf_2', 'sl_rmf',   'pl_2','cb_2','booked',now()),
  ('bk_res_1', 'sl_res',   'pl_1','cb_1','booked',now()),
  ('bk_conf_1','sl_conf',  'pl_1','cb_1','booked',now()),
  ('bk_conf_2','sl_conf',  'pl_2','cb_2','booked',now()),
  ('bk_flc_1', 'sl_fullc', 'pl_1','cb_1','booked',now()),
  ('bk_flc_2', 'sl_fullc', 'pl_2','cb_2','booked',now());

-- ════════════════════════════════════════════════════════════════════════════
-- A) book_slot fill → session_confirmed to the OTHER bookings, not the booker.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}',true);
select is(public.book_slot('sl_fill')->>'ok','true','pl_2 books sl_fill (2/2 → fills)');
reset role;
select is((select count(*)::int from public.notifications where slot_id='sl_fill' and type='session_confirmed'), 1, 'fill emits session_confirmed to exactly ONE other booking');
select is((select player_id from public.notifications where slot_id='sl_fill' and type='session_confirmed'), 'pl_1', '…to pl_1 (the already-booked player)');
select is((select count(*)::int from public.notifications where slot_id='sl_fill' and player_id='pl_2'), 0, 'the booker gets NO row (in-app success screen covers them)');

-- B) individual cap-1 fill → booker is the only booking, so ZERO session_confirmed.
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}',true);
select is(public.book_slot('sl_ind')->>'ok','true','pl_3 books sl_ind (1/1 → fills)');
reset role;
select is((select count(*)::int from public.notifications where slot_id='sl_ind'), 0, 'individual fill emits nothing (no other bookings, booker excluded)');

-- ════════════════════════════════════════════════════════════════════════════
-- AS ADMIN — cancel / remove / grant / reschedule / confirm
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"ffffffff-ffff-ffff-ffff-ffffffffffff","role":"authenticated"}',true);

-- C) cancel_session → session_cancelled to EVERY booked player.
select is(public.cancel_session('sl_cancel')->>'ok','true','cancel_session ok');
select is((select count(*)::int from public.notifications where slot_id='sl_cancel' and type='session_cancelled'), 2, 'cancel emits to both booked players');
select is((select bool_and(body like '%cancelled and your credit refunded.%') from public.notifications where slot_id='sl_cancel'), true, 'cancel copy states the refund');

-- D) remove_booking → removed_from_session with the refund/forfeit truth.
select is(public.remove_booking('bk_rmf_1', true)->>'ok','true','remove_booking (refund) ok');
select is(public.remove_booking('bk_rmf_2', false)->>'ok','true','remove_booking (forfeit) ok');
select is((select body from public.notifications where type='removed_from_session' and player_id='pl_1') like '%was refunded.%', true, 'refunded removal says "was refunded"');
select is((select body from public.notifications where type='removed_from_session' and player_id='pl_2') like '%was not refunded.%', true, 'forfeited removal says "was not refunded"');

-- E) grant_credits → credits_granted.
select is(public.grant_credits('pl_3','group',3,'Rained out')->>'ok','true','grant_credits ok');
select is((select body from public.notifications where type='credits_granted' and player_id='pl_3'), 'You received 3 Group credits.', 'grant copy names count + type');
select is(public.grant_credits('pl_3','individual',1,'One more')->>'ok','true','grant_credits (1) ok');
select is((select count(*)::int from public.notifications where type='credits_granted' and player_id='pl_3' and body='You received 1 Individual credit.'), 1, 'singular "credit" for a quantity of 1');

-- F) reschedule_session → session_rescheduled only when the START moves.
select is(public.reschedule_session('sl_res','co_n',4, now()+interval '6 day 2 hour', now()+interval '6 day 3 hour')->>'moved','true','reschedule that moves the start → moved=true');
select is((select count(*)::int from public.notifications where slot_id='sl_res' and type='session_rescheduled'), 1, 'moved reschedule emits to the booked player');
select is((select body from public.notifications where slot_id='sl_res' and type='session_rescheduled') like '%moved to %', true, 'reschedule copy names the new time');
-- Same start (capacity-only edit) → NO new notification.
select is(public.reschedule_session('sl_res','co_n',3, now()+interval '6 day 2 hour', now()+interval '6 day 3 hour')->>'moved','false','edit that keeps the start → moved=false');
select is((select count(*)::int from public.notifications where slot_id='sl_res' and type='session_rescheduled'), 1, 'a non-moving edit emits nothing new');

-- G) confirm_session — the OTHER confirmation path, exactly once.
select is(public.confirm_session('sl_conf')->>'already_confirmed','false','confirm a pending slot (2/4) → confirms');
select is((select count(*)::int from public.notifications where slot_id='sl_conf' and type='session_confirmed'), 2, 'manual confirm of a pending slot emits to ALL booked players');
select is(public.confirm_session('sl_conf')->>'already_confirmed','true','re-confirm is idempotent');
select is((select count(*)::int from public.notifications where slot_id='sl_conf' and type='session_confirmed'), 2, '…and emits nothing the second time');
-- An already-FULL slot: confirm_session sets the sticky flag but does NOT re-announce
-- (its players were notified when it filled).
select is(public.confirm_session('sl_fullc')->>'already_confirmed','false','confirm an already-full slot sets the sticky flag');
select is((select count(*)::int from public.notifications where slot_id='sl_fullc' and type='session_confirmed'), 0, 'a full slot is NOT announced again by manual confirm');

reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- RLS — read own, write read_at only, NOBODY inserts; tokens own-only.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}',true);  -- pl_1

-- read own: pl_1 sees only pl_1's rows (they were notified by cancel + fill).
select ok((select count(*) from public.notifications) > 0, 'pl_1 sees their own notifications');
select is((select count(*)::int from public.notifications where player_id <> 'pl_1'), 0, 'pl_1 sees ONLY their own (RLS)');
-- update read_at (own) is allowed; rewriting body is denied at the privilege layer.
select lives_ok($$ update public.notifications set read_at = now() where player_id='pl_1' $$, 'pl_1 may set read_at on their own');
select throws_ok($$ update public.notifications set body='forged' where player_id='pl_1' $$, '42501', null, 'pl_1 may NOT rewrite body (column privilege)');
-- nobody inserts.
select throws_ok($$ insert into public.notifications (id,player_id,type,title,body,created_at) values ('nt_x','pl_1','credits_granted','x','You received 100 credits',now()) $$, '42501', null, 'a player cannot forge a notification (no INSERT grant)');

-- device tokens: own-only.
select lives_ok($$ insert into public.device_push_tokens (id,player_id,expo_push_token,platform,created_at,last_seen_at) values ('dpt_1','pl_1','ExponentPushToken[aaa]','android',now(),now()) $$, 'pl_1 registers their own token');
select throws_ok($$ insert into public.device_push_tokens (id,player_id,expo_push_token,platform,created_at,last_seen_at) values ('dpt_2','pl_2','ExponentPushToken[bbb]','android',now(),now()) $$, '42501', null, 'pl_1 cannot register a token for pl_2');

reset role;

select * from finish();
rollback;
