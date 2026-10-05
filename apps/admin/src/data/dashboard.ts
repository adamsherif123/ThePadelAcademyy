import {
  TRAINING_TYPES,
  addCairoDays,
  cairoCalendarDate,
  cairoMidnight,
  cairoWeekStart,
  formatDayMonth,
  parseInstant,
  type CairoDate,
} from '@tpa/core';
import type {
  Booking,
  CreditBatch,
  IsoInstant,
  Package,
  Piastres,
  Purchase,
  SessionSlot,
  TrainingType,
  LocationId,
} from '@tpa/types';

/**
 * Dashboard aggregates — pure functions of (fetched rows, …, now). S10b killed the
 * store, so each takes the array it reads instead of a store getter; the logic is
 * unchanged, so the KPIs are identical. Money stays in integer piastres (formatted
 * only at the edge, via @tpa/core). All date bucketing is in Africa/Cairo: a UTC
 * month/week boundary is 2–3 hours off and would misfile purchases at the edges.
 */

const DAY_MS = 86_400_000;
const ms = (i: IsoInstant): number => parseInstant(i).getTime();

function addMonths(d: CairoDate, delta: number): CairoDate {
  const idx = d.year * 12 + (d.month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1, day: 1 };
}

const monthStart = (now: IsoInstant): IsoInstant => {
  const c = cairoCalendarDate(now);
  return cairoMidnight({ year: c.year, month: c.month, day: 1 });
};

/**
 * Narrow a list to one branch, or leave it whole for ALL_LOCATIONS.
 *
 * The Dashboard filters its INPUTS rather than teaching each metric about
 * branches: every figure on the page then respects the filter by construction,
 * and none of the arithmetic below had to change. It also means a metric added
 * later is branch-aware for free instead of being a new place to forget.
 */
export function atLocation<T extends { locationId: LocationId }>(
  rows: readonly T[],
  locationId: LocationId | 'all',
): T[] {
  return locationId === 'all' ? [...rows] : rows.filter((r) => r.locationId === locationId);
}

const succeeded = (purchases: Purchase[]): Purchase[] => purchases.filter((p) => p.status === 'succeeded');
/**
 * REVENUE is money the academy has actually COLLECTED: succeeded AND paid. Every
 * revenue figure on the Dashboard goes through this one helper, so they can never
 * disagree about what counts. `succeeded` alone still backs the recent-purchases
 * feed, which lists sales whether or not they've been collected yet.
 */
const collected = (purchases: Purchase[]): Purchase[] => succeeded(purchases).filter((p) => p.paid);
const sumAmount = (purchases: readonly Purchase[]): Piastres =>
  purchases.reduce((s, p) => s + p.amount, 0) as Piastres;
const inRange = (i: IsoInstant, startMs: number, endMs: number): boolean =>
  ms(i) >= startMs && ms(i) < endMs;

/**
 * Do two instants fall on the same Cairo calendar day?
 *
 * Used to decide whether a purchase's collection date is worth showing next to
 * its sale date. Compared in Cairo, not UTC, because the admin reads these dates
 * in Cairo and a sale at 11pm paid at 1am the "same night" is two UTC days but
 * one working evening.
 */
export function isSameCairoDay(a: IsoInstant, b: IsoInstant): boolean {
  const x = cairoCalendarDate(a);
  const y = cairoCalendarDate(b);
  return x.year === y.year && x.month === y.month && x.day === y.day;
}

/**
 * Narrow purchases to a half-open [start, end) window.
 *
 * The Dashboard fetches the selected month AND the one before it, because the
 * revenue delta and the eight-week chart both reach back past the 1st. The figures
 * that are about the month ALONE — the type split, the latest sales — have to say
 * so, or they would quietly include the previous month that only came along for
 * the other two.
 */
export function purchasesWithin(purchases: Purchase[], start: IsoInstant, end: IsoInstant): Purchase[] {
  const a = ms(start);
  const b = ms(end);
  return purchases.filter((p) => inRange(p.revenueAt, a, b));
}

// --- KPI 1: revenue this Cairo month vs last — COLLECTED only (succeeded AND paid) ---
export interface RevenueMonth {
  current: Piastres;
  previous: Piastres;
  deltaPct: number | null;
}

export function revenueThisMonth(purchases: Purchase[], now: IsoInstant): RevenueMonth {
  const cThis = cairoCalendarDate(now);
  const start = ms(monthStart(now));
  const next = ms(cairoMidnight(addMonths({ year: cThis.year, month: cThis.month, day: 1 }, 1)));
  const prev = ms(cairoMidnight(addMonths({ year: cThis.year, month: cThis.month, day: 1 }, -1)));
  const paid = collected(purchases);
  // revenueAt, not createdAt (072): a request approved on 30 September and paid
  // on 1 October is October's money. Bucketing on the sale date credited a month
  // that had already closed with cash the academy had not yet been given.
  const current = sumAmount(paid.filter((p) => inRange(p.revenueAt, start, next)));
  const previous = sumAmount(paid.filter((p) => inRange(p.revenueAt, prev, start)));
  const deltaPct = previous === 0 ? null : Math.round(((current - previous) / previous) * 100);
  return { current, previous, deltaPct };
}

// --- KPI 2: active players (usable credit OR a booked/attended session) ---
/**
 * Both lists must already be about the SAME branch. Call activePlayersAtLocation
 * rather than this directly — see the note there for what went wrong when a call
 * site filtered one of them and not the other.
 */
export function activePlayerCount(batches: CreditBatch[], bookings: Booking[], now: IsoInstant): number {
  const active = new Set<string>();
  const nowMs = ms(now);
  for (const b of batches) {
    if (b.quantityRemaining > 0 && ms(b.expiresAt) > nowMs) active.add(b.playerId);
  }
  for (const bk of bookings) {
    if (bk.status === 'booked' || bk.status === 'attended') active.add(bk.playerId);
  }
  return active.size;
}

/**
 * Active players at one branch — the two inputs filtered TOGETHER.
 *
 * The Dashboard narrowed `batches` by branch and passed `bookings` whole, so the
 * card counted "has usable credit HERE, or has a booking ANYWHERE". The booking
 * half was then a constant sitting inside every branch's figure: each branch read
 * too high, and the only thing that moved between branches was the credit half.
 *
 * It takes the raw lists and does both filters itself, so there is no longer a
 * version of this call where one argument is scoped and the other is not. That is
 * the whole point of the signature — `activePlayerCount` is still exported and
 * still correct, but nothing on a page should be choosing the two lists by hand.
 */
export function activePlayersAtLocation(
  batches: CreditBatch[],
  bookings: Booking[],
  locationId: LocationId | 'all',
  now: IsoInstant,
): number {
  return activePlayerCount(atLocation(batches, locationId), atLocation(bookings, locationId), now);
}

/** Published slots that start within `now`'s Cairo week. */
function slotsThisWeek(slots: SessionSlot[], now: IsoInstant): SessionSlot[] {
  const start = ms(cairoWeekStart(now));
  const end = start + 7 * DAY_MS;
  return slots.filter((s) => s.status === 'published' && inRange(s.startsAt, start, end));
}

// --- KPI 3: sessions this week ---
export const sessionsThisWeek = (slots: SessionSlot[], now: IsoInstant): number =>
  slotsThisWeek(slots, now).length;

// --- KPI 4: slot fill rate (booked seats ÷ capacity), 0–100 integer ---
export function slotFillRate(slots: SessionSlot[], now: IsoInstant): number {
  const week = slotsThisWeek(slots, now);
  const capacity = week.reduce((s, x) => s + x.capacity, 0);
  const booked = week.reduce((s, x) => s + x.bookedCount, 0);
  return capacity === 0 ? 0 : Math.round((booked / capacity) * 100);
}

// --- KPI 5: credit liability ("sold, not yet used") ---
export function batchLiability(amountPaid: number, quantityTotal: number, remaining: number): Piastres {
  if (quantityTotal <= 0) return 0 as Piastres;
  return Math.round((amountPaid * remaining) / quantityTotal) as Piastres;
}

// Deliberately NOT paid-gated. Liability is the service the academy still OWES for
// credits it has granted, and credits are granted the moment a purchase succeeds —
// whether or not the money has been collected. An unpaid purchase's credits are
// still bookable, so they are still owed.
export function creditLiability(batches: CreditBatch[], purchases: Purchase[], now: IsoInstant): Piastres {
  const nowMs = ms(now);
  const purchaseById = new Map(purchases.map((p) => [p.id, p]));
  let total = 0;
  for (const b of batches) {
    if (b.source !== 'purchase') continue;
    if (b.quantityRemaining <= 0) continue;
    if (ms(b.expiresAt) <= nowMs) continue;
    const purchase = b.purchaseId ? purchaseById.get(b.purchaseId) : undefined;
    if (!purchase) continue;
    total += batchLiability(purchase.amount, b.quantityTotal, b.quantityRemaining);
  }
  return total as Piastres;
}

// --- Donut: all-time COLLECTED revenue by training type (Trial never appears) ---
export interface TypeRevenue {
  type: TrainingType;
  amount: Piastres;
}

export function revenueByType(purchases: Purchase[], packages: Package[]): { rows: TypeRevenue[]; total: Piastres } {
  const pkgById = new Map(packages.map((p) => [p.id, p]));
  const totals = new Map<TrainingType, number>();
  for (const p of collected(purchases)) {
    const pkg = pkgById.get(p.packageId);
    if (!pkg) continue;
    totals.set(pkg.trainingType, (totals.get(pkg.trainingType) ?? 0) + p.amount);
  }
  const rows = TRAINING_TYPES.filter((t) => (totals.get(t) ?? 0) > 0).map((t) => ({
    type: t,
    amount: (totals.get(t) ?? 0) as Piastres,
  }));
  const total = rows.reduce((s, r) => s + r.amount, 0) as Piastres;
  return { rows, total };
}

// --- Line chart: COLLECTED revenue per Cairo week, last N weeks (Sunday-bucketed) ---
export interface WeekBucket {
  label: string;
  weekStart: IsoInstant;
  revenue: Piastres;
}

export function revenueOverTime(purchases: Purchase[], now: IsoInstant, weeks = 8): WeekBucket[] {
  const sunday = cairoCalendarDate(cairoWeekStart(now));
  const base: CairoDate = { year: sunday.year, month: sunday.month, day: sunday.day };
  const paid = collected(purchases);
  const buckets: WeekBucket[] = [];
  for (let w = weeks - 1; w >= 0; w -= 1) {
    const start = cairoMidnight(addCairoDays(base, -w * 7));
    const end = cairoMidnight(addCairoDays(base, -w * 7 + 7));
    const revenue = sumAmount(paid.filter((p) => inRange(p.revenueAt, ms(start), ms(end))));
    buckets.push({ label: formatDayMonth(start), weekStart: start, revenue });
  }
  return buckets;
}

// --- Bottom card 1: today's sessions (Cairo), earliest first ---
export function todaysSessions(slots: SessionSlot[], now: IsoInstant): SessionSlot[] {
  const c = cairoCalendarDate(now);
  return slots
    .filter((s) => {
      if (s.status !== 'published') return false;
      const d = cairoCalendarDate(s.startsAt);
      return d.year === c.year && d.month === c.month && d.day === c.day;
    })
    .sort((a, b) => ms(a.startsAt) - ms(b.startsAt));
}

// --- Bottom card 2: credits expiring in the next `windowDays` ---
export function creditsExpiringSoon(batches: CreditBatch[], now: IsoInstant, windowDays = 7): CreditBatch[] {
  const nowMs = ms(now);
  const horizon = nowMs + windowDays * DAY_MS;
  return batches
    .filter((b) => b.quantityRemaining > 0 && ms(b.expiresAt) > nowMs && ms(b.expiresAt) <= horizon)
    .sort((a, b) => ms(a.expiresAt) - ms(b.expiresAt));
}

// --- Bottom card 3: recent succeeded purchases, newest first — paid or not (the row marks unpaid ones) ---
/**
 * The latest sales — succeeded, paid or not, newest first.
 *
 * Ordered by revenueAt so the list agrees with the panel it sits in: the
 * Dashboard's money section is scoped to a month by revenueAt, and a feed
 * ordered by a different date would put rows in an order the heading above it
 * does not explain. For an unpaid sale the two are the same date anyway.
 */
export function recentPurchases(purchases: Purchase[], n = 4): Purchase[] {
  return succeeded(purchases)
    .slice()
    .sort((a, b) => ms(b.revenueAt) - ms(a.revenueAt))
    .slice(0, n);
}
