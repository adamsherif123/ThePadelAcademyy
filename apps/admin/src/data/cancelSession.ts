import type { SlotId } from '@tpa/types';

import { cancelSessionRpc, type CancelSessionResult } from '../lib/api';
import { TOUCHED } from '../lib/queryClient';
import { runRpc } from './queries';

/**
 * Cancel an academy session via the atomic cancel_session RPC: the slot → cancelled,
 * every booked booking on it → cancelled + refunded, booked_count → 0. Idempotent
 * server-side (an already-cancelled slot is rejected; only 'booked' bookings refund),
 * so a re-cancel can't double-refund N players. Only offer it for FUTURE sessions
 * (S10a): it zeroes booked_count and would leave a past session's attended/no_show
 * bookings inconsistent.
 */
export function cancelSession(
  slotId: SlotId,
): Promise<CancelSessionResult | { ok: false; reason: 'network' }> {
  return runRpc(() => cancelSessionRpc(slotId), TOUCHED.booking);
}
