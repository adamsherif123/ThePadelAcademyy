import { buildAdminGrant } from '@tpa/core';
import type { CreditBatch, IsoInstant, PlayerId, TrainingType } from '@tpa/types';

import { commitCreditGrant, getPlayers } from './store';

/**
 * Grant comp credits to a player (source admin_grant) — the honest alternative to
 * faking a purchase for a rained-out session, a complaint, or a goodwill gesture.
 *
 * The batch is built by @tpa/core's buildAdminGrant, NEVER hand-constructed: the
 * source ⇔ purchaseId invariant (and the note ⇒ admin_grant rule) are DB CHECK
 * constraints, and the builder is what keeps that promise — it sets source
 * 'admin_grant', purchaseId null, a 30-day expiry (a comp buys no extra time), and
 * the note.
 *
 * A reason is REQUIRED here even though the column is nullable: an unexplained free
 * credit reads as fraud or error in an audit six months on, and the whole point of
 * the admin_grant note is to make the "why" durable.
 *
 * Unlike coach/package config, credit_batches has NO admin write policy in the
 * schema — minting credits is money and must be atomic + audited — so S10 replaces
 * this body with a SECURITY DEFINER RPC, not a plain insert.
 */
export type GrantResult =
  | { ok: true; batch: CreditBatch }
  | { ok: false; reason: 'player_missing' | 'reason_required' | 'quantity_below_one' };

export function grantCredits(
  playerId: PlayerId,
  trainingType: TrainingType,
  quantity: number,
  reason: string,
  now: IsoInstant,
): GrantResult {
  if (!getPlayers().some((p) => p.id === playerId)) return { ok: false, reason: 'player_missing' };
  if (reason.trim() === '') return { ok: false, reason: 'reason_required' };
  if (quantity < 1) return { ok: false, reason: 'quantity_below_one' };

  const batch = buildAdminGrant(playerId, trainingType, Math.floor(quantity), now, reason.trim());
  commitCreditGrant(batch);
  return { ok: true, batch };
}
