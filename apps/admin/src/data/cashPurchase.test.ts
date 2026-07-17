import { CREDIT_EXPIRY_DAYS, cashPurchaseHasNoGatewayRefs } from '@tpa/core';
import { MOCK_NOW, mockCurrentPlayer } from '@tpa/mocks';
import type { PackageId, Piastres, PlayerId } from '@tpa/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { recordCashPurchase } from './cashPurchase';
import { batchLiability, creditLiability, revenueThisMonth } from './dashboard';
import { grantCredits } from './grant';
import { __resetStoreForTests, getBatches, getPurchases } from './store';

const player = mockCurrentPlayer.id;
const GROUP_8 = 'pk_group_8' as PackageId; // 2,800 EGP · 8 sessions
const egp = (n: number) => (n * 100) as Piastres;

beforeEach(() => __resetStoreForTests());

describe('recordCashPurchase — a cash sale is an ordinary purchase', () => {
  it('grants normal purchase-backed credits (source purchase, real purchaseId, 30-day expiry)', () => {
    const res = recordCashPurchase(player, GROUP_8, egp(2800), MOCK_NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { batch, purchase } = res;
    expect(batch.source).toBe('purchase');
    expect(batch.purchaseId).toBe(purchase.id); // not a grant
    expect(batch.trainingType).toBe('group');
    expect(batch.quantityTotal).toBe(8);
    expect(batch.quantityRemaining).toBe(8);
    expect(new Date(batch.expiresAt).getTime() - new Date(MOCK_NOW).getTime()).toBe(
      CREDIT_EXPIRY_DAYS * 86_400_000, // no extra time — same as any credit
    );
    expect(getPurchases().some((p) => p.id === purchase.id)).toBe(true);
    expect(getBatches().some((b) => b.id === batch.id)).toBe(true);
  });

  it('carries NO gateway references (there is no gateway)', () => {
    const res = recordCashPurchase(player, GROUP_8, egp(2800), MOCK_NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.purchase.paymentMethod).toBe('cash');
    expect(res.purchase.status).toBe('succeeded');
    expect(res.purchase.gatewayOrderId).toBe(null);
    expect(res.purchase.gatewayTransactionId).toBe(null);
    expect(cashPurchaseHasNoGatewayRefs(res.purchase)).toBe(true);
  });

  it('counts toward BOTH revenue and liability — unlike a grant, which counts toward neither', () => {
    const revBefore = revenueThisMonth(MOCK_NOW).current;
    const liaBefore = creditLiability(MOCK_NOW);

    // A comp of the same size moves neither figure...
    grantCredits(player, 'group', 8, 'goodwill', MOCK_NOW);
    expect(revenueThisMonth(MOCK_NOW).current).toBe(revBefore);
    expect(creditLiability(MOCK_NOW)).toBe(liaBefore);

    // ...but a cash sale moves both.
    const res = recordCashPurchase(player, GROUP_8, egp(2800), MOCK_NOW);
    expect(res.ok).toBe(true);
    expect(revenueThisMonth(MOCK_NOW).current).toBe((revBefore + egp(2800)) as Piastres);
    expect(creditLiability(MOCK_NOW)).toBe((liaBefore + egp(2800)) as Piastres); // 8/8 remaining × 2,800
  });

  it('a discount is captured — liability follows what was paid, not the list price', () => {
    const liaBefore = creditLiability(MOCK_NOW);
    const paid = egp(2600); // 200 below list
    const res = recordCashPurchase(player, GROUP_8, paid, MOCK_NOW);
    expect(res.ok).toBe(true);
    // Liability rose by the DISCOUNTED amount (2,600), not the catalog price (2,800).
    expect(creditLiability(MOCK_NOW)).toBe((liaBefore + batchLiability(paid, 8, 8)) as Piastres);
    expect(creditLiability(MOCK_NOW)).not.toBe((liaBefore + egp(2800)) as Piastres);
  });

  it('validates player, package, and a positive amount', () => {
    expect(recordCashPurchase('pl_nope' as PlayerId, GROUP_8, egp(2800), MOCK_NOW).ok ? null : 'p').toBe('p');
    const noPkg = recordCashPurchase(player, 'pk_nope' as PackageId, egp(2800), MOCK_NOW);
    expect(noPkg.ok ? null : noPkg.reason).toBe('package_missing');
    const zero = recordCashPurchase(player, GROUP_8, 0 as Piastres, MOCK_NOW);
    expect(zero.ok ? null : zero.reason).toBe('amount_below_one');
  });
});
