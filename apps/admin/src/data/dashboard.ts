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
  CreditBatch,
  IsoInstant,
  Package,
  Piastres,
  Purchase,
  SessionSlot,
  TrainingType,
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

const succeeded = (purchases: Purchase[]): Purchase[] => purchases.filter((p) => p.status === 'succeeded');
const sumAmount = (purchases: readonly Purchase[]): Piastres =>
  purchases.reduce((s, p) => s + p.amount, 0) as Piastres;
const inRange = (i: IsoInstant, startMs: number, endMs: number): boolean =>
  ms(i) >= startMs && ms(i) < endMs;

// --- KPI 1: revenue this Cairo month vs last, succeeded only ---
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
  const paid = succeeded(purchases);
  const current = sumAmount(paid.filter((p) => inRange(p.createdAt, start, next)));
  const previous = sumAmount(paid.filter((p) => inRange(p.createdAt, prev, start)));
  const deltaPct = previous === 0 ? null : Math.round(((current - previous) / previous) * 100);
  return { current, previous, deltaPct };
}

// --- KPI 2: active players (usable credit OR a booked/attended session) ---
export function activePlayerCount(batches: CreditBatch[], bookings: import('@tpa/types').Booking[], now: IsoInstant): number {
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

// --- Donut: all-time succeeded revenue by training type (Trial never appears) ---
export interface TypeRevenue {
  type: TrainingType;
  amount: Piastres;
}

export function revenueByType(purchases: Purchase[], packages: Package[]): { rows: TypeRevenue[]; total: Piastres } {
  const pkgById = new Map(packages.map((p) => [p.id, p]));
  const totals = new Map<TrainingType, number>();
  for (const p of succeeded(purchases)) {
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

// --- Line chart: succeeded revenue per Cairo week, last N weeks (Sunday-bucketed) ---
export interface WeekBucket {
  label: string;
  weekStart: IsoInstant;
  revenue: Piastres;
}

export function revenueOverTime(purchases: Purchase[], now: IsoInstant, weeks = 8): WeekBucket[] {
  const sunday = cairoCalendarDate(cairoWeekStart(now));
  const base: CairoDate = { year: sunday.year, month: sunday.month, day: sunday.day };
  const paid = succeeded(purchases);
  const buckets: WeekBucket[] = [];
  for (let w = weeks - 1; w >= 0; w -= 1) {
    const start = cairoMidnight(addCairoDays(base, -w * 7));
    const end = cairoMidnight(addCairoDays(base, -w * 7 + 7));
    const revenue = sumAmount(paid.filter((p) => inRange(p.createdAt, ms(start), ms(end))));
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

// --- Bottom card 3: recent succeeded purchases, newest first ---
export function recentPurchases(purchases: Purchase[], n = 4): Purchase[] {
  return succeeded(purchases)
    .slice()
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt))
    .slice(0, n);
}
