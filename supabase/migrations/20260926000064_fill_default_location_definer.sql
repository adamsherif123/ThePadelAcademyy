-- ============================================================================
-- Repair the stale-bundle fallback: it never worked for a client role.
--
-- Migration 062 added a BEFORE INSERT trigger so an admin bundle that predates
-- location_id could still insert a slot — the row would quietly land at the
-- default branch instead of failing with a 23502 the owner could not explain.
--
-- It does the opposite. `tpa.fill_default_location()` is not SECURITY DEFINER,
-- so its body runs as the INVOKING role, and neither `authenticated` nor `anon`
-- holds USAGE on schema `tpa`. Every client INSERT that omits location_id
-- therefore fails with:
--
--     42501  permission denied for schema tpa
--
-- which is a worse error than the one the trigger was written to prevent, and it
-- fires on exactly the path it was meant to protect.
--
-- ── how it got missed ──
-- 062's pgTAP asserted "a session_slot inserted WITHOUT location_id lands at the
-- default" — and it passes, because pgTAP runs it as `postgres`, which does hold
-- schema usage. The test proved the trigger works for the one role that never
-- needs it. The assertions added below run as `authenticated`, which is the role
-- the trigger exists for.
--
-- ── SECURITY DEFINER, not a schema grant ──
-- Granting `authenticated` USAGE on `tpa` would expose every helper in there to
-- the API surface — the notify builders, the refund rule, the reminder cron's
-- internals. This function takes no arguments, writes nothing but NEW, and its
-- only side effect is reading one indexed row through another definer function.
-- Same reasoning as 063's fix to tpa.default_location_id().
--
-- ── this is still TEMPORARY ──
-- The admin now sends location_id explicitly on every insert (see api.ts's
-- insertSlots and templateRow), so nothing in the current client depends on this.
-- It stays only for a tab left open on an older bundle, and is still due to be
-- dropped when 1.4 ships.
-- ============================================================================

create or replace function tpa.fill_default_location()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if new.location_id is null then
    new.location_id := tpa.default_location_id();
  end if;
  return new;
end;
$$;

comment on function tpa.fill_default_location() is
  'TEMPORARY (062, repaired in 064): lets a pre-1.4 client insert without location_id. SECURITY DEFINER because client roles hold no USAGE on schema tpa. Drop when 1.4 ships.';

-- A trigger function needs no EXECUTE grant: the trigger fires it by OID, with
-- no privilege check. Postgres grants EXECUTE to PUBLIC on every new function,
-- so 062 left this one callable by anon and authenticated — harmless while it
-- was an invoker (calling it outside a trigger just raises), but it is SECURITY
-- DEFINER now, and a definer function reachable by PUBLIC is surface with no
-- purpose. Taken back.
revoke all on function tpa.fill_default_location() from public, anon, authenticated;
