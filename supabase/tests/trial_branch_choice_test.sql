-- ============================================================================
-- S8.7 — choosing a branch for the trial, and what happens on a second attempt.
--
-- The picker does not add a field: the trial PACKAGE decides where the credits
-- will work (tpa.force_location_from_package), so "choose a branch" is "request
-- that branch's trial package". This suite pins the two server facts the client
-- copy is built on, both run as the real role under a player's own JWT:
--
--   1. Requesting a NON-default branch's trial stamps the request with THAT
--      branch — the thing the picker is for.
--   2. A second trial at another branch is refused as `trial_already_used`, NOT
--      `already_pending`. That distinction is the whole reason the client shows
--      "your trial request is already in" rather than "you've already used your
--      trial" — the player has used nothing, they are waiting.
-- Run with: supabase test db
-- ============================================================================
begin;
select plan(16);

insert into auth.users (id) values
  ('08700001-0000-0000-0000-000000000001'),
  ('08700002-0000-0000-0000-000000000002'),
  ('08700003-0000-0000-0000-000000000003');   -- admin, to decline through the real RPC

insert into public.admins (id, auth_user_id, display_name, created_at) values
  ('adm_s87', '08700003-0000-0000-0000-000000000003', 'Adm87', now());

insert into public.locations (id, name, address, maps_url, hours_text, sort_order, is_active, is_default)
values ('loc_s87_zayed', 'Sheikh Zayed Club', '7 Test St, Giza', 'https://maps.example/z', 'Daily', 53, true, false);

insert into public.players (id, phone, name, gender, level, created_at, auth_user_id) values
  ('pl_s87_a', '+201908700001', 'Trial Player A', 'men', 'beginner', now(), '08700001-0000-0000-0000-000000000001'),
  ('pl_s87_b', '+201908700002', 'Trial Player B', 'men', 'beginner', now(), '08700002-0000-0000-0000-000000000002');

-- A trial package at EACH branch, at different prices — the shape the picker exists for.
insert into public.packages (id, location_id, training_type, session_count, price, name, is_active) values
  ('pk_s87_trial_home',  'loc_oro_plaza',  'trial', 1, 50000, 'Trial Session',      true),
  ('pk_s87_trial_zayed', 'loc_s87_zayed',  'trial', 1, 45000, 'Trial Session (SZ)', true),
  ('pk_s87_group_zayed', 'loc_s87_zayed',  'group', 4, 240000, 'Zayed Group 4',     true),
  ('pk_s87_group_home',  'loc_oro_plaza',  'group', 4, 240000, 'Home Group 4',      true);

-- ════════════════════════════════════════════════════════════════════════════
-- 1 — the picker's premise: the eligible branches are the ones selling a trial
-- ════════════════════════════════════════════════════════════════════════════
select is(
  (select count(*)::int from public.packages
    where training_type = 'trial' and is_active
      and location_id in ('loc_oro_plaza', 'loc_s87_zayed')),
  2, 'both branches sell an active trial, so both are eligible');
select is(
  (select count(distinct price)::int from public.packages
    where training_type = 'trial' and is_active and location_id in ('loc_oro_plaza', 'loc_s87_zayed')),
  2, 'at different prices — which is what makes the welcome chip say "from"');

-- ════════════════════════════════════════════════════════════════════════════
-- 2 — requesting the SECOND branch's trial, as the player
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"08700001-0000-0000-0000-000000000001","role":"authenticated"}', true);
-- 063's net pins a client that has not declared itself to the default branch.
select set_config('request.headers', '{"x-tpa-client":"mobile/1.4.0"}', true);
select is(public.request_credits('pk_s87_trial_zayed', 'instapay', null)->>'ok', 'true',
  'a player can request the SECOND branch''s trial');
reset role;

select is(
  (select location_id from public.credit_requests where player_id = 'pl_s87_a' and is_trial),
  'loc_s87_zayed',
  'and the request is stamped with THAT branch, not the default — the picker''s whole job');
select is(
  (select is_trial from public.credit_requests where player_id = 'pl_s87_a' and is_trial),
  true, 'and is marked as the trial, which is what the once-ever locks key on');

-- ════════════════════════════════════════════════════════════════════════════
-- 3 — the second attempt, at the OTHER branch
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"08700001-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tpa-client":"mobile/1.4.0"}', true);
select is(public.request_credits('pk_s87_trial_home', 'instapay', null)->>'reason', 'trial_already_used',
  'a trial at the other branch is refused as trial_already_used');
-- NOT already_pending. 066 scoped that check per branch, so it passes here; the
-- refusal comes from tpa.trial_used, which is branch-agnostic by design because
-- the trial is once per PLAYER. The client copy depends on exactly this.
select isnt(public.request_credits('pk_s87_trial_home', 'instapay', null)->>'reason', 'already_pending',
  'and NOT already_pending — the limit is the trial, not the branch');
reset role;

select is(
  (select count(*)::int from public.credit_requests where player_id = 'pl_s87_a' and is_trial),
  1, 'no second TRIAL request row was created');

-- ════════════════════════════════════════════════════════════════════════════
-- 4 — a declined trial can be retried, at a DIFFERENT branch
-- ════════════════════════════════════════════════════════════════════════════
-- Declined through the REAL RPC as the admin, not a hand-written UPDATE: the
-- resolution-shape CHECK requires resolved_by too, and the admin path is the only
-- thing that ever sets these in production.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"08700003-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(
  public.reject_credit_request(
    (select id from public.credit_requests where player_id = 'pl_s87_a' and is_trial), 'No transfer received')->>'ok',
  'true', 'the academy declines the trial request');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"08700001-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tpa-client":"mobile/1.4.0"}', true);
select is(public.request_credits('pk_s87_trial_home', 'instapay', null)->>'ok', 'true',
  'once declined, the trial can be requested again — at the OTHER branch this time');
reset role;
select is(
  (select location_id from public.credit_requests where player_id = 'pl_s87_a' and status = 'pending' and is_trial),
  'loc_oro_plaza', 'and it lands at the branch they picked the second time');

-- ── 5. the two limits are different, and both are live ─────────────────────
-- The two limits are different and both are live, which is worth stating plainly
-- because the client shows different copy for each:
--   • the TRIAL limit is per PLAYER, so it refuses at any branch;
--   • the PENDING limit is per BRANCH (066), so it refuses only where one waits.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"08700001-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('request.headers', '{"x-tpa-client":"mobile/1.4.0"}', true);
-- The pending trial now sits at the DEFAULT branch (the retry above landed there).
select is(public.request_credits('pk_s87_group_home', 'instapay', null)->>'reason', 'already_pending',
  'a NON-trial request at the branch holding the pending trial is already_pending (the 066 limit)');
select is(public.request_credits('pk_s87_group_zayed', 'instapay', null)->>'ok', 'true',
  'but the SAME request at the other branch goes through — the block is that branch, not the player');
reset role;

-- ════════════════════════════════════════════════════════════════════════════
-- 6 — legacy clients are untouched: no header means the default branch only
-- ════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"08700002-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('request.headers', '{}', true);
select is(public.request_credits('pk_s87_trial_zayed', 'instapay', null)->>'reason', 'update_required',
  'a 1.2/1.3 client is refused the second branch''s trial outright (063)');
select is(public.request_credits('pk_s87_trial_home', 'instapay', null)->>'ok', 'true',
  'and gets the DEFAULT branch''s trial, exactly as it always has');
reset role;
select is(
  (select location_id from public.credit_requests where player_id = 'pl_s87_b'),
  'loc_oro_plaza', 'which is the only branch a legacy build can ever reach');

select * from finish();
rollback;
