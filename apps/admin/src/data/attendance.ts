import type { BookingId } from '@tpa/types';

import { markAttendanceRpc, type AttendanceStatus, type MarkAttendanceResult } from '../lib/api';
import { TOUCHED } from '../lib/queryClient';
import { runRpc } from './queries';

export type { AttendanceStatus } from '../lib/api';

/**
 * Mark a booking booked ⇄ attended ⇄ no_show via the mark_attendance RPC (S10a).
 * It's admin-gated, past-sessions-only, reversible, and idempotent server-side, and
 * it touches ONLY bookings.status — never booked_count, never credits. 'cancelled'
 * is unreachable (the RPC rejects it as invalid_status).
 */
export function markAttendance(
  bookingId: BookingId,
  status: AttendanceStatus,
): Promise<MarkAttendanceResult | { ok: false; reason: 'network' }> {
  return runRpc(() => markAttendanceRpc(bookingId, status), TOUCHED.attendance);
}
