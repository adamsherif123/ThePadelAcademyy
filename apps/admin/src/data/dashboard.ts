import {
  TRAINING_TYPES,
  cairoCalendarDate,
  cairoWallTimeToInstant,
  formatDayMonth,
  parseInstant,
} from '@tpa/core';
import type {
  CreditBatch,
  IsoInstant,
  Piastres,
  Purchase,
  SessionSlot,
  TrainingType,
} from '@tpa/types';

import { getBatches, getBookings, getPackages, getPurchases, getSlots } from './store';

/**
 * Dashboard aggregates — pure functions of (…, now) over the store, so S11 can
 * move them server-side unchanged and they're unit-testable. Money stays in
 * integer piastres (formatted only at the edge, via @tpa/core). All date
 * bucketing is in Africa/Cairo: a UTC month/week boundary is 2–3 hours off and
 * would misfile purchases at the edges.
 */

const DAY_MS = 86_400_000;
const ms = (i: IsoInstant): number => parseInstant(i).getTime();

interface CairoDate {
  year: number;
  month: number;
  day: number;
}

/** Cairo-local midnight (00:00) of a Cairo calendar date, as a UTC instant. */
const cairoMidnight = (d: CairoDate): IsoInstant =>
  cairoWallTimeToInstant(d.year, d.month, d.day, 0, 0);

/** Shift a Cairo calendar date by whole days (DST-safe: pure calendar arithmetic). */
function addDays(d: CairoDate, delta: number): CairoDate {
  const shifted = new Date(Date.UTC(d.year, d.month - 1, d.day) + delta * DAY_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function addMonths(d: CairoDate, delta: number): CairoDate {
  const idx = (d.year * 12 + (d.month - 1)) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1, day: 1 };
}

/** Cairo-midnight of the first day of `now`'s Cairo month. */
const monthStart = (now: IsoInstant): IsoInstant => {
  const c = cairoCalendarDate(now);
  return cairoMidnight({ year: c.year, month: c.month, day: 1 });
};

/** Cairo-midnight of the SUNDAY that opens `now`'s Cairo week (weekday 0 = Sun). */
function weekStartSunday(now: IsoInstant): IsoInstant {
  const c = cairoCalendarDate(now);
  return cairoMidnight(addDays({ year: c.year, month: c.month, day: c.day }, -c.weekday));
}

const succeeded = (): Purchase[] => getPurchases().filter((p) => p.status === 'succeeded');
const sumAmount = (purchases: readonly Purchase[]): Piastres =>
  purchases.reduce((s, p) => s + p.amount, 0) as Piastres;
const inRange = (i: IsoInstant, startMs: number, endMs: number): boolean =>
  ms(i) >= startMs && ms(i) < endMs;

// --- KPI 1: revenue this Cairo month vs last, succeeded only ---
export interface RevenueMonth {
  current: Piastres;
  previous: Piastres;
  /** Signed % change vs last month, or null when last month had no revenue. */
  deltaPct: number | null;
}

export function revenueThisMonth(now: IsoInstant): RevenueMonth {
  const cThis = cairoCalendarDate(now);
  const start = ms(monthStart(now));
  const next = ms(cairoMidnight(addMonths({ year: cThis.year, month: cThis.month, day: 1 }, 1)));
  const prev = ms(cairoMidnight(addMonths({ year: cThis.year, month: cThis.month, day: 1 }, -1)));
  const paid = succeeded();
  const current = sumAmount(paid.filter((p) => inRange(p.createdAt, start, next)));
  const previous = sumAmount(paid.filter((p) => inRange(p.createdAt, prev, start)));
  const deltaPct = previous === 0 ? null : Math.round(((current - previous) / previous) * 100);
  return { current, previous, deltaPct };
}

// --- KPI 2: active players (usable credit OR a booked/attended session) ---
export function activePlayerCount(now: IsoInstant): number {
  const active = new Set<string>();
  const nowMs = ms(now);
  for (const b of getBatches()) {
    if (b.quantityRemaining > 0 && ms(b.expiresAt) > nowMs) active.add(b.playerId);
  }
  for (const bk of getBookings()) {
    if (bk.status === 'booked' || bk.status === 'attended') active.add(bk.playerId);
  }
  return active.size;
}

/** Published slots that start within `now`'s Cairo week (the academy runs Sun–Wed). */
function slotsThisWeek(now: IsoInstant): SessionSlot[] {
  const start = ms(weekStartSunday(now));
  const end = start + 7 * DAY_MS;
  return getSlots().filter((s) => s.status === 'published' && inRange(s.startsAt, start, end));
}

// --- KPI 3: sessions this week ---
export const sessionsThisWeek = (now: IsoInstant): number => slotsThisWeek(now).length;

// --- KPI 4: slot fill rate (booked seats ÷ capacity), 0–100 integer ---
export function slotFillRate(now: IsoInstant): number {
  const week = slotsThisWeek(now);
  const capacity = week.reduce((s, x) => s + x.capacity, 0);
  const booked = week.reduce((s, x) => s + x.bookedCount, 0);
  return capacity === 0 ? 0 : Math.round((booked / capacity) * 100);
}

// --- KPI 5: credit liability ("sold, not yet used") ---
/**
 * Monetary value of the credits remaining in one purchased batch, derived from
 * what the player ACTUALLY PAID — `purchase.amount`, captured at purchase time —
 * and the batch's own `quantityTotal`, NEVER the live catalog. This is the
 * "repricing immunity" the schema (S5) designs for: editing a package's price in
 * S4e changes only future purchases, so a batch bought at the old price must keep
 * that old per-session value here. To stay in integer piastres with one rounding
 * step, multiply amount × remaining FIRST, then divide by quantityTotal, then round
 * to the NEAREST piastre — unbiased, error ≤ 0.5 piastre per batch. (Params kept
 * positionally identical to the old price/sessionCount form, which for any real
 * purchase equalled amount/quantityTotal.)
 */
export function batchLiability(amountPaid: number, quantityTotal: number, remaining: number): Piastres {
  if (quantityTotal <= 0) return 0 as Piastres;
  return Math.round((amountPaid * remaining) / quantityTotal) as Piastres;
}

export function creditLiability(now: IsoInstant): Piastres {
  const nowMs = ms(now);
  const purchaseById = new Map(getPurchases().map((p) => [p.id, p]));
  let total = 0;
  for (const b of getBatches()) {
    // Grants cost the player nothing → no financial liability. Only purchases count.
    if (b.source !== 'purchase') continue;
    if (b.quantityRemaining <= 0) continue;
    // Expired credits are revenue the academy kept, not a liability.
    if (ms(b.expiresAt) <= nowMs) continue;
    const purchase = b.purchaseId ? purchaseById.get(b.purchaseId) : undefined;
    if (!purchase) continue; // liability follows the captured purchase, not the package
    // Captured amount + quantityTotal only — the live package is never read, so a
    // later price edit cannot retroactively move this figure.
    total += batchLiability(purchase.amount, b.quantityTotal, b.quantityRemaining);
  }
  return total as Piastres;
}

// --- Donut: all-time succeeded revenue by training type (Trial never appears) ---
export interface TypeRevenue {
  type: TrainingType;
  amount: Piastres;
}

export function revenueByType(): { rows: TypeRevenue[]; total: Piastres } {
  const pkgById = new Map(getPackages().map((p) => [p.id, p]));
  const totals = new Map<TrainingType, number>();
  for (const p of succeeded()) {
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

export function revenueOverTime(now: IsoInstant, weeks = 8): WeekBucket[] {
  const sunday = cairoCalendarDate(weekStartSunday(now));
  const base: CairoDate = { year: sunday.year, month: sunday.month, day: sunday.day };
  const paid = succeeded();
  const buckets: WeekBucket[] = [];
  for (let w = weeks - 1; w >= 0; w -= 1) {
    const start = cairoMidnight(addDays(base, -w * 7));
    const end = cairoMidnight(addDays(base, -w * 7 + 7));
    const revenue = sumAmount(paid.filter((p) => inRange(p.createdAt, ms(start), ms(end))));
    buckets.push({ label: formatDayMonth(start), weekStart: start, revenue });
  }
  return buckets;
}

// --- Bottom card 1: today's sessions (Cairo), earliest first ---
export function todaysSessions(now: IsoInstant): SessionSlot[] {
  const c = cairoCalendarDate(now);
  return getSlots()
    .filter((s) => {
      if (s.status !== 'published') return false;
      const d = cairoCalendarDate(s.startsAt);
      return d.year === c.year && d.month === c.month && d.day === c.day;
    })
    .sort((a, b) => ms(a.startsAt) - ms(b.startsAt));
}

// --- Bottom card 2: credits expiring in the next `windowDays` (colour via creditExpiryState) ---
export function creditsExpiringSoon(now: IsoInstant, windowDays = 7): CreditBatch[] {
  const nowMs = ms(now);
  const horizon = nowMs + windowDays * DAY_MS;
  return getBatches()
    .filter((b) => b.quantityRemaining > 0 && ms(b.expiresAt) > nowMs && ms(b.expiresAt) <= horizon)
    .sort((a, b) => ms(a.expiresAt) - ms(b.expiresAt));
}

// --- Bottom card 3: recent succeeded purchases, newest first (date-agnostic) ---
export function recentPurchases(n = 4): Purchase[] {
  return succeeded()
    .slice()
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt))
    .slice(0, n);
}
