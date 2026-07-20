-- ============================================================================
-- S13 — clean up abandoned-at-3DS pending purchases.
--
-- A player who closes the Paymob sheet mid-payment leaves a PENDING purchase with no
-- callback ever coming. It reads correctly in history ("Pending"), but lingers forever.
-- This transitions such stragglers to 'failed' (the existing terminal state; no new
-- enum value, no UI change — an abandoned purchase honestly reads "Failed").
--
-- MECHANISM: pg_cron (the natural fit — it runs server-side regardless of whether the
-- abandoning user ever opens the app again; a lazy cleanup-on-read can't touch a row
-- nobody reads). The FUNCTION lives here (reproducible, testable); the SCHEDULE is
-- applied to the hosted project out-of-band — cron scheduling is environment-specific
-- infra and pg_cron isn't guaranteed on every local stack, so keeping it out of the
-- migration keeps `supabase test db` safe. To schedule (dev + prod), run once:
--
--   create extension if not exists pg_cron;
--   select cron.schedule('fail-stale-purchases', '17 * * * *',
--                         $$ select public.fail_stale_purchases(); $$);
--
-- RACE SAFETY: reuses the guarded-update discipline. The WHERE pins status='pending',
-- so a settlement that lands — even LATE — flips the row to 'succeeded' FIRST and this
-- UPDATE no longer matches it. A real payment is therefore never clobbered:
--   settle_purchase wins  → row is 'succeeded' → cleanup's WHERE misses it.
--   cleanup wins (truly abandoned) → row is 'failed' → settle_purchase's own
--                          WHERE status='pending' misses it (returns not_pending).
--
-- WINDOW = 24 hours: safely longer than any real path. Paymob fires the processed
-- callback within seconds of a captured 3DS payment and retries a failed delivery over
-- a short window; 24h is far beyond a slow-but-real settlement (incl. a dawdling user
-- at the 3DS page + delivery retries), so a genuine payment's webhook has long since
-- arrived before a row becomes eligible.
-- ============================================================================

create or replace function public.fail_stale_purchases()
  returns integer
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.purchases
     set status = 'failed'
   where status = 'pending'
     and created_at < now() - interval '24 hours';
  get diagnostics v_count = row_count;
  return v_count;   -- how many stragglers were retired this run (for logging/alerting)
end;
$$;

-- Cron-only surface: pg_cron runs jobs as the cron superuser; no client role needs it.
revoke all on function public.fail_stale_purchases() from public, anon, authenticated;
