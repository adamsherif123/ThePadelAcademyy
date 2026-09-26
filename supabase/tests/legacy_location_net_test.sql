-- ============================================================================
-- The legacy-client location net (pgTAP).
--
-- What must hold: a client that does not announce itself as location-aware sees
-- only the default branch — as anon and as an authenticated player, across
-- session_slots, availability_templates and packages; a client that does sees
-- everything; an admin sees everything either way; and the two money paths a
-- legacy client could otherwise reach (the Paymob purchases INSERT and
-- request_credits) refuse a non-default package.
--
-- request.headers is set with set_config(..., true) — transaction-local, exactly
-- how PostgREST sets it per request. The `unset` case is the important one: it
-- is what psql, cron and every trigger see, and it must read as legacy.
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(36);

insert into auth.users (id) values
  ('0f0f0f01-0000-0000-0000-00000000f001'),   -- admin
  ('0f0f0f02-0000-0000-0000-00000000f002');   -- ordinary player

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_net_adm', '+201900040001', 'Admin Human',  'men', 'beginner', now(), '0f0f0f01-0000-0000-0000-00000000f001'),
  ('pl_net_p1',  '+201900040002', 'Plain Player', 'men', 'beginner', now(), '0f0f0f02-0000-0000-0000-00000000f002');

insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('ad_net', '0f0f0f01-0000-0000-0000-00000000f001', 'Admin', now());

insert into public.coaches (id, name, bio, is_active) values ('co_net', 'Coach', 'b', true);

insert into public.locations (id, name, address, maps_url, hours_text, sort_order, is_active, is_default)
values ('loc_net_b', 'Branch B', 'Elsewhere, Cairo', 'https://maps.google.com/?q=B', 'Daily', 1, true, false);

-- One published slot, one active template and one active package at EACH branch.
insert into public.session_slots (id, coach_id, starts_at, ends_at, training_type, capacity, status, gender, level, location_id) values
  ('sl_net_def', 'co_net', now() + interval '2 days', now() + interval '2 days 1 hour', 'group', 4, 'published', 'men', 'beginner', 'loc_oro_plaza'),
  ('sl_net_b',   'co_net', now() + interval '3 days', now() + interval '3 days 1 hour', 'group', 4, 'published', 'men', 'beginner', 'loc_net_b');

insert into public.availability_templates (id, coach_id, weekday, start_time, end_time, training_type, capacity, is_active, gender, level, location_id) values
  ('at_net_def', 'co_net', 1, '17:00', '18:00', 'group', 4, true, 'men', 'beginner', 'loc_oro_plaza'),
  ('at_net_b',   'co_net', 2, '17:00', '18:00', 'group', 4, true, 'men', 'beginner', 'loc_net_b');

insert into public.packages (id, training_type, session_count, price, name, is_active, location_id) values
  ('pk_net_def', 'group', 4, 100000, 'Default four', true, 'loc_oro_plaza'),
  ('pk_net_b',   'group', 4, 120000, 'Branch B four', true, 'loc_net_b');

-- Helpers: set / clear the header exactly as PostgREST would.
create or replace function pg_temp.set_client(hdr text) returns void language plpgsql as $$
begin
  if hdr is null then
    perform set_config('request.headers', '', true);
  else
    perform set_config('request.headers', json_build_object('x-tpa-client', hdr)::text, true);
  end if;
end; $$;

-- ════════════════════════════════════════════════════════════════════════════
-- The predicate itself
-- ════════════════════════════════════════════════════════════════════════════
select lives_ok($$ select tpa.client_is_location_aware() $$, 'the predicate runs with no request context at all');
select is(tpa.client_is_location_aware(), false,
  'no request.headers (psql, cron, a trigger) reads as LEGACY — the restrictive answer');

select pg_temp.set_client('mobile/1.4.0');
select is(tpa.client_is_location_aware(), true,  'mobile/1.4.0 is location-aware');
select pg_temp.set_client('mobile/1.4');
select is(tpa.client_is_location_aware(), true,  'a two-part version is accepted');
select pg_temp.set_client('mobile/10.20.30');
select is(tpa.client_is_location_aware(), true,  'multi-digit parts are accepted');

select pg_temp.set_client('mobile/');
select is(tpa.client_is_location_aware(), false, 'mobile/ with no version is LEGACY');
select pg_temp.set_client('mobile/abc');
select is(tpa.client_is_location_aware(), false, 'mobile/abc is LEGACY');
select pg_temp.set_client('admin');
select is(tpa.client_is_location_aware(), false, 'admin is LEGACY — the admin never sends this header');
select pg_temp.set_client('');
select is(tpa.client_is_location_aware(), false, 'an empty header is LEGACY');
select pg_temp.set_client('mobile/1.4.0-beta');
select is(tpa.client_is_location_aware(), false, 'a prerelease suffix is LEGACY — the pattern is anchored');
select pg_temp.set_client(' mobile/1.4.0');
select is(tpa.client_is_location_aware(), false, 'a leading space is LEGACY — anchored at both ends');

-- Unparseable request.headers must not raise.
select set_config('request.headers', 'not json at all', true);
select is(tpa.client_is_location_aware(), false, 'unparseable request.headers is LEGACY, not an error');

-- ════════════════════════════════════════════════════════════════════════════
-- A LEGACY authenticated player: default branch only
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0f0f0f02-0000-0000-0000-00000000f002"}', true);
select pg_temp.set_client(null);

select is((select count(*)::int from public.session_slots where id in ('sl_net_def','sl_net_b')), 1,
  'legacy player sees ONE of the two slots');
select is((select id from public.session_slots where id in ('sl_net_def','sl_net_b')), 'sl_net_def',
  'and it is the default-branch one');
select is((select count(*)::int from public.availability_templates where id in ('at_net_def','at_net_b')), 1,
  'legacy player sees one of the two templates');
select is((select id from public.availability_templates where id in ('at_net_def','at_net_b')), 'at_net_def',
  'and it is the default-branch one');
select is((select count(*)::int from public.packages where id in ('pk_net_def','pk_net_b')), 1,
  'legacy player sees one of the two packages');
select is((select id from public.packages where id in ('pk_net_def','pk_net_b')), 'pk_net_def',
  'and it is the default-branch one — this is the money surface');

-- ════════════════════════════════════════════════════════════════════════════
-- The SAME player, now location-aware: everything
-- ════════════════════════════════════════════════════════════════════════════
select pg_temp.set_client('mobile/1.4.0');
select is((select count(*)::int from public.session_slots where id in ('sl_net_def','sl_net_b')), 2,
  'a 1.4 client sees both branches'' slots');
select is((select count(*)::int from public.availability_templates where id in ('at_net_def','at_net_b')), 2,
  'a 1.4 client sees both branches'' templates');
select is((select count(*)::int from public.packages where id in ('pk_net_def','pk_net_b')), 2,
  'a 1.4 client sees both branches'' packages');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- A LEGACY anon (pre-auth) reader
-- ════════════════════════════════════════════════════════════════════════════
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select pg_temp.set_client(null);
select is((select count(*)::int from public.session_slots where id in ('sl_net_def','sl_net_b')), 1,
  'legacy ANON sees only the default branch''s slots');
select is((select count(*)::int from public.packages where id in ('pk_net_def','pk_net_b')), 1,
  'legacy ANON sees only the default branch''s packages — the pre-auth catalogue');
select pg_temp.set_client('mobile/1.4.0');
select is((select count(*)::int from public.packages where id in ('pk_net_def','pk_net_b')), 2,
  'a location-aware anon sees both');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- An ADMIN: everything, with NO header — the proof the admin app needs no change
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0f0f0f01-0000-0000-0000-00000000f001"}', true);
select pg_temp.set_client(null);

select is((select count(*)::int from public.session_slots where id in ('sl_net_def','sl_net_b')), 2,
  'an admin with NO header still reads every branch''s slots');
select is((select count(*)::int from public.availability_templates where id in ('at_net_def','at_net_b')), 2,
  'an admin with NO header still reads every branch''s templates');
select is((select count(*)::int from public.packages where id in ('pk_net_def','pk_net_b')), 2,
  'an admin with NO header still reads every branch''s packages');
select ok(
  (select count(*) from pg_policies
    where tablename = 'session_slots' and policyname = 'session_slots_select_all_admin'
      and qual not like '%location%') = 1,
  'the admin policy carries no location term — permissive policies OR, so it wins on its own');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- The Paymob INSERT: refused for a non-default package WITHOUT any new guard
-- ════════════════════════════════════════════════════════════════════════════
-- purchases_insert_own_pending pins amount to a subquery over `packages`, which
-- runs under the CALLER's RLS. For a legacy caller branch B's package is
-- invisible, the subquery is empty, amount = NULL, and the WITH CHECK fails.
-- This is the claim being tested rather than assumed.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0f0f0f02-0000-0000-0000-00000000f002"}', true);
select pg_temp.set_client(null);

select throws_ok(
  $$ insert into public.purchases (id, player_id, package_id, status, amount, created_at, payment_method, paid)
     values ('pu_net_1', 'pl_net_p1', 'pk_net_b', 'pending', 120000, now(), 'paymob', false) $$,
  '42501', null,
  'a LEGACY client cannot insert a pending purchase for a branch-B package');

select lives_ok(
  $$ insert into public.purchases (id, player_id, package_id, status, amount, created_at, payment_method, paid)
     values ('pu_net_2', 'pl_net_p1', 'pk_net_def', 'pending', 100000, now(), 'paymob', false) $$,
  'the same client CAN still buy a default-branch package — nothing legitimate broke');

-- And a location-aware client can reach branch B's package normally.
select pg_temp.set_client('mobile/1.4.0');
select lives_ok(
  $$ insert into public.purchases (id, player_id, package_id, status, amount, created_at, payment_method, paid)
     values ('pu_net_3', 'pl_net_p1', 'pk_net_b', 'pending', 120000, now(), 'paymob', false) $$,
  'a 1.4 client can buy the branch-B package');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- request_credits: SECURITY DEFINER, so RLS does NOT protect it
-- ════════════════════════════════════════════════════════════════════════════
create temporary table net_res (tag text primary key, r jsonb);
grant insert on net_res to authenticated;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0f0f0f02-0000-0000-0000-00000000f002"}', true);
select pg_temp.set_client(null);
insert into net_res values ('legacy_b', public.request_credits('pk_net_b', 'instapay', null));
reset role;
select is((select r ->> 'reason' from net_res where tag = 'legacy_b'), 'update_required',
  'a legacy caller requesting a branch-B package gets update_required');
select is((select count(*)::int from public.credit_requests where package_id = 'pk_net_b'), 0,
  'and nothing was written');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0f0f0f02-0000-0000-0000-00000000f002"}', true);
select pg_temp.set_client('mobile/1.4.0');
insert into net_res values ('aware_b', public.request_credits('pk_net_b', 'instapay', null));
reset role;
select is((select r ->> 'ok' from net_res where tag = 'aware_b'), 'true',
  'a 1.4 caller CAN request the branch-B package');

-- A legacy caller is unaffected for a default-branch package (the common case).
delete from public.credit_requests where player_id = 'pl_net_p1';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"0f0f0f02-0000-0000-0000-00000000f002"}', true);
select pg_temp.set_client(null);
insert into net_res values ('legacy_def', public.request_credits('pk_net_def', 'instapay', null));
reset role;
select is((select r ->> 'ok' from net_res where tag = 'legacy_def'), 'true',
  'a legacy caller still buys at the default branch exactly as before');

-- ════════════════════════════════════════════════════════════════════════════
-- Nothing service-side consults the net
-- ════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','tpa')
      and p.prosrc like '%client_is_location_aware%'
      and p.proname <> 'client_is_location_aware'),
  1,
  'exactly ONE function references the net — request_credits. Cron, settle_purchase and the webhook do not');

select * from finish();
rollback;
