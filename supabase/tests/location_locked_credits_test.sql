-- ============================================================================
-- Location-locked credits (pgTAP) — every client-triggered path as a real role.
--
-- What must hold: a credit pays only at its own branch; a forged
-- purchases.location_id is overwritten rather than trusted; one pending request
-- per branch but still one trial per player EVER; grants default and refuse a
-- closed branch; the composite FKs make a cross-branch booking unrepresentable;
-- and credit_wrong_location tells the player where THEIR credits are without
-- revealing anything about anyone else.
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(38);

insert into auth.users (id) values
  ('0c1c1c01-0000-0000-0000-0000000c1c01'),   -- admin
  ('0c1c1c02-0000-0000-0000-0000000c1c02'),   -- player
  ('0c1c1c03-0000-0000-0000-0000000c1c03');   -- another player

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_llc_adm', '+201900060001', 'Admin',  'men', 'beginner', now(), '0c1c1c01-0000-0000-0000-0000000c1c01'),
  ('pl_llc_p1',  '+201900060002', 'Player', 'men', 'beginner', now(), '0c1c1c02-0000-0000-0000-0000000c1c02'),
  ('pl_llc_p2',  '+201900060003', 'Other',  'men', 'beginner', now(), '0c1c1c03-0000-0000-0000-0000000c1c03');
insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('ad_llc', '0c1c1c01-0000-0000-0000-0000000c1c01', 'Admin', now());
insert into public.coaches (id, name, bio, is_active) values ('co_llc', 'Coach', 'b', true);

insert into public.locations (id, name, address, maps_url, hours_text, sort_order, is_active, is_default) values
  ('loc_llc_b',   'Branch B', 'x', 'https://a.b', 'h', 1, true,  false),
  ('loc_llc_shut','Closed',   'x', 'https://a.b', 'h', 2, false, false);

insert into public.packages (id, training_type, session_count, price, name, is_active, location_id) values
  ('pk_llc_def', 'group', 4, 100000, 'Def', true, 'loc_oro_plaza'),
  ('pk_llc_b',   'group', 4, 120000, 'B',   true, 'loc_llc_b');

insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, status, gender, level, location_id) values
  ('sl_llc_def', 'co_llc', now() + interval '2 days', now() + interval '2 days 1 hour', 'group', 4, 'published', 'men', 'beginner', 'loc_oro_plaza'),
  ('sl_llc_b',   'co_llc', now() + interval '3 days', now() + interval '3 days 1 hour', 'group', 4, 'published', 'men', 'beginner', 'loc_llc_b');

-- ════════════════════════════════════════════════════════════════════════════
-- Shape
-- ════════════════════════════════════════════════════════════════════════════
select col_not_null('public', 'credit_batches',  'location_id', 'credit_batches.location_id is NOT NULL');
select col_not_null('public', 'purchases',       'location_id', 'purchases.location_id is NOT NULL');
select col_not_null('public', 'credit_requests', 'location_id', 'credit_requests.location_id is NOT NULL');
select col_not_null('public', 'bookings',        'location_id', 'bookings.location_id is NOT NULL');
select has_index('public', 'credit_requests', 'credit_requests_one_pending_per_player_location',
  'the pending index is now per (player, location)');
select hasnt_index('public', 'credit_requests', 'credit_requests_one_pending_per_player',
  'the old per-player-only pending index is gone');
select has_index('public', 'credit_requests', 'credit_requests_one_trial_per_player',
  'the TRIAL index is unchanged — one free trial per player EVER, across all branches');

-- ════════════════════════════════════════════════════════════════════════════
-- purchases: a forged location is overwritten, not trusted  (AS THE PLAYER)
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0c1c1c02-0000-0000-0000-0000000c1c02"}', true);

select lives_ok(
  $$ insert into public.purchases (id, player_id, package_id, status, amount, created_at, payment_method, paid, location_id)
     values ('pu_llc_forge', 'pl_llc_p1', 'pk_llc_def', 'pending', 100000, now(), 'paymob', false, 'loc_llc_b') $$,
  'a client may SEND a location_id — the insert is not refused');
reset role;
select is((select location_id from public.purchases where id = 'pu_llc_forge'), 'loc_oro_plaza',
  'but it is OVERWRITTEN from the package — a forged branch cannot stick');

-- The legacy shape (no column at all) still works, which is the whole reason
-- this is a trigger and not a column default.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0c1c1c02-0000-0000-0000-0000000c1c02"}', true);
select lives_ok(
  $$ insert into public.purchases (id, player_id, package_id, status, amount, created_at, payment_method, paid)
     values ('pu_llc_legacy', 'pl_llc_p1', 'pk_llc_def', 'pending', 100000, now(), 'paymob', false) $$,
  'the 1.2/1.3 insert, which sends no location_id at all, still works');
reset role;
select is((select location_id from public.purchases where id = 'pu_llc_legacy'), 'loc_oro_plaza',
  'and lands at the package''s branch');

-- ════════════════════════════════════════════════════════════════════════════
-- credit_requests: derived, and one pending PER BRANCH
-- ════════════════════════════════════════════════════════════════════════════
insert into public.credit_requests (id, player_id, package_id, payment_method, status, created_at)
  values ('cr_llc_1', 'pl_llc_p1', 'pk_llc_def', 'instapay', 'pending', now());
select is((select location_id from public.credit_requests where id = 'cr_llc_1'), 'loc_oro_plaza',
  'a credit_request derives its branch from the package');

select lives_ok(
  $$ insert into public.credit_requests (id, player_id, package_id, payment_method, status, created_at)
     values ('cr_llc_2', 'pl_llc_p1', 'pk_llc_b', 'instapay', 'pending', now()) $$,
  'a SECOND pending request is allowed at a DIFFERENT branch');
select throws_ok(
  $$ insert into public.credit_requests (id, player_id, package_id, payment_method, status, created_at)
     values ('cr_llc_3', 'pl_llc_p1', 'pk_llc_def', 'instapay', 'pending', now()) $$,
  '23505', null, 'but a second pending request at the SAME branch is still refused');

-- ════════════════════════════════════════════════════════════════════════════
-- credit_batches + the composite FKs
-- ════════════════════════════════════════════════════════════════════════════
insert into public.credit_batches (id, player_id, source, purchase_id, training_type, quantity_total, quantity_remaining, expires_at, created_at, location_id) values
  ('cb_llc_def', 'pl_llc_p1', 'admin_grant', null, 'group', 2, 2, now() + interval '30 days', now(), 'loc_oro_plaza'),
  -- Owned by the OTHER player on purpose: p1 must hold nothing at Branch B, or
  -- "book at B" would simply succeed and prove nothing. The composite-FK tests
  -- below do not care who owns the batch.
  ('cb_llc_b',   'pl_llc_p2', 'admin_grant', null, 'group', 2, 2, now() + interval '30 days', now(), 'loc_llc_b');

select throws_ok(
  $$ insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at, location_id)
     values ('bk_llc_x', 'sl_llc_def', 'pl_llc_p1', 'cb_llc_b', 'booked', now(), 'loc_oro_plaza') $$,
  '23503', null,
  'a booking whose CREDIT is at another branch is refused by the composite FK');
select throws_ok(
  $$ insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at, location_id)
     values ('bk_llc_y', 'sl_llc_def', 'pl_llc_p1', 'cb_llc_def', 'booked', now(), 'loc_llc_b') $$,
  '23503', null,
  'and one whose SLOT is at another branch is refused too');
select lives_ok(
  $$ insert into public.bookings (id, slot_id, player_id, credit_batch_id, status, booked_at, location_id)
     values ('bk_llc_ok', 'sl_llc_def', 'pl_llc_p1', 'cb_llc_def', 'booked', now(), 'loc_oro_plaza') $$,
  'a consistent booking inserts fine');
select throws_ok(
  $$ update public.credit_batches set location_id = 'loc_llc_b' where id = 'cb_llc_def' $$,
  'P0001', null, 'a credit batch cannot change branch');
select throws_ok(
  $$ update public.bookings set location_id = 'loc_llc_b' where id = 'bk_llc_ok' $$,
  'P0001', null, 'a booking cannot change branch');
delete from public.bookings where id = 'bk_llc_ok';

-- ════════════════════════════════════════════════════════════════════════════
-- book_slot: the money path, AS THE PLAYER
-- ════════════════════════════════════════════════════════════════════════════
create temporary table llc (tag text primary key, r jsonb);
grant insert on llc to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0c1c1c02-0000-0000-0000-0000000c1c02"}', true);
insert into llc values
  ('b_ok',    public.book_slot('sl_llc_def')),
  ('b_wrong', public.book_slot('sl_llc_b'));
reset role;

select is((select r ->> 'ok' from llc where tag = 'b_ok'), 'true',
  'booking at the branch the credit belongs to works');
select is((select r ->> 'reason' from llc where tag = 'b_wrong'), 'credit_wrong_location',
  'booking at the OTHER branch is credit_wrong_location, not no_usable_credit');
select is((select r ->> 'location_name' from llc where tag = 'b_wrong'), 'Oro Plaza Hotel',
  'and it names the branch the player actually holds credits at');
select is((select count(*)::int from public.bookings where slot_id = 'sl_llc_b'), 0,
  'the refused booking created nothing');
select is((select quantity_remaining from public.credit_batches where id = 'cb_llc_b'), 2,
  'and spent no credit');

-- The payload must describe the CALLER's own credits and nothing else.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0c1c1c03-0000-0000-0000-0000000c1c03"}', true);
insert into llc values ('b_other', public.book_slot('sl_llc_def'));
reset role;
select is((select r ->> 'reason' from llc where tag = 'b_other'), 'credit_wrong_location',
  'a different player gets the same reason shape');
select is((select r ->> 'location_id' from llc where tag = 'b_other'), 'loc_llc_b',
  'naming THEIR OWN branch');
select ok(
  (select (r ->> 'location_id') is not null and r ? 'location_name' and not (r ? 'player_id') and not (r ? 'credit_batch_id')
     from llc where tag = 'b_other'),
  'the payload carries a branch and nothing that could identify another player''s batch');

-- ════════════════════════════════════════════════════════════════════════════
-- grant_credits: defaults, refuses a closed branch, names the branch
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0c1c1c01-0000-0000-0000-0000000c1c01"}', true);
insert into llc values
  ('g_default', public.grant_credits('pl_llc_p1', 'duo', 1, 'comp')),
  ('g_branch',  public.grant_credits('pl_llc_p2', 'duo', 1, 'comp', 'loc_llc_b')),
  ('g_shut',    public.grant_credits('pl_llc_p2', 'duo', 1, 'comp', 'loc_llc_shut'));
reset role;

select is((select r ->> 'location_id' from llc where tag = 'g_default'), 'loc_oro_plaza',
  'a 4-arg grant (the deployed admin''s call) defaults to the original branch');
select is((select r ->> 'location_id' from llc where tag = 'g_branch'), 'loc_llc_b',
  'an explicit branch is honoured');
select is((select r ->> 'reason' from llc where tag = 'g_shut'), 'location_unavailable',
  'granting at a CLOSED branch is refused — the credits would be unspendable');
select is(
  (select body from public.notifications where type = 'credits_granted' and player_id = 'pl_llc_p1' order by created_at desc limit 1),
  'You received 1 Duo credit for Oro Plaza Hotel.',
  'the grant notification names the branch the credits work at');

-- ════════════════════════════════════════════════════════════════════════════
-- request_credits: issue #2 — `is distinct from`, and the legacy refusal
-- ════════════════════════════════════════════════════════════════════════════
delete from public.credit_requests where player_id = 'pl_llc_p2';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0c1c1c03-0000-0000-0000-0000000c1c03"}', true);
select set_config('request.headers', '', true);
insert into llc values ('rc_legacy', public.request_credits('pk_llc_b', 'instapay', null));
select set_config('request.headers', '{"x-tpa-client":"mobile/1.4.0"}', true);
insert into llc values ('rc_aware', public.request_credits('pk_llc_b', 'instapay', null));
reset role;
select is((select r ->> 'reason' from llc where tag = 'rc_legacy'), 'update_required',
  'a legacy caller still cannot request a non-default package');
select is((select r ->> 'ok' from llc where tag = 'rc_aware'), 'true',
  'a 1.4 caller can');

-- ════════════════════════════════════════════════════════════════════════════
-- admin_book_player: the same rule, and NO override
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0c1c1c01-0000-0000-0000-0000000c1c01"}', true);
insert into llc values
  ('abp_wrong', public.admin_book_player('sl_llc_b', 'pl_llc_p1', false)),
  ('abp_over',  public.admin_book_player('sl_llc_b', 'pl_llc_p1', true));
reset role;
select is((select r ->> 'reason' from llc where tag = 'abp_wrong'), 'credit_wrong_location',
  'an admin cannot spend one branch''s credits at another');
select is((select r ->> 'reason' from llc where tag = 'abp_over'), 'credit_wrong_location',
  'and p_override does NOT override location — it never covered anything but gender/level');

-- ════════════════════════════════════════════════════════════════════════════
-- The audit rule: nothing that runs as a client resolves tpa. as an invoker
-- ════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','tpa') and p.prosrc like '%tpa.%' and not p.prosecdef
      and p.proname <> 'mint_credits_for_purchase'),
  0,
  'every function whose body resolves a tpa. name is SECURITY DEFINER (the one invoker is unreachable by clients)');
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'tpa' and p.proname = 'force_location_from_package'),
  true, 'the forcing trigger is SECURITY DEFINER — it fires on the 1.2 Paymob insert');
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'tpa' and p.proname = 'location_name'),
  true, 'tpa.location_name is SECURITY DEFINER — it is called from bodies that run as clients');

select * from finish();
rollback;
