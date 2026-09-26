-- ============================================================================
-- The server-side net: pre-1.4 clients only ever see the default branch.
--
-- 1.2 and 1.3 are live, cannot be force-updated, and know nothing about
-- locations. The moment a second branch has sessions or packages, those
-- binaries would render them as if they were at Oro Plaza — and could take
-- money for them. Nothing client-side can fix a binary that is already on a
-- phone, so the filter has to live in the database.
--
-- ── how a client says it understands locations ──
-- 1.4 will send `x-tpa-client: mobile/<semver>`. Everything that does not —
-- 1.2, 1.3, a pre-auth (anon) read from any of them, and anything that is not
-- a PostgREST request at all — is treated as legacy and pinned to the default.
--
-- ⚠ THIS IS A UX NET, NOT A SECURITY BOUNDARY. The header is set by the client
-- and anyone can send it with curl. It exists so an honest old binary cannot
-- show or sell the wrong branch; it is not, and must never be relied on as, an
-- authorisation control. Every real rule — who may read a row, who may write
-- one, whose credits pay for a booking — is enforced by RLS, grants and the
-- money RPCs, none of which consult this.
--
-- ── it must never be consulted server-side ──
-- Cron (send_session_reminders, fail_stale_purchases), the Paymob webhook and
-- settle_purchase all run with no request context, so the function returns
-- false for them — "legacy". If any of those ever gated behaviour on it they
-- would silently restrict themselves to one branch. They do not call it, and
-- must not: the only callers are the three player-facing SELECT policies below.
-- ============================================================================

create or replace function tpa.client_is_location_aware()
  returns boolean
  language plpgsql
  stable
  set search_path = ''
as $$
declare
  v_header text;
begin
  -- `true` = missing_ok, so a non-PostgREST session (psql, cron, a trigger)
  -- yields NULL rather than raising. The cast is what can still fail if the
  -- setting is present but not JSON, hence the handler: anything unreadable is
  -- legacy, which is the restrictive answer.
  begin
    v_header := current_setting('request.headers', true)::json ->> 'x-tpa-client';
  exception when others then
    return false;
  end;

  -- Exactly `mobile/<major>.<minor>[.<patch>]`. A bare 'mobile/', 'mobile/abc',
  -- 'admin' or '' does not match, so a malformed or improvised header reads as
  -- legacy rather than as a way in.
  return v_header is not null and v_header ~ '^mobile/\d+\.\d+(\.\d+)?$';
end;
$$;

comment on function tpa.client_is_location_aware() is
  'True iff the caller sent x-tpa-client: mobile/<semver>. A UX net for pre-1.4 binaries — client-set, never an authorisation control.';

-- ── default_location_id() must become SECURITY DEFINER ──────────────────────
-- Caught by rls_test: an RLS policy expression runs as the QUERYING role, so a
-- plain STABLE function called from a policy executes its body as that role too
-- — and `anon` holds no privilege on public.locations (061 gave SELECT to
-- `authenticated` only). Every anon read of session_slots and packages would
-- have failed with "permission denied for table locations", which is every
-- pre-auth screen in both live binaries.
--
-- SECURITY DEFINER rather than granting anon SELECT on locations: this leaks
-- exactly one id that is already implicit in every row the caller can see,
-- whereas the grant would hand anon the whole branch list — addresses, hours and
-- all — for no reason. search_path is pinned, the body is a single indexed read,
-- and it takes no arguments, so there is nothing to inject.
create or replace function tpa.default_location_id()
  returns text
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select id from public.locations where is_default;
$$;

-- ── the grants these two functions need ─────────────────────────────────────
-- An RLS policy expression is evaluated with the privileges of the querying
-- role, so both helpers must be EXECUTE-able by anon and authenticated or every
-- read below fails with "permission denied for function". 061 revoked
-- default_location_id() from all three roles precisely because nothing needed
-- it yet; the policies need it now.
revoke all on function tpa.client_is_location_aware() from public;
grant execute on function tpa.client_is_location_aware() to anon, authenticated;
grant execute on function tpa.default_location_id() to anon, authenticated;

-- ============================================================================
-- The three player-facing SELECT policies.
--
-- Each gains the same clause, and nothing else changes:
--     location_id = (select tpa.default_location_id())
--     or (select tpa.client_is_location_aware())
--
-- Both calls are wrapped in `(select …)` so the planner treats them as
-- InitPlans — evaluated ONCE per query, not once per row. That matters: the
-- mobile slot fetch is the known cost driver, and an unwrapped STABLE call in a
-- USING clause is a per-row function call over the whole scan.
--
-- The three ADMIN select policies are deliberately untouched. Permissive
-- policies for the same command OR together, so an admin still matches its own
-- unrestricted policy and reads every branch with no header at all — which is
-- why the admin app needs no change whatsoever.
--
-- COACHES: there is no coach-specific policy on session_slots; a coach reads
-- slots as plain `authenticated` through session_slots_select_published_public.
-- So a 1.3 coach sees only default-branch sessions in their schedule until they
-- update. Accepted — coaches move to 1.4 with everyone else, and their hours and
-- dashboard are SECURITY DEFINER aggregates that bypass RLS entirely, so pay is
-- never affected.
-- ============================================================================

-- ── session_slots ───────────────────────────────────────────────────────────
drop policy session_slots_select_published_public on public.session_slots;
create policy session_slots_select_published_public on public.session_slots
  for select to authenticated, anon
  using (
    status = 'published'
    and (
      location_id = (select tpa.default_location_id())
      or (select tpa.client_is_location_aware())
    )
  );

-- ── availability_templates ──────────────────────────────────────────────────
-- Feeds the mobile "is this day open?" rule. A legacy client must not learn a
-- second branch's opening days either, or its date strip would show days the
-- branch it thinks it is looking at is closed.
drop policy availability_templates_select_active on public.availability_templates;
create policy availability_templates_select_active on public.availability_templates
  for select to authenticated
  using (
    is_active
    and (
      location_id = (select tpa.default_location_id())
      or (select tpa.client_is_location_aware())
    )
  );

-- ── packages ────────────────────────────────────────────────────────────────
-- The money one. anon is included in this policy's roles, and packages is
-- anon-readable, so the pre-auth catalogue is filtered too.
drop policy packages_select_active_public on public.packages;
create policy packages_select_active_public on public.packages
  for select to authenticated, anon
  using (
    is_active
    and (
      location_id = (select tpa.default_location_id())
      or (select tpa.client_is_location_aware())
    )
  );

-- ============================================================================
-- request_credits: a legacy caller cannot request a non-default package.
--
-- SECURITY DEFINER bypasses RLS, so the policy above does NOT protect this — the
-- function reads `packages` as its owner and would happily find a branch-B row
-- whose id the caller should never have had. The check is therefore explicit.
--
-- `update_required` rather than `package_missing`: the package is real, the
-- caller is simply too old to buy it. A distinct reason lets 1.4 say something
-- true, and lets us see in the logs that a legacy client got somewhere it
-- should not have — package_missing would hide that.
--
-- Byte-identical to the 050 body except the ADDITIVE (063) block.
-- ============================================================================
create or replace function public.request_credits(p_package_id text, p_payment_method text, p_proof_path text default null)
  returns jsonb
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_player     text := public.current_player_id();
  v_pkg        public.packages;
  v_id         text := 'cr_' || gen_random_uuid();
  v_is_trial   boolean;
  v_constraint text;
  v_who        text;   -- ADDITIVE (owner ping)
begin
  if v_player is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  -- ADDITIVE (050): a coach account never acquires credits for itself.
  if (select public.current_coach_id()) is not null then
    return jsonb_build_object('ok', false, 'reason', 'coach_cannot_buy');
  end if;
  if p_payment_method not in ('instapay', 'cash') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_payment_method');
  end if;
  if exists (select 1 from public.credit_requests where player_id = v_player and status = 'pending') then
    return jsonb_build_object('ok', false, 'reason', 'already_pending');
  end if;
  select * into v_pkg from public.packages where id = p_package_id;
  if not found then           return jsonb_build_object('ok', false, 'reason', 'package_missing');  end if;
  if not v_pkg.is_active then  return jsonb_build_object('ok', false, 'reason', 'package_inactive'); end if;

  -- ADDITIVE (063): a pre-1.4 client cannot buy outside the default branch.
  -- Placed after the package is resolved so the answer distinguishes "no such
  -- package" from "a real package you are too old to buy", and before anything
  -- is written.
  if v_pkg.location_id <> tpa.default_location_id()
     and not tpa.client_is_location_aware() then
    return jsonb_build_object('ok', false, 'reason', 'update_required');
  end if;

  v_is_trial := (v_pkg.training_type = 'trial');
  -- A trial is once-per-player, ever (A5). Reject a second cleanly, never as a crash.
  if v_is_trial and tpa.trial_used(v_player) then
    return jsonb_build_object('ok', false, 'reason', 'trial_already_used');
  end if;

  if p_proof_path is not null and split_part(p_proof_path, '/', 1) <> v_player then
    return jsonb_build_object('ok', false, 'reason', 'invalid_proof_path');
  end if;

  begin
    insert into public.credit_requests (id, player_id, package_id, payment_method, proof_path, status, created_at, is_trial)
      values (v_id, v_player, p_package_id, p_payment_method, p_proof_path, 'pending', now(), v_is_trial);
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'credit_requests_one_trial_per_player' then
        return jsonb_build_object('ok', false, 'reason', 'trial_already_used');
      end if;
      return jsonb_build_object('ok', false, 'reason', 'already_pending');
    when foreign_key_violation then
      -- The package was deleted (delete_package's hard-delete) between our read
      -- above and this insert — same clean reason as "no such package".
      return jsonb_build_object('ok', false, 'reason', 'package_missing');
  end;
  -- ── ADDITIVE: remind the owners to go look at the admin ──────────────────
  -- Emitted only here, on the success return, AFTER the request row is committed.
  -- Every early return above is a rejection and reaches none of this.
  select name into v_who from public.players where id = v_player;
  perform tpa.notify_owners(
    'owner_credit_request',
    'New credit request',
    coalesce(v_who, 'A player') || ' requested ' || v_pkg.session_count || ' '
      || initcap(v_pkg.training_type) || ' Credits',
    v_player,
    null);

  return jsonb_build_object('ok', true, 'request_id', v_id);
end;
$$;
revoke all on function public.request_credits(text, text, text) from public;
grant execute on function public.request_credits(text, text, text) to authenticated;

-- ============================================================================
-- book_slot is deliberately NOT changed. See the session report: every way a
-- legacy client can learn a slot id is booking-derived (the feed is filtered
-- above; every slot-carrying notification goes to players who already hold a
-- booking on that slot), and the remaining path — an admin books a legacy
-- player into branch B, then removes them, leaving them holding the id — is
-- closed by location-locked credits in Session 4, not here. Guarding it here
-- would duplicate that rule in a second place and let the two drift.
-- ============================================================================
