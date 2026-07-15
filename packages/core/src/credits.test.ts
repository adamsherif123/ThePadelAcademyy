import type { CreditBatch, IsoInstant, PlayerId } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import { CREDIT_EXPIRY_DAYS, EXPIRING_SOON_DAYS, SIGNUP_TRIAL_CREDITS } from './constants';
import { buildSignupGrant, creditExpiryState, isPurchaseBacked } from './credits';

const NOW = '2026-07-15T09:00:00.000Z' as IsoInstant;
const PLAYER = 'pl_test' as PlayerId;

const daysFrom = (n: number) =>
  new Date(new Date(NOW).getTime() + n * 86_400_000).toISOString() as IsoInstant;

describe('creditExpiryState', () => {
  it('classifies expired, expiring_soon, and ok by the EXPIRING_SOON_DAYS window', () => {
    expect(creditExpiryState(daysFrom(-1), NOW)).toBe('expired');
    expect(creditExpiryState(NOW, NOW)).toBe('expired'); // exact boundary is expired
    expect(creditExpiryState(daysFrom(2), NOW)).toBe('expiring_soon');
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
