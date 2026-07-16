import type {
  CreditBatch,
  IsoInstant,
  Package,
  PlayerId,
  PurchaseId,
  TrainingType,
} from '@tpa/types';

import { CREDIT_EXPIRY_DAYS, EXPIRING_SOON_DAYS, SIGNUP_TRIAL_CREDITS } from './constants';
import { ID_PREFIXES, newId } from './ids';
import { parseInstant, toInstant } from './time';

/** CREDIT_EXPIRY_DAYS after `now`, as an instant. The one expiry rule for all credits. */
function expiryFrom(now: IsoInstant): IsoInstant {
  return toInstant(new Date(parseInstant(now).getTime() + CREDIT_EXPIRY_DAYS * 86_400_000));
}

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
  return {
    id: newId(ID_PREFIXES.creditBatch) as CreditBatch['id'],
    playerId,
    source: 'signup_grant',
    purchaseId: null,
    trainingType: 'trial',
    quantityTotal: SIGNUP_TRIAL_CREDITS,
    quantityRemaining: SIGNUP_TRIAL_CREDITS,
    expiresAt: expiryFrom(now),
    createdAt: now,
    note: null,
  };
}

/**
 * The exact CreditBatch to insert when the OWNER comps a player — the escape
 * hatch that keeps strict expiry honest (mirrors `buildSignupGrant`). Pure: takes
 * `now`, does no I/O. S4f's Players UI calls this; S10 runs it server-side.
 *
 * `source: 'admin_grant'` with a null `purchaseId` — no money changed hands, so
 * it NEVER counts as revenue or credit liability (unlike a faked purchase, the
 * workaround this replaces). `trainingType` and `quantity` are the owner's choice;
 * expiry is CREDIT_EXPIRY_DAYS from `now`, the SAME 30-day rule as every other
 * credit (a comp doesn't buy extra time). `reason` is carried on the batch so the
 * grant is explicable later; omit it and it's null.
 */
export function buildAdminGrant(
  playerId: PlayerId,
  trainingType: TrainingType,
  quantity: number,
  now: IsoInstant,
  reason?: string,
): CreditBatch {
  return {
    id: newId(ID_PREFIXES.creditBatch) as CreditBatch['id'],
    playerId,
    source: 'admin_grant',
    purchaseId: null,
    trainingType,
    quantityTotal: quantity,
    quantityRemaining: quantity,
    expiresAt: expiryFrom(now),
    createdAt: now,
    note: reason ?? null,
  };
}

/**
 * The exact CreditBatch to insert when a purchase succeeds — the one and only
 * place the purchase-grant rule lives (mirrors `buildSignupGrant`). Pure: takes
 * `now`, does no I/O. S6 calls this SERVER-SIDE after the Paymob webhook verifies
 * payment — which is why it lives in @tpa/core, never in a screen.
 *
 * `source: 'purchase'` with a non-null `purchaseId` (the CreditBatch invariant);
 * trainingType and quantity come from the purchased package; expiry is
 * CREDIT_EXPIRY_DAYS from `now`, the same rule as signup grants.
 */
export function buildPurchaseCredits(
  playerId: PlayerId,
  purchaseId: PurchaseId,
  pkg: Package,
  now: IsoInstant,
): CreditBatch {
  return {
    id: newId(ID_PREFIXES.creditBatch) as CreditBatch['id'],
    playerId,
    source: 'purchase',
    purchaseId,
    trainingType: pkg.trainingType,
    quantityTotal: pkg.sessionCount,
    quantityRemaining: pkg.sessionCount,
    expiresAt: expiryFrom(now),
    createdAt: now,
    note: null,
  };
}
