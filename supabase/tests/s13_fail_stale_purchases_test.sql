-- ============================================================================
-- S13 — fail_stale_purchases(): retire abandoned-at-3DS pending purchases.
-- Proves: a pending purchase older than the 24h window flips to 'failed'; the
-- window boundary is STRICT (created_at < now() - 24h) so a row exactly 24h old
-- is spared; a fresh pending is untouched; a SUCCEEDED purchase is NEVER
-- clobbered (the status='pending' pin protects a real, late-settled payment);
-- the return count reports how many were retired; it is idempotent; and the
-- function is cron-only (no execute grant to authenticated).
--
-- now() is the transaction timestamp — fixed for the whole test — so the 24h
-- boundary rows are deterministic across repeated calls. Folded into the suite
-- (this migration had no pgTAP coverage before A6).
--
-- Run with:  supabase test db
-- ============================================================================
begin;
select plan(8);

-- ── seed as postgres ─────────────────────────────────────────────────────────
insert into public.players (id, phone, name, gender, level, created_at) values
  ('pl_s13', null, 'Straggler', 'men', 'beginner', now());

insert into public.packages (id, training_type, session_count, price, name, is_active) values
  ('pk_s13', 'group', 4, 320000, 'Group 4', true);

-- A pending purchase legitimately carries NULL gateway refs (assigned later by S6),
-- and can only be payment_method='paymob' (cash is never pending).
insert into public.purchases (id, player_id, package_id, status, amount, created_at, payment_method) values
  ('pu_stale',    'pl_s13', 'pk_s13', 'pending',   320000, now() - interval '25 hours',          'paymob'),
  ('pu_pastwin',  'pl_s13', 'pk_s13', 'pending',   320000, now() - interval '24 hours 1 second', 'paymob'),
  ('pu_boundary', 'pl_s13', 'pk_s13', 'pending',   320000, now() - interval '24 hours',          'paymob'),
  ('pu_fresh',    'pl_s13', 'pk_s13', 'pending',   320000, now() - interval '1 hour',            'paymob'),
  ('pu_settled',  'pl_s13', 'pk_s13', 'succeeded', 320000, now() - interval '25 hours',          'paymob');

-- ── the cron-only surface is not granted to app roles ──
select ok(
  not has_function_privilege('authenticated', 'public.fail_stale_purchases()', 'execute'),
  'fail_stale_purchases() is cron-only — no execute grant to authenticated'
);

-- ── run the cleanup: exactly the two rows past the window are retired ──
select is(public.fail_stale_purchases(), 2, 'retires exactly the 2 pending rows older than 24h (returns the count)');

select is((select status from public.purchases where id = 'pu_stale'),    'failed',  'a 25h-old pending → failed');
select is((select status from public.purchases where id = 'pu_pastwin'),  'failed',  'just past the window (24h + 1s) → failed');
select is((select status from public.purchases where id = 'pu_boundary'), 'pending', 'exactly 24h old is INSIDE the window (strict <) → still pending');
select is((select status from public.purchases where id = 'pu_fresh'),    'pending', 'a fresh pending is untouched');
select is((select status from public.purchases where id = 'pu_settled'),  'succeeded',
          'a SUCCEEDED purchase is never clobbered (status=pending pin protects a real late settlement)');

-- ── idempotent: a second run retires nothing more ──
select is(public.fail_stale_purchases(), 0, 'idempotent — a second run retires 0 (nothing stale-and-pending remains)');

select * from finish();
rollback;
