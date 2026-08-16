-- ============================================================================
-- Cancellation forfeit window: 3 -> 5 hours.
--
-- tpa.cancellation_window() is the ONE place this window lives (packages/core's
-- CANCELLATION_WINDOW_HOURS mirrors it, guarded by sql-parity.test.ts). The live
-- cancel_booking body (20260817000036_session_reopened_notify.sql) reads it via
-- `v_refund := (v_slot.starts_at - now()) > tpa.cancellation_window();` — a live
-- comparison against the DB clock AT CANCEL TIME, not a value captured anywhere
-- earlier. Replacing this function only changes what a cancellation FROM NOW ON
-- computes; it cannot and does not touch any past cancellation's already-decided
-- refund/forfeit outcome (those wrote a `bookings.status`/refund exactly once,
-- at the time they happened, and are never re-evaluated).
-- ============================================================================

create or replace function tpa.cancellation_window()
  returns interval language sql immutable
  as $$ select interval '5 hours' $$;
