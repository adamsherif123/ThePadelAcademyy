import type { CreditBatch, IsoInstant, PlayerId, PurchaseId } from '@tpa/types';

import { CREDIT_EXPIRY_DAYS, EXPIRING_SOON_DAYS, SIGNUP_TRIAL_CREDITS } from './constants';
import { ID_PREFIXES, newId } from './ids';
import { parseInstant, toInstant } from './time';

/**
 * Runtime/type mirror of the CreditBatch source invariant (cf. `isGroupSlot`):
 * a purchase-backed batch has a non-null `purchaseId`. Narrows the type so
 * `purchaseId` is usable without a null check.
 */
export function isPurchaseBacked(
  batch: CreditBatch,
): batch is CreditBatch & { purchaseId: PurchaseId; source: 'purchase' } {
  return batch.source === 'purchase';
}

/**
 * The exact CreditBatch to insert when an account is created — the one and only
 * place the signup trial-grant rule lives. Pure: takes `now`, does no I/O. S8
 * (auth) calls this once, inside the player-creation transaction.
 *
 * Grants SIGNUP_TRIAL_CREDITS trial credits, sourced `signup_grant` (never a
 * purchase, so `purchaseId` is null), expiring CREDIT_EXPIRY_DAYS from `now` —
 * the same expiry rule as purchased credits.
 */
/**
 * Visual expiry state for a credit batch, the canonical union the wallet UI keys
 * off (@tpa/theme maps each to a color). `expired` is exact to the instant;
 * `expiring_soon` covers the EXPIRING_SOON_DAYS window before that.
 */
export type CreditExpiryState = 'ok' | 'expiring_soon' | 'expired';

export function creditExpiryState(expiresAt: IsoInstant, now: IsoInstant): CreditExpiryState {
  const expiresMs = parseInstant(expiresAt).getTime();
  const nowMs = parseInstant(now).getTime();
  if (expiresMs <= nowMs) return 'expired';
  if (expiresMs - nowMs <= EXPIRING_SOON_DAYS * 86_400_000) return 'expiring_soon';
  return 'ok';
}

export function buildSignupGrant(playerId: PlayerId, now: IsoInstant): CreditBatch {
  const expiresAt = toInstant(
    new Date(parseInstant(now).getTime() + CREDIT_EXPIRY_DAYS * 86_400_000),
  );
  return {
    id: newId(ID_PREFIXES.creditBatch) as CreditBatch['id'],
    playerId,
    source: 'signup_grant',
    purchaseId: null,
    trainingType: 'trial',
    quantityTotal: SIGNUP_TRIAL_CREDITS,
    quantityRemaining: SIGNUP_TRIAL_CREDITS,
    expiresAt,
    createdAt: now,
  };
}
