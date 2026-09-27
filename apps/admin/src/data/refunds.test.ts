import type { IsoInstant, LocationId, PackageId, Piastres, PlayerId, Purchase, PurchaseId } from '@tpa/types';
import { describe, expect, it, vi } from 'vitest';

// Same import guard as locations.test.ts: these are the pure helpers, but the
// module reaches lib/api → lib/supabase, whose env check throws under node.
vi.mock('../lib/supabase', () => ({ supabase: {} }));

import type { MarkRefundedReason, RefundRow } from '../lib/api';
import { daysOutstanding, isRefundOutstanding, isRefunded, outstandingTotal, REFUND_ERROR } from './refunds';

const NOW = '2026-09-27T12:00:00.000Z' as IsoInstant;

const purchase = (over: Partial<Purchase> = {}): Purchase => ({
  id: 'pu_1' as PurchaseId,
  playerId: 'pl_1' as PlayerId,
  locationId: 'loc_oro' as LocationId,
  packageId: 'pk_1' as PackageId,
  status: 'failed',
  amount: 5000 as Piastres,
  createdAt: NOW,
  paymentMethod: 'paymob',
  gatewayOrderId: 'ord_1',
  gatewayTransactionId: 'txn_1',
  paid: true,
  refundRequiredAt: '2026-09-20T12:00:00.000Z' as IsoInstant,
  refundedAt: null,
  ...over,
});

const row = (p: Purchase): RefundRow => ({ purchase: p, player: undefined, pkg: undefined });

describe('isRefundOutstanding / isRefunded', () => {
  it('an ordinary failed purchase is neither — status alone never decides', () => {
    const declined = purchase({ refundRequiredAt: null, paid: false });
    expect(isRefundOutstanding(declined)).toBe(false);
    expect(isRefunded(declined)).toBe(false);
  });

  it('captured-and-not-yet-given-back is outstanding', () => {
    expect(isRefundOutstanding(purchase())).toBe(true);
    expect(isRefunded(purchase())).toBe(false);
  });

  it('once recorded it flips, and the status is STILL failed', () => {
    const done = purchase({ refundedAt: NOW });
    expect(isRefundOutstanding(done)).toBe(false);
    expect(isRefunded(done)).toBe(true);
    expect(done.status).toBe('failed');
  });

  // The whole reason 068 exists: a succeeded purchase can never be in this queue.
  it('a succeeded purchase is never in the queue', () => {
    expect(isRefundOutstanding(purchase({ status: 'succeeded', refundRequiredAt: null }))).toBe(false);
  });
});

describe('outstandingTotal', () => {
  it('sums only what is still owed', () => {
    const rows = [row(purchase()), row(purchase({ id: 'pu_2' as PurchaseId, refundedAt: NOW }))];
    expect(outstandingTotal(rows)).toBe(5000);
  });

  it('is zero for an empty queue', () => {
    expect(outstandingTotal([])).toBe(0);
  });
});

describe('daysOutstanding', () => {
  it('counts whole days since the charge', () => {
    expect(daysOutstanding(purchase(), NOW)).toBe(7);
  });

  it('is 0 on the day it happened, never negative', () => {
    expect(daysOutstanding(purchase({ refundRequiredAt: NOW }), NOW)).toBe(0);
    const future = purchase({ refundRequiredAt: '2026-10-01T00:00:00.000Z' as IsoInstant });
    expect(daysOutstanding(future, NOW)).toBe(0);
  });

  it('is 0 when there is nothing owed', () => {
    expect(daysOutstanding(purchase({ refundRequiredAt: null }), NOW)).toBe(0);
  });
});

describe('REFUND_ERROR', () => {
  // The map is typed Record<MarkRefundedReason | 'network', string>, so this is
  // belt and braces — but it catches a reason added with an empty string.
  it('has real copy for every reason the RPC can return', () => {
    const reasons: (MarkRefundedReason | 'network')[] = [
      'not_admin', 'reason_required', 'purchase_missing', 'not_refund_required', 'already_refunded', 'network',
    ];
    for (const r of reasons) {
      expect(REFUND_ERROR[r].length).toBeGreaterThan(10);
    }
  });

  it('never falls back to a generic shrug for a known reason', () => {
    expect(REFUND_ERROR.already_refunded).not.toBe(REFUND_ERROR.network);
    expect(REFUND_ERROR.not_refund_required).not.toBe(REFUND_ERROR.network);
  });
});
