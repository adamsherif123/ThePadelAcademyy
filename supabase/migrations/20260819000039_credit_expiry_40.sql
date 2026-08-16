-- ============================================================================
-- Credit expiry: 30 -> 40 days, future purchases only.
--
-- tpa.credit_expiry() is the ONE place this window lives (packages/core's
-- CREDIT_EXPIRY_DAYS mirrors it, guarded by sql-parity.test.ts). Every mint site
-- (mint_credits_for_purchase, grant_credits, complete_signup) calls
-- `now() + tpa.credit_expiry()` at insert time and stores the result directly
-- into credit_batches.expires_at — expiry is computed ONCE, at mint, never
-- re-derived later. Replacing this function only changes what NEW inserts
-- compute; it cannot and does not touch any already-stored expires_at value.
--
-- No UPDATE runs against credit_batches here or anywhere in this migration —
-- every existing batch (signup grants, purchases, admin grants alike) keeps
-- EXACTLY the expires_at it already has, still 30 days from ITS OWN created_at.
-- Only a batch minted after this migration lands gets 40.
-- ============================================================================

create or replace function tpa.credit_expiry()
  returns interval language sql immutable
  as $$ select interval '40 days' $$;
