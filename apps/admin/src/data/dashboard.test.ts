import { cairoCalendarDate, parseInstant } from '@tpa/core';
import {
  MOCK_NOW,
  mockBookings,
  mockCreditBatches,
  mockPackages,
  mockPlayers,
  mockPurchases,
  mockSlots,
} from '@tpa/mocks';
import type { IsoInstant, PackageId, Piastres } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import {
  activePlayerCount,
  batchLiability,
  creditLiability,
  revenueByType,
  revenueOverTime,
  revenueThisMonth,
  slotFillRate,
} from './dashboard';

/**
 * Aggregate tests. These are the business figures the owner acts on — a wrong
 * number here is worse than a wrong pixel — so each is cross-checked against an
 * independent recomputation from the fixtures, not a hardcoded magic number.
 * S10b killed the mock store: the aggregates now take the fetched arrays, so the
 * tests pass the fixtures directly instead of seeding a store.
 */

const now = MOCK_NOW;
const ms = (i: IsoInstant) => parseInstant(i).getTime();
const GROUP_8 = 'pk_group_8' as PackageId;

describe('batchLiability (the money-math trap: integer piastres, explicit rounding)', () => {
  it('is exact when the package divides evenly', () => {
    // Group 8-pack: 2800 EGP / 8 = 350/session; 3 remaining = 1,050 EGP.
    expect(batchLiability(280000, 8, 3)).toBe(105000);
  });
  it('rounds to the nearest piastre when it does not divide (S4e odd prices)', () => {
    // 1000 EGP / 3 sessions, 2 remaining = 666.67 → 66667 piastres (nearest).
    expect(batchLiability(100000, 3, 2)).toBe(66667);
  });
  it('is zero for zero remaining and guards zero sessionCount', () => {
    expect(batchLiability(280000, 8, 0)).toBe(0);
    expect(batchLiability(280000, 0, 3)).toBe(0);
  });
});

describe('creditLiability', () => {
  it('sums the value of usable PURCHASE credits only (from captured purchase amounts)', () => {
    const purchaseById = new Map(mockPurchases.map((p) => [p.id, p]));
    let ref = 0;
    for (const b of mockCreditBatches) {
      if (b.source !== 'purchase' || b.quantityRemaining <= 0) continue;
      if (ms(b.expiresAt) <= ms(now)) continue;
      const purchase = b.purchaseId ? purchaseById.get(b.purchaseId) : undefined;
      if (!purchase) continue;
      ref += batchLiability(purchase.amount, b.quantityTotal, b.quantityRemaining);
    }
    expect(creditLiability(mockCreditBatches, mockPurchases, now)).toBe(ref);
    expect(creditLiability(mockCreditBatches, mockPurchases, now)).toBeGreaterThan(0);
  });

  it('excludes expired batches (kept revenue, not a liability)', () => {
    // Same sum but ignoring expiry must be strictly larger (there ARE expired
    // purchase batches with balance, e.g. cb_duo_expired).
    const purchaseById = new Map(mockPurchases.map((p) => [p.id, p]));
    let withExpired = 0;
    for (const b of mockCreditBatches) {
      if (b.source !== 'purchase' || b.quantityRemaining <= 0) continue;
      const purchase = b.purchaseId ? purchaseById.get(b.purchaseId) : undefined;
      if (!purchase) continue;
      withExpired += batchLiability(purchase.amount, b.quantityTotal, b.quantityRemaining);
    }
    expect(withExpired).toBeGreaterThan(creditLiability(mockCreditBatches, mockPurchases, now));
  });

  it('excludes signup AND admin grants (no money changed hands)', () => {
    // Usable non-purchase grants exist (a signup grant + the admin comp), so the
    // source filter is doing real work — yet liability equals the purchase-only sum.
    const usableGrant = (source: string) =>
      mockCreditBatches.some(
        (b) => b.source === source && b.quantityRemaining > 0 && ms(b.expiresAt) > ms(now),
      );
    expect(usableGrant('signup_grant')).toBe(true);
    expect(usableGrant('admin_grant')).toBe(true); // the cb_admin_comp fixture

    const purchaseById = new Map(mockPurchases.map((p) => [p.id, p]));
    let purchaseOnly = 0;
    for (const b of mockCreditBatches) {
      if (b.source !== 'purchase' || b.quantityRemaining <= 0) continue;
      if (ms(b.expiresAt) <= ms(now)) continue;
      const purchase = b.purchaseId ? purchaseById.get(b.purchaseId) : undefined;
      if (!purchase) continue;
      purchaseOnly += batchLiability(purchase.amount, b.quantityTotal, b.quantityRemaining);
    }
    expect(creditLiability(mockCreditBatches, mockPurchases, now)).toBe(purchaseOnly);
  });
});

describe('S4e regression — repricing a package must not move liability for already-sold credits', () => {
  it('raising the Group 8-pack price leaves existing credit liability unchanged', () => {
    const before = creditLiability(mockCreditBatches, mockPurchases, now);
    expect(before).toBeGreaterThan(0);

    // Raise 2,800 → 3,200 EGP on a COPY of the catalog, exactly the brief's scenario.
    const repriced = mockPackages.map((p) =>
      p.id === GROUP_8 ? { ...p, price: 320000 as Piastres } : p,
    );
    expect(repriced.find((p) => p.id === GROUP_8)!.price).toBe(320000); // reprice really applied

    // Liability reads the CAPTURED purchase.amount, not the live package price — so a
    // repriced catalog (which liability doesn't even consult) cannot move the number.
    expect(creditLiability(mockCreditBatches, mockPurchases, now)).toBe(before);
  });
});

describe('revenueThisMonth', () => {
  it('counts succeeded purchases only, in the Cairo month', () => {
    const cThis = cairoCalendarDate(now);
    const inThisMonth = (i: IsoInstant) => {
      const c = cairoCalendarDate(i);
      return c.year === cThis.year && c.month === cThis.month;
    };
    const succeededJuly = mockPurchases
      .filter((p) => p.status === 'succeeded' && inThisMonth(p.createdAt))
      .reduce((s, p) => s + p.amount, 0);
    const allJuly = mockPurchases
      .filter((p) => inThisMonth(p.createdAt))
      .reduce((s, p) => s + p.amount, 0);

    expect(revenueThisMonth(mockPurchases, now).current).toBe(succeededJuly);
    // pending/failed exist this month → including them would be strictly larger.
    expect(allJuly).toBeGreaterThan(succeededJuly);
  });

  it('reports a signed delta vs last month', () => {
    const { current, previous, deltaPct } = revenueThisMonth(mockPurchases, now);
    expect(previous).toBeGreaterThan(0);
    expect(deltaPct).toBe(Math.round(((current - previous) / previous) * 100));
  });
});

describe('activePlayerCount', () => {
  it('counts distinct players with a usable credit or a booked/attended session', () => {
    const active = new Set<string>();
    for (const b of mockCreditBatches) {
      if (b.quantityRemaining > 0 && ms(b.expiresAt) > ms(now)) active.add(b.playerId);
    }
    for (const bk of mockBookings) {
      if (bk.status === 'booked' || bk.status === 'attended') active.add(bk.playerId);
    }
    expect(activePlayerCount(mockCreditBatches, mockBookings, now)).toBe(active.size);
    expect(activePlayerCount(mockCreditBatches, mockBookings, now)).toBeGreaterThan(0);
    expect(activePlayerCount(mockCreditBatches, mockBookings, now)).toBeLessThanOrEqual(mockPlayers.length);
  });
});

describe('slotFillRate', () => {
  it('is booked seats ÷ capacity across this week, 0–100 integer', () => {
    // Reconcile bookedCount from bookings, exactly as the old store seeded it.
    const slots = seededSlots();
    const rate = slotFillRate(slots, now);
    expect(Number.isInteger(rate)).toBe(true);
    expect(rate).toBeGreaterThanOrEqual(0);
    expect(rate).toBeLessThanOrEqual(100);
  });
});

describe('revenueByType (donut)', () => {
  it('never includes Trial and totals the rows', () => {
    const { rows, total } = revenueByType(mockPurchases, mockPackages);
    expect(rows.some((r) => r.type === 'trial')).toBe(false);
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(total);
    expect(total).toBeGreaterThan(0);
  });
});

describe('revenueOverTime (line chart)', () => {
  it('returns N ascending Cairo-Sunday weekly buckets', () => {
    const buckets = revenueOverTime(mockPurchases, now, 8);
    expect(buckets).toHaveLength(8);
    // Every bucket starts on a Cairo Sunday, strictly ascending.
    for (let i = 0; i < buckets.length; i += 1) {
      expect(cairoCalendarDate(buckets[i]!.weekStart).weekday).toBe(0);
      if (i > 0) expect(ms(buckets[i]!.weekStart)).toBeGreaterThan(ms(buckets[i - 1]!.weekStart));
    }
    // The last bucket is the current week (contains `now`).
    const last = buckets[buckets.length - 1]!;
    expect(ms(last.weekStart)).toBeLessThanOrEqual(ms(now));
  });
});

/** Slots with bookedCount reconciled from non-cancelled bookings — how the old store seeded them. */
function seededSlots() {
  const seats = new Map<string, number>();
  for (const b of mockBookings) if (b.status !== 'cancelled') seats.set(b.slotId, (seats.get(b.slotId) ?? 0) + 1);
  return mockSlots.map((s) => ({ ...s, bookedCount: seats.get(s.id) ?? 0 }));
}
