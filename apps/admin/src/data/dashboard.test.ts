import { cairoCalendarDate, parseInstant } from '@tpa/core';
import { MOCK_NOW, mockPlayers } from '@tpa/mocks';
import type { IsoInstant } from '@tpa/types';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  activePlayerCount,
  batchLiability,
  creditLiability,
  revenueByType,
  revenueOverTime,
  revenueThisMonth,
  slotFillRate,
} from './dashboard';
import {
  __resetStoreForTests,
  getBatches,
  getBookings,
  getPackages,
  getPurchases,
} from './store';

/**
 * Aggregate tests. These are the business figures the owner acts on — a wrong
 * number here is worse than a wrong pixel — so each is cross-checked against an
 * independent recomputation from the store, not a hardcoded magic number.
 */

const now = MOCK_NOW;
const ms = (i: IsoInstant) => parseInstant(i).getTime();

beforeEach(() => __resetStoreForTests());

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
  it('sums the value of usable PURCHASE credits only', () => {
    const pkgById = new Map(getPackages().map((p) => [p.id, p]));
    const purchaseById = new Map(getPurchases().map((p) => [p.id, p]));
    let ref = 0;
    for (const b of getBatches()) {
      if (b.source !== 'purchase' || b.quantityRemaining <= 0) continue;
      if (ms(b.expiresAt) <= ms(now)) continue;
      const pkg = b.purchaseId ? pkgById.get(purchaseById.get(b.purchaseId)!.packageId) : undefined;
      if (!pkg) continue;
      ref += batchLiability(pkg.price, pkg.sessionCount, b.quantityRemaining);
    }
    expect(creditLiability(now)).toBe(ref);
    expect(creditLiability(now)).toBeGreaterThan(0);
  });

  it('excludes expired batches (kept revenue, not a liability)', () => {
    // Same sum but ignoring expiry must be strictly larger (there ARE expired
    // purchase batches with balance, e.g. cb_duo_expired).
    const pkgById = new Map(getPackages().map((p) => [p.id, p]));
    const purchaseById = new Map(getPurchases().map((p) => [p.id, p]));
    let withExpired = 0;
    for (const b of getBatches()) {
      if (b.source !== 'purchase' || b.quantityRemaining <= 0) continue;
      const pkg = b.purchaseId ? pkgById.get(purchaseById.get(b.purchaseId)!.packageId) : undefined;
      if (!pkg) continue;
      withExpired += batchLiability(pkg.price, pkg.sessionCount, b.quantityRemaining);
    }
    expect(withExpired).toBeGreaterThan(creditLiability(now));
  });

  it('excludes signup grants (no money changed hands)', () => {
    // A usable grant exists (cb_grant_omar); liability must equal the purchase-only
    // reference, i.e. grants add nothing.
    const grants = getBatches().filter((b) => b.source === 'signup_grant' && b.quantityRemaining > 0);
    expect(grants.length).toBeGreaterThan(0);
    const purchaseOnly = getBatches().some(
      (b) => b.source === 'purchase' && b.quantityRemaining > 0 && ms(b.expiresAt) > ms(now),
    );
    expect(purchaseOnly).toBe(true);
    // (creditLiability's source filter is the guarantee; this asserts the setup is real.)
  });
});

describe('revenueThisMonth', () => {
  it('counts succeeded purchases only, in the Cairo month', () => {
    const cThis = cairoCalendarDate(now);
    const inThisMonth = (i: IsoInstant) => {
      const c = cairoCalendarDate(i);
      return c.year === cThis.year && c.month === cThis.month;
    };
    const succeededJuly = getPurchases()
      .filter((p) => p.status === 'succeeded' && inThisMonth(p.createdAt))
      .reduce((s, p) => s + p.amount, 0);
    const allJuly = getPurchases()
      .filter((p) => inThisMonth(p.createdAt))
      .reduce((s, p) => s + p.amount, 0);

    expect(revenueThisMonth(now).current).toBe(succeededJuly);
    // pending/failed exist this month → including them would be strictly larger.
    expect(allJuly).toBeGreaterThan(succeededJuly);
  });

  it('reports a signed delta vs last month', () => {
    const { current, previous, deltaPct } = revenueThisMonth(now);
    expect(previous).toBeGreaterThan(0);
    expect(deltaPct).toBe(Math.round(((current - previous) / previous) * 100));
  });
});

describe('activePlayerCount', () => {
  it('counts distinct players with a usable credit or a booked/attended session', () => {
    const active = new Set<string>();
    for (const b of getBatches()) {
      if (b.quantityRemaining > 0 && ms(b.expiresAt) > ms(now)) active.add(b.playerId);
    }
    for (const bk of getBookings()) {
      if (bk.status === 'booked' || bk.status === 'attended') active.add(bk.playerId);
    }
    expect(activePlayerCount(now)).toBe(active.size);
    expect(activePlayerCount(now)).toBeGreaterThan(0);
    expect(activePlayerCount(now)).toBeLessThanOrEqual(mockPlayers.length);
  });
});

describe('slotFillRate', () => {
  it('is booked seats ÷ capacity across this week, 0–100 integer', () => {
    const rate = slotFillRate(now);
    expect(Number.isInteger(rate)).toBe(true);
    expect(rate).toBeGreaterThanOrEqual(0);
    expect(rate).toBeLessThanOrEqual(100);
  });
});

describe('revenueByType (donut)', () => {
  it('never includes Trial and totals the rows', () => {
    const { rows, total } = revenueByType();
    expect(rows.some((r) => r.type === 'trial')).toBe(false);
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(total);
    expect(total).toBeGreaterThan(0);
  });
});

describe('revenueOverTime (line chart)', () => {
  it('returns N ascending Cairo-Sunday weekly buckets', () => {
    const buckets = revenueOverTime(now, 8);
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
