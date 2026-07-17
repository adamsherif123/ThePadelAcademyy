import type { PlayerId, TrainingType } from '@tpa/types';

import { grantCreditsRpc, type GrantResult } from '../lib/api';
import { TOUCHED } from '../lib/queryClient';
import { runRpc } from './queries';

/**
 * Comp a player credits via the atomic grant_credits RPC. Minting credits is money,
 * so it's a SECURITY DEFINER RPC (credit_batches has no admin write policy) — the
 * required `note` is the audit trail, enforced server-side (reason_required).
 */
export function grantCredits(
  playerId: PlayerId,
  trainingType: TrainingType,
  quantity: number,
  reason: string,
): Promise<GrantResult | { ok: false; reason: 'network' }> {
  return runRpc(() => grantCreditsRpc(playerId, trainingType, quantity, reason), TOUCHED.money);
}
