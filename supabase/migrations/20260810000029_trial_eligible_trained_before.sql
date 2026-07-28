-- ============================================================================
-- Bug fix — trial_eligible() never actually consulted trained_before.
--
-- Device repro: a player who answered "I've trained at TPA before" at signup
-- (self-reported, stored on players.trained_before by complete_signup — A5
-- Task 4) is STILL offered the trial-purchase option everywhere in the app.
--
-- Root cause: A5's Task 4 (capture trained_before) and Task 5 (expose
-- trial_eligible() for the client) were two separate tasks in the same
-- migration, and the wiring between them was never made — trial_eligible()
-- calls tpa.trial_used(), which only checks for a PURCHASED trial batch or a
-- LIVE (pending/approved) trial request. trained_before is stored but never
-- read by either function. A brand-new player who reports trained_before =
-- true, and who has never bought or requested a trial, therefore has
-- trial_used() = false and trial_eligible() = true — exactly Adam's repro.
--
-- This was NOT caught by a5_trial_test.sql because that file's own fixture
-- (Gina, created with trained_before = true at line 66) is asserted to have
-- the column stored correctly (line 67-68) but her trial_eligible() is never
-- actually checked anywhere in the file — the eligibility side of Task 4 was
-- untested, not just unwired.
--
-- All 5 client sites that offer a trial purchase (wallet, buy-credits, home,
-- trial-grant, package/[id]) already correctly call and honor
-- useTrialEligible() (verified by re-reading each) — this is a pure backend
-- gap, not an ungated screen. One RPC fix covers every client, both apps.
--
-- FIX — trial_eligible() also requires trained_before is not true. Kept OUT
-- of tpa.trial_used() deliberately: that function's name and existing pgTAP
-- coverage mean "has this player CONSUMED a trial" — conflating "self-
-- reported as already trained" into "used" would be a false statement the
-- next reader has to un-learn. trial_eligible() is where the two facts
-- ("not used" AND "not already trained") both belong. coalesce(..., false)
-- treats NULL (every player created before A5, who never had a chance to
-- answer) as "not reported trained before" — preserves their existing
-- eligibility exactly; this only changes behaviour for a player who
-- genuinely answered true, which never existed as a real code path until now.
-- ============================================================================

create or replace function public.trial_eligible()
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select public.current_player_id() is not null
     and not tpa.trial_used(public.current_player_id())
     and not coalesce(
           (select trained_before from public.players where id = public.current_player_id()),
           false
         )
$$;
