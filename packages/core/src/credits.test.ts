import type { CreditBatch, IsoInstant, Package, PackageId, PlayerId, PurchaseId } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import { CREDIT_EXPIRY_DAYS, EXPIRING_SOON_DAYS, SIGNUP_TRIAL_CREDITS } from './constants';
import {
  buildPurchaseCredits,
  buildSignupGrant,
  creditExpiryState,
  isPurchaseBacked,
} from './credits';

const NOW = '2026-07-15T09:00:00.000Z' as IsoInstant;
const PLAYER = 'pl_test' as PlayerId;

const pkg = (over: Partial<Package> = {}): Package => ({
  id: 'pk_group_8' as PackageId,
  trainingType: 'group',
  sessionCount: 8,
  price: 280000 as Package['price'],
  name: 'Group · 8 Sessions',
  isActive: true,
  ...over,
});

const daysFrom = (n: number) =>
  new Date(new Date(NOW).getTime() + n * 86_400_000).toISOString() as IsoInstant;

describe('creditExpiryState', () => {
  it('classifies expired, expiring_soon, and ok by the EXPIRING_SOON_DAYS (3-day) window', () => {
    expect(EXPIRING_SOON_DAYS).toBe(3); // the client's threshold — locks the value
    expect(creditExpiryState(daysFrom(-1), NOW)).toBe('expired');
    expect(creditExpiryState(NOW, NOW)).toBe('expired'); // exact boundary is expired
    expect(creditExpiryState(daysFrom(2), NOW)).toBe('expiring_soon');
    expect(creditExpiryState(daysFrom(3), NOW)).toBe('expiring_soon'); // at the boundary
    expect(creditExpiryState(daysFrom(4), NOW)).toBe('ok'); // just past → ok (was amber under 7)
    // Symbolic guard: the boundary tracks the constant, whatever it is set to.
    expect(creditExpiryState(daysFrom(EXPIRING_SOON_DAYS), NOW)).toBe('expiring_soon');
    expect(creditExpiryState(daysFrom(EXPIRING_SOON_DAYS + 1), NOW)).toBe('ok');
    expect(creditExpiryState(daysFrom(30), NOW)).toBe('ok');
  });
});

describe('buildSignupGrant', () => {
  const grant = buildSignupGrant(PLAYER, NOW);

  it('grants SIGNUP_TRIAL_CREDITS trial credits, unused', () => {
    expect(grant.trainingType).toBe('trial');
    expect(grant.quantityTotal).toBe(SIGNUP_TRIAL_CREDITS);
    expect(grant.quantityRemaining).toBe(SIGNUP_TRIAL_CREDITS);
    expect(SIGNUP_TRIAL_CREDITS).toBe(2); // current business value
  });

  it('is a signup grant with no purchase', () => {
    expect(grant.source).toBe('signup_grant');
    expect(grant.purchaseId).toBeNull();
    expect(isPurchaseBacked(grant)).toBe(false);
  });

  it('expires exactly CREDIT_EXPIRY_DAYS after now', () => {
    expect(grant.createdAt).toBe(NOW);
    const expected = new Date(
      new Date(NOW).getTime() + CREDIT_EXPIRY_DAYS * 86_400_000,
    ).toISOString();
    expect(grant.expiresAt).toBe(expected);
  });

  it('assigns a prefixed credit-batch id and belongs to the player', () => {
    expect(grant.id.startsWith('cb_')).toBe(true);
    expect(grant.playerId).toBe(PLAYER);
  });
});

describe('buildPurchaseCredits', () => {
  const PURCHASE = 'pu_test' as PurchaseId;
  const batch = buildPurchaseCredits(PLAYER, PURCHASE, pkg(), NOW);

  it('takes trainingType and quantity from the package, unused', () => {
    expect(batch.trainingType).toBe('group');
    expect(batch.quantityTotal).toBe(8);
    expect(batch.quantityRemaining).toBe(8);
    expect(buildPurchaseCredits(PLAYER, PURCHASE, pkg({ trainingType: 'duo', sessionCount: 4 }), NOW).quantityTotal).toBe(4);
  });

  it('satisfies the source invariant: purchase-backed with a non-null purchaseId', () => {
    expect(batch.source).toBe('purchase');
    expect(batch.purchaseId).toBe(PURCHASE);
    expect(batch.purchaseId).not.toBeNull();
    expect(isPurchaseBacked(batch)).toBe(true);
  });

  it('expires exactly CREDIT_EXPIRY_DAYS after now (same rule as grants)', () => {
    expect(batch.createdAt).toBe(NOW);
    const expected = new Date(new Date(NOW).getTime() + CREDIT_EXPIRY_DAYS * 86_400_000).toISOString();
    expect(batch.expiresAt).toBe(expected);
  });

  it('assigns a prefixed credit-batch id and belongs to the player', () => {
    expect(batch.id.startsWith('cb_')).toBe(true);
    expect(batch.playerId).toBe(PLAYER);
  });
});

describe('isPurchaseBacked', () => {
  it('narrows purchase-backed batches only', () => {
    const purchased = {
      source: 'purchase',
      purchaseId: 'pu_1',
    } as unknown as CreditBatch;
    const granted = buildSignupGrant(PLAYER, NOW);
    expect(isPurchaseBacked(purchased)).toBe(true);
    expect(isPurchaseBacked(granted)).toBe(false);
  });
});
