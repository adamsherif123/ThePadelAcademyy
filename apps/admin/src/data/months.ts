import { cairoCalendarDate, cairoMidnight, parseInstant } from '@tpa/core';
import type { IsoInstant } from '@tpa/types';

/**
 * Cairo months, as a thing you can put in a <Select>, a query key and a date
 * filter without each caller inventing its own spelling.
 *
 * Everything the admin measures by month — revenue, a coach's hours — is measured
 * in Africa/Cairo, because that is where the academy is. A UTC month boundary is
 * two or three hours out, which misfiles the purchases either side of midnight on
 * the 1st and would make two screens disagree about the same money. So a month
 * here is a (year, month) pair in the Cairo calendar, and every instant it hands
 * back is derived through cairoMidnight.
 *
 * `monthKey` is the wire format: 'YYYY-MM', sortable as a string, stable in a
 * React Query key, and valid as the `date` the coach_hours_coached RPC wants once
 * you append '-01'. It is deliberately NOT an instant — an instant pins a month to
 * a timezone, and this type's whole job is to stay a calendar fact until the last
 * moment.
 */
export interface CairoMonth {
  year: number;
  /** 1–12, not 0–11. The Date constructor's 0-indexed month is the single most
   *  reliable source of off-by-one in date code, so it does not get in here. */
  month: number;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** The Cairo month an instant falls in. */
export function cairoMonthOf(instant: IsoInstant): CairoMonth {
  const c = cairoCalendarDate(instant);
  return { year: c.year, month: c.month };
}

/** `delta` months later (or earlier). Arithmetic on a month index, so December
 *  rolls into January and the day never participates. */
export function addCairoMonths(m: CairoMonth, delta: number): CairoMonth {
  const idx = m.year * 12 + (m.month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

/** 'YYYY-MM' — the <Select> value, the query-key fragment, and the RPC argument's stem. */
export const monthKey = (m: CairoMonth): string =>
  `${String(m.year).padStart(4, '0')}-${String(m.month).padStart(2, '0')}`;

/** The inverse. Returns null for anything that is not 'YYYY-MM' with a real month,
 *  so a stale or hand-edited value falls back rather than rendering NaN. */
export function parseMonthKey(key: string): CairoMonth | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

/** 'September 2026'. */
export const monthLabel = (m: CairoMonth): string => `${MONTH_NAMES[m.month - 1] ?? ''} ${m.year}`;

/** Just 'September', for a card whose year is already obvious from context. */
export const monthNameOnly = (m: CairoMonth): string => MONTH_NAMES[m.month - 1] ?? '';

/** Cairo midnight on the 1st — an instant INSIDE the month, which is what the
 *  dashboard aggregates take to decide which month they are about. */
export const monthStartInstant = (m: CairoMonth): IsoInstant =>
  cairoMidnight({ year: m.year, month: m.month, day: 1 });

/** Cairo midnight on the 1st of the NEXT month — the exclusive upper bound. Every
 *  range in here is half-open [start, end), so two adjacent months can never both
 *  claim the same purchase. */
export const monthEndInstant = (m: CairoMonth): IsoInstant => monthStartInstant(addCairoMonths(m, 1));

/** Is this the month Cairo is in right now? Drives "Hours this month" vs naming it. */
export const isCurrentCairoMonth = (m: CairoMonth, now: IsoInstant): boolean => {
  const c = cairoMonthOf(now);
  return c.year === m.year && c.month === m.month;
};

/**
 * The last instant inside the month — one millisecond before the next one starts.
 *
 * The eight-week chart buckets backwards from whatever instant it is handed, so to
 * show the weeks running UP TO a past month it has to be anchored at that month's
 * end. Anchoring it at the 1st would draw the eight weeks BEFORE the month and omit
 * the month itself, which is the sort of off-by-one nobody notices on a line chart.
 */
export const monthLastInstant = (m: CairoMonth): IsoInstant =>
  new Date(parseInstant(monthEndInstant(m)).getTime() - 1).toISOString() as IsoInstant;

/**
 * The instant to drive the trailing chart from: `now` for the current month, because
 * its weeks have not happened yet and a chart running to the 31st would end in a
 * flat tail of zeroes; the month's last instant for any month already over.
 */
export const chartAnchorFor = (m: CairoMonth, now: IsoInstant): IsoInstant =>
  isCurrentCairoMonth(m, now) ? now : monthLastInstant(m);

/** The half-open range a month covers. */
export function monthRange(m: CairoMonth): { start: IsoInstant; end: IsoInstant } {
  return { start: monthStartInstant(m), end: monthEndInstant(m) };
}

/**
 * The window a Dashboard month actually needs fetched: the selected month AND the
 * one before it.
 *
 * Two things reach back past the 1st. The revenue KPI's delta is "vs last month",
 * so it needs the previous month's purchases or it would report a fall to zero.
 * And the eight-week line chart is anchored at the end of the selected month, so
 * its earliest bucket starts up to 55 days before that — which, for a 31-day
 * month, is at worst 24 days into the previous month. One extra month covers both
 * with room to spare, and it is the smallest window that does.
 */
export function monthFetchRange(m: CairoMonth): { start: IsoInstant; end: IsoInstant } {
  return { start: monthStartInstant(addCairoMonths(m, -1)), end: monthEndInstant(m) };
}

/**
 * Every month from `earliest` to `latest` inclusive, newest first.
 *
 * Newest first because the list is read from the top and the interesting months
 * are the recent ones; and because the default — the current month — is then the
 * first option, so the control opens on what it is already showing.
 *
 * Capped at 120 entries. A ten-year list is already past the point where a
 * <Select> is the right control, and the cap means one bad `earliest` (a purchase
 * row with a broken date, say) degrades the picker instead of hanging the page.
 */
export function monthsDescending(earliest: CairoMonth, latest: CairoMonth): CairoMonth[] {
  const first = earliest.year * 12 + (earliest.month - 1);
  const last = latest.year * 12 + (latest.month - 1);
  if (last < first) return [latest];
  const out: CairoMonth[] = [];
  for (let i = last; i >= first && out.length < 120; i -= 1) {
    out.push({ year: Math.floor(i / 12), month: (i % 12) + 1 });
  }
  return out;
}

/** <Select> options for a month list. */
export const monthOptions = (months: readonly CairoMonth[]): { value: string; label: string }[] =>
  months.map((m) => ({ value: monthKey(m), label: monthLabel(m) }));

/**
 * The month list for a page, given the oldest instant it has data for.
 *
 * `earliest` null means "nothing on record" — a fresh academy, or a branch filter
 * that matches nothing — and the list is then just the current month rather than
 * empty, so the control always has its own value in it. A <Select> whose value is
 * absent from its options renders blank in every browser, and the month picker
 * defaulting to a blank box would look like a bug on an academy's first day.
 */
export function monthChoices(earliest: IsoInstant | null, now: IsoInstant): CairoMonth[] {
  const latest = cairoMonthOf(now);
  if (earliest === null) return [latest];
  return monthsDescending(cairoMonthOf(earliest), latest);
}
