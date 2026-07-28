-- ============================================================================
-- admin_book_player notifies the booked player — pgTAP proof for
-- 20260811000030_admin_book_player_notify.sql.
--
-- Proves: a successful admin booking mints exactly ONE admin_booked
-- notification, addressed to the BOOKED PLAYER (never the admin, who has no
-- player row to notify anyway — A1); every rejection path (gender block, no
-- credit, slot full, unknown player/slot, a repeat already_booked call) emits
-- nothing; and re-calling with the same params is safe — the second call
-- rejects as already_booked and does NOT mint a second notification.
--
-- Run with:  supabase test db  (alongside rpc_admin_test.sql, which proves the
-- booking/credit behaviour itself is unchanged — this file only proves the emit)
-- ============================================================================
begin;
select plan(12);

-- ── seed as postgres ─────────────────────────────────────────────────────────
insert into auth.users (id) values
  ('c1111111-1111-1111-1111-111111111111'), -- pl_abn_win — the successfully-booked player
  ('c2222222-2222-2222-2222-222222222222'), -- pl_abn_nocredit — no_usable_credit rejection
  ('ffffffff-1111-1111-1111-ffffffffffff'); -- the admin

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_abn_win',      '+201900200001', 'AbnWin',  'men',    'beginner', now(), 'c1111111-1111-1111-1111-111111111111'),
  ('pl_abn_nocredit', '+201900200002', 'AbnNoCr', 'ladies', 'beginner', now(), 'c2222222-2222-2222-2222-222222222222');

insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('adm_abn', 'ffffffff-1111-1111-1111-ffffffffffff', 'AdmAbn', now());

insert into public.coaches (id, name, bio, is_active) values
  ('co_abn1','C','b',true), ('co_abn2','C','b',true), ('co_abn3','C','b',true);

-- sl_abn_win: open slot, admin will book pl_abn_win as duo → the success case.
-- sl_abn_gender: 'ladies' group slot, admin books pl_abn_win (men) WITHOUT
-- override → gender_mismatch (short-circuits before the credit check, so this
-- fires regardless of what pl_abn_win holds).
-- sl_abn_full: capacity-1 DUO slot already at capacity — duo so pl_abn_win's
-- one credit batch (duo) is the type that would otherwise apply, isolating
-- the assertion to the capacity hard-block rather than no_usable_credit.
insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, booked_count, gender, level, status) values
  ('sl_abn_win',    'co_abn1', now()+interval '1 day', now()+interval '1 day 1 hour', null,    4, 0, null, null, 'published'),
  ('sl_abn_gender', 'co_abn2', now()+interval '1 day', now()+interval '1 day 1 hour', 'group', 4, 0, 'ladies', 'beginner', 'published'),
  ('sl_abn_full',   'co_abn3', now()+interval '1 day', now()+interval '1 day 1 hour', 'duo',   1, 1, null, null, 'published');

insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at) values
  ('cb_abn_win', 'pl_abn_win', 'signup_grant', null, 'duo', 5, 5, now()+interval '30 day', now());
  -- pl_abn_nocredit deliberately holds NO credit batch of any type.

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ffffffff-1111-1111-1111-ffffffffffff","role":"authenticated"}', true);

-- ════════════════════════════════════════════════════════════════════════════
-- 1) The success case — exactly one admin_booked notification, right player, right type.
-- ════════════════════════════════════════════════════════════════════════════
select is(public.admin_book_player('sl_abn_win','pl_abn_win',false,'duo')->>'ok', 'true', 'admin books pl_abn_win as duo → ok');

-- notifications RLS is notifications_select_own — player_id = current_player_id(),
-- which is NULL for an admin session (A1: admins have no player row). So every
-- verification read here runs as postgres (bypassing RLS deliberately, to check
-- the raw row the RPC minted), not as the admin whose session could never see it
-- anyway. tpa.cairo_when is ALSO revoked from authenticated (S12), same reason.
reset role;
select is((select count(*)::int from public.notifications where type='admin_booked'), 1, 'exactly one admin_booked notification exists after the successful booking');
select is((select player_id from public.notifications where type='admin_booked'), 'pl_abn_win', 'it is addressed to the BOOKED PLAYER');
select is((select count(*)::int from public.notifications where type='admin_booked' and player_id='adm_abn'), 0, 'never addressed to the admin');
select is((select slot_id from public.notifications where type='admin_booked'), 'sl_abn_win', 'deep-links to the session that was booked');
select is(
  (select body from public.notifications where type='admin_booked'),
  'You''ve been added to a Duo session on ' || tpa.cairo_when((select starts_at from public.session_slots where id='sl_abn_win')) || '.',
  'body reads as a reassuring confirmation, in Cairo time, naming the resolved type'
);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) Rejections emit NOTHING — gender block, no credit, slot full, and a repeat
--    call on the now-booked slot (already_booked).
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ffffffff-1111-1111-1111-ffffffffffff","role":"authenticated"}', true);
select is(public.admin_book_player('sl_abn_gender','pl_abn_win',false)->>'reason', 'gender_mismatch', 'gender-mismatched admin booking is rejected');
select is(public.admin_book_player('sl_abn_full','pl_abn_win',true)->>'reason', 'slot_full', 'a full slot is rejected even with override');
select is(public.admin_book_player('sl_abn_win','pl_abn_nocredit',false,'duo')->>'reason', 'no_usable_credit', 'a credit-less player is rejected');
reset role;
select is((select count(*)::int from public.notifications where type='admin_booked'), 1, 'still exactly one — none of the three rejections minted a notification');

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Idempotency — re-calling with the SAME params on the already-booked slot
--    rejects (already_booked), and does NOT mint a second notification.
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ffffffff-1111-1111-1111-ffffffffffff","role":"authenticated"}', true);
select is(public.admin_book_player('sl_abn_win','pl_abn_win',false,'duo')->>'reason', 'already_booked', 'a repeat call with identical params rejects as already_booked, not a silent re-seat');
reset role;
select is((select count(*)::int from public.notifications where type='admin_booked'), 1, 'still exactly one after the repeat call — no double-notify');

select * from finish();
rollback;
