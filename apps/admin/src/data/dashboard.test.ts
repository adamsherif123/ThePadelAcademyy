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
import type { Booking, CreditBatch, IsoInstant, LocationId, PackageId, Piastres, Purchase } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import {
  atLocation,
  activePlayerCount,
  activePlayersAtLocation,
  purchasesWithin,
  batchLiability,
  creditLiability,
  recentPurchases,
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
  it('counts COLLECTED (succeeded AND paid) purchases only, in the Cairo month', () => {
    const cThis = cairoCalendarDate(now);
    const inThisMonth = (i: IsoInstant) => {
      const c = cairoCalendarDate(i);
      return c.year === cThis.year && c.month === cThis.month;
    };
    const succeededJuly = mockPurchases
      .filter((p) => p.status === 'succeeded' && p.paid && inThisMonth(p.createdAt))
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

describe('activePlayersAtLocation', () => {
  // Two branches, and four players who each exist at exactly one of them in
  // exactly one way. Hand-built rather than from @tpa/mocks, because every mock
  // row sits at MOCK_LOCATION_ID — a single-branch fixture cannot fail the bug
  // this test exists for.
  const ORO = 'loc_oro' as LocationId;
  const S7A = 'loc_s7a' as LocationId;
  const soon = '2026-12-01T00:00:00.000Z' as IsoInstant;

  const batch = (playerId: string, locationId: LocationId): CreditBatch =>
    ({
      id: `cb_${playerId}`,
      playerId,
      locationId,
      trainingType: 'duo',
      quantityTotal: 4,
      quantityRemaining: 4,
      expiresAt: soon,
      source: 'admin_grant',
    }) as unknown as CreditBatch;

  const booking = (playerId: string, locationId: LocationId): Booking =>
    ({
      id: `bk_${playerId}`,
      playerId,
      locationId,
      slotId: `ss_${playerId}`,
      status: 'booked',
    }) as unknown as Booking;

  const batches = [batch('p_credit_oro', ORO), batch('p_credit_s7a', S7A)];
  const bookings = [booking('p_booked_oro', ORO), booking('p_booked_s7a', S7A)];

  it('counts only the players active at the branch asked for', () => {
    expect(activePlayersAtLocation(batches, bookings, ORO, MOCK_NOW)).toBe(2);
    expect(activePlayersAtLocation(batches, bookings, S7A, MOCK_NOW)).toBe(2);
  });

  it('does not let a booking at the OTHER branch inflate this one', () => {
    // The bug: bookings went in unfiltered, so each branch inherited every
    // branch's bookers and read 3 instead of 2.
    expect(activePlayerCount(atLocation(batches, ORO), bookings, MOCK_NOW)).toBe(3);
    expect(activePlayersAtLocation(batches, bookings, ORO, MOCK_NOW)).toBe(2);
  });

  it("counts a player once when they are active at a branch in both ways", () => {
    const both = [...batches, batch('p_booked_oro', ORO)];
    expect(activePlayersAtLocation(both, bookings, ORO, MOCK_NOW)).toBe(2);
  });

  it("'all' spans every branch, and is a union rather than a sum", () => {
    expect(activePlayersAtLocation(batches, bookings, 'all', MOCK_NOW)).toBe(4);
  });

  it('agrees with the unscoped count when every row is at one branch', () => {
    expect(activePlayersAtLocation(mockCreditBatches, mockBookings, 'all', MOCK_NOW)).toBe(
      activePlayerCount(mockCreditBatches, mockBookings, MOCK_NOW),
    );
  });
});

describe('purchasesWithin — the month-only slice of a two-month window', () => {
  /**
   * The Dashboard fetches the selected month AND the one before it, because the
   * revenue delta and the trailing chart both need it. Everything that is about
   * the month alone then has to cut the window back down, or August's sales appear
   * under September's "what earns" donut and in September's latest-sales list —
   * a figure that is wrong rather than missing, and attributed to a month the user
   * explicitly asked about.
   */
  const SEP_START = '2026-09-01T00:00:00.000Z' as IsoInstant;
  const OCT_START = '2026-10-01T00:00:00.000Z' as IsoInstant;
  const NOV_START = '2026-11-01T00:00:00.000Z' as IsoInstant;

  const buy = (id: string, createdAt: string): Purchase =>
    ({
      id,
      createdAt: createdAt as IsoInstant,
      status: 'succeeded',
      paid: true,
      amount: 1000,
      locationId: 'loc_oro',
      packageId: 'pkg_1',
    }) as unknown as Purchase;

  const window2 = [
    buy('sep_early', '2026-09-02T10:00:00.000Z'),
    buy('sep_late', '2026-09-28T10:00:00.000Z'),
    buy('oct_one', '2026-10-05T10:00:00.000Z'),
    buy('oct_two', '2026-10-20T10:00:00.000Z'),
  ];

  it('keeps only what falls inside the range', () => {
    expect(purchasesWithin(window2, OCT_START, NOV_START).map((p) => p.id)).toEqual(['oct_one', 'oct_two']);
    expect(purchasesWithin(window2, SEP_START, OCT_START).map((p) => p.id)).toEqual(['sep_early', 'sep_late']);
  });

  it('is half-open: the boundary instant belongs to the later month only', () => {
    const onTheSeam = [buy('seam', '2026-10-01T00:00:00.000Z')];
    expect(purchasesWithin(onTheSeam, SEP_START, OCT_START)).toHaveLength(0);
    expect(purchasesWithin(onTheSeam, OCT_START, NOV_START)).toHaveLength(1);
  });

  it('partitions the window — every purchase lands in exactly one month', () => {
    const sep = purchasesWithin(window2, SEP_START, OCT_START);
    const oct = purchasesWithin(window2, OCT_START, NOV_START);
    expect(sep.length + oct.length).toBe(window2.length);
    expect(sep.filter((p) => oct.includes(p))).toHaveLength(0);
  });
});

describe('the month aggregates, driven by a chosen month rather than now', () => {
  // revenueThisMonth takes an INSTANT and derives "its" month from it, which is
  // what lets the picker drive it without the function knowing a picker exists.
  const buy = (id: string, createdAt: string, amount = 1000): Purchase =>
    ({
      id,
      createdAt: createdAt as IsoInstant,
      status: 'succeeded',
      paid: true,
      amount,
      locationId: 'loc_oro',
      packageId: 'pkg_1',
    }) as unknown as Purchase;

  const window2 = [
    buy('aug', '2026-08-15T10:00:00.000Z', 500),
    buy('sep_a', '2026-09-10T10:00:00.000Z', 1000),
    buy('sep_b', '2026-09-20T10:00:00.000Z', 1000),
  ];

  it('reports the chosen month as current and the one before it as previous', () => {
    const r = revenueThisMonth(window2, '2026-09-01T00:00:00.000Z' as IsoInstant);
    expect(r.current).toBe(2000);
    expect(r.previous).toBe(500);
    expect(r.deltaPct).toBe(300);
  });

  it('gives the same answer from any instant inside the month', () => {
    const first = revenueThisMonth(window2, '2026-09-01T00:00:00.000Z' as IsoInstant);
    const middle = revenueThisMonth(window2, '2026-09-17T13:45:00.000Z' as IsoInstant);
    expect(middle).toEqual(first);
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

describe('paid gating — revenue counts only money the academy has COLLECTED', () => {
  const cThis = cairoCalendarDate(now);
  const inThisMonth = (i: IsoInstant) => {
    const c = cairoCalendarDate(i);
    return c.year === cThis.year && c.month === cThis.month;
  };
  const allUnpaid = mockPurchases.map((p) => ({ ...p, paid: false }));

  it('an unpaid purchase is excluded from this month’s revenue, by exactly its amount', () => {
    const target = mockPurchases.find((p) => p.status === 'succeeded' && p.paid && inThisMonth(p.createdAt));
    expect(target).toBeDefined();
    const withOneUnpaid = mockPurchases.map((p) => (p.id === target!.id ? { ...p, paid: false } : p));
    expect(revenueThisMonth(withOneUnpaid, now).current).toBe(
      revenueThisMonth(mockPurchases, now).current - target!.amount,
    );
  });

  it('marking it paid again restores the figure — the toggle is symmetric', () => {
    const target = mockPurchases.find((p) => p.status === 'succeeded' && p.paid && inThisMonth(p.createdAt))!;
    const off = mockPurchases.map((p) => (p.id === target.id ? { ...p, paid: false } : p));
    const back = off.map((p) => (p.id === target.id ? { ...p, paid: true } : p));
    expect(revenueThisMonth(back, now).current).toBe(revenueThisMonth(mockPurchases, now).current);
  });

  it('with nothing collected, ALL three revenue figures are zero', () => {
    expect(revenueThisMonth(allUnpaid, now).current).toBe(0);
    expect(revenueThisMonth(allUnpaid, now).previous).toBe(0);
    expect(revenueByType(allUnpaid, mockPackages).total).toBe(0);
    expect(revenueByType(allUnpaid, mockPackages).rows).toHaveLength(0);
    expect(revenueOverTime(allUnpaid, now, 8).every((b) => b.revenue === 0)).toBe(true);
  });

  it('credit liability is NOT paid-gated — granted credits are owed whether or not the money came in', () => {
    expect(creditLiability(mockCreditBatches, allUnpaid, now)).toBe(
      creditLiability(mockCreditBatches, mockPurchases, now),
    );
  });

  it('the recent-purchases feed still lists unpaid sales (the row marks them)', () => {
    const recent = recentPurchases(allUnpaid, 4);
    expect(recent).toHaveLength(recentPurchases(mockPurchases, 4).length);
    expect(recent.every((p) => !p.paid)).toBe(true);
  });
});

describe('atLocation', () => {
  const rows = [
    { locationId: 'loc_a' as LocationId, n: 1 },
    { locationId: 'loc_b' as LocationId, n: 2 },
    { locationId: 'loc_a' as LocationId, n: 3 },
  ];

  it('narrows to one branch', () => {
    expect(atLocation(rows, 'loc_a' as LocationId).map((r) => r.n)).toEqual([1, 3]);
  });

  it("'all' keeps everything — the Dashboard's default is the whole academy", () => {
    expect(atLocation(rows, 'all')).toHaveLength(3);
  });

  it('returns a copy, never the caller’s array', () => {
    expect(atLocation(rows, 'all')).not.toBe(rows);
  });

  it('is empty for a branch with nothing', () => {
    expect(atLocation(rows, 'loc_zzz' as LocationId)).toEqual([]);
  });

  // The property that matters most: revenue is computed from the FILTERED list,
  // and revenueThisMonth's succeeded-AND-paid rule keeps a failed-but-paid row out
  // at every branch. 068 created such rows for captured-but-undeliverable money;
  // 071 removed that feature, but `paid` can still be true on a failed row and the
  // rule that excludes it is the one being asserted.
  it('cannot smuggle a failed-but-paid payment into a branch’s revenue', () => {
    const failedButPaid = {
      ...mockPurchases[0]!,
      status: 'failed' as const,
      paid: true,
      locationId: 'loc_a' as LocationId,
    };
    const scoped = atLocation([failedButPaid], 'loc_a' as LocationId);
    expect(revenueThisMonth(scoped, MOCK_NOW).current).toBe(0);
  });
});
