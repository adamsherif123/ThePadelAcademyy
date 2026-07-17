import type { SlotId } from '@tpa/types';

import { confirmSessionRpc, type ConfirmResult } from '../lib/api';
import { TOUCHED } from '../lib/queryClient';
import { runRpc } from './queries';

/**
 * Confirm a session manually (it's on, even if it hasn't filled) via the atomic
 * confirm_session RPC. Idempotent server-side; rejects a cancelled or past slot.
 * Touches only confirmed_at — orthogonal to money and occupancy.
 */
export function confirmSession(
  slotId: SlotId,
): Promise<ConfirmResult | { ok: false; reason: 'network' }> {
  return runRpc(() => confirmSessionRpc(slotId), TOUCHED.slots);
}
