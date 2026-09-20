import { cairoCalendarDate, cairoMidnight, addCairoDays } from '@tpa/core';
import type { IsoInstant, SessionSlot, TrainingType } from '@tpa/types';

/**
 * The coach Schedule tab's shape, as a pure function of the coach's own slots.
 *
 * The screen answers one question — "what am I teaching next, and what else today"
 * — so the grouping is: a hero, the rest of today, then everything after.
 *
 * `hero` is the session IN PROGRESS if there is one, otherwise the next to start. A
 * coach mid-lesson wants the roster in front of them, not the session after it; the
 * fetch keeps a 12-hour tail precisely so a running session is still in hand.
 *
 * Anything already FINISHED is dropped from all three groups. The tail exists to
 * catch the session underway, not to turn the schedule into a history — that is
 * what the Hours tab is for.
 */
export interface CoachSchedule {
  /** In progress now, or the next to start. null when nothing is upcoming. */
  hero: SessionSlot | null;
  /** True when `hero` has already started — the screen says "on court now". */
  heroInProgress: boolean;
  /** The rest of today, after the hero, soonest first. */
  restOfToday: SessionSlot[];
  /** Everything after today, soonest first. */
  later: SessionSlot[];
}

const ms = (i: IsoInstant): number => new Date(i).getTime();

function sameCairoDay(a: IsoInstant, b: IsoInstant): boolean {
  const x = cairoCalendarDate(a);
  const y = cairoCalendarDate(b);
  return x.year === y.year && x.month === y.month && x.day === y.day;
}

export function coachSchedule(slots: SessionSlot[], now: IsoInstant): CoachSchedule {
  const nowMs = ms(now);
  const live = slots
    .filter((s) => ms(s.endsAt) > nowMs)
    .sort((a, b) => ms(a.startsAt) - ms(b.startsAt));

  const hero = live[0] ?? null;
  if (!hero) return { hero: null, heroInProgress: false, restOfToday: [], later: [] };

  const rest = live.slice(1);
  return {
    hero,
    heroInProgress: ms(hero.startsAt) <= nowMs,
    restOfToday: rest.filter((s) => sameCairoDay(s.startsAt, now)),
    later: rest.filter((s) => !sameCairoDay(s.startsAt, now)),
  };
}

/**
 * "in 25 minutes" / "in 3 hours" / "in 2 days" — the countdown on the hero card.
 * Deliberately coarse: a coach glancing at this needs to know whether to start
 * walking to the court, not the exact second.
 */
export function startsInLabel(startsAt: IsoInstant, now: IsoInstant): string {
  const mins = Math.round((ms(startsAt) - ms(now)) / 60_000);
  if (mins <= 0) return 'now';
  if (mins < 60) return `in ${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

// ── the Schedule tab's day grouping ──────────────────────────────────────────

export interface CoachDay {
  /** Cairo calendar key, YYYY-M-D — stable across a render. */
  key: string;
  /** 'Today' / 'Tomorrow' / 'Sun, 21 Sep'. */
  label: string;
  /** Midnight Cairo for the day, for the date sub-label. */
  date: IsoInstant;
  sessions: SessionSlot[];
}

/**
 * The coach's sessions grouped by Cairo day, soonest day first.
 *
 * Unlike the hero derivation above this keeps sessions that have already FINISHED
 * today: a coach glancing at the schedule mid-evening wants to see the whole day's
 * work, including what is already done. The fetch's twelve-hour tail is what makes
 * that possible, and it is also why nothing older than today can appear.
 */
export function coachDays(slots: SessionSlot[], now: IsoInstant): CoachDay[] {
  const today = cairoCalendarDate(now);
  const todayKey = `${today.year}-${today.month}-${today.day}`;
  const tomorrow = addCairoDays({ year: today.year, month: today.month, day: today.day }, 1);
  const tomorrowKey = `${tomorrow.year}-${tomorrow.month}-${tomorrow.day}`;

  const byKey = new Map<string, CoachDay>();
  for (const s of [...slots].sort((a, b) => ms(a.startsAt) - ms(b.startsAt))) {
    const c = cairoCalendarDate(s.startsAt);
    const key = `${c.year}-${c.month}-${c.day}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.sessions.push(s);
      continue;
    }
    byKey.set(key, {
      key,
      label: key === todayKey ? 'Today' : key === tomorrowKey ? 'Tomorrow' : '',
      date: cairoMidnight({ year: c.year, month: c.month, day: c.day }),
      sessions: [s],
    });
  }
  return [...byKey.values()];
}

/** Has this session finished / is it running right now? Drives the row's state pill. */
export function sessionState(slot: SessionSlot, now: IsoInstant): 'done' | 'live' | 'upcoming' {
  const n = ms(now);
  if (ms(slot.endsAt) <= n) return 'done';
  if (ms(slot.startsAt) <= n) return 'live';
  return 'upcoming';
}

// ── the Dashboard's week strip ───────────────────────────────────────────────

export interface WeekDayCount {
  /** 'S' 'M' 'T' … — the Cairo weekday initial. */
  initial: string;
  count: number;
  isToday: boolean;
}

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * Sessions per day across the CURRENT Cairo week, Sunday first — the little strip
 * under the stat grid. Sunday-start matches cairoWeekStart and the server's own
 * week bounds, so the strip and `sessions_this_week` describe the same seven days.
 *
 * Counts only what the schedule fetch holds, which reaches back twelve hours — so
 * earlier days in the week read 0 rather than a real count. The screen labels the
 * strip accordingly rather than implying it is the full week's history.
 */
export function weekStrip(slots: SessionSlot[], now: IsoInstant): WeekDayCount[] {
  const c = cairoCalendarDate(now);
  const todayKey = `${c.year}-${c.month}-${c.day}`;
  const sunday = addCairoDays({ year: c.year, month: c.month, day: c.day }, -c.weekday);

  return WEEKDAY_INITIALS.map((initial, i) => {
    const d = addCairoDays(sunday, i);
    const key = `${d.year}-${d.month}-${d.day}`;
    return {
      initial,
      isToday: key === todayKey,
      count: slots.filter((s) => {
        const sc = cairoCalendarDate(s.startsAt);
        return `${sc.year}-${sc.month}-${sc.day}` === key;
      }).length,
    };
  });
}

// ── the Dashboard's type breakdown ───────────────────────────────────────────

export interface TypeSlice {
  label: string;
  count: number;
  /** 0-1, of the month's total sessions. */
  fraction: number;
}

/**
 * This month's sessions by type, as bar rows.
 *
 * The honest bit: `breakdown` carries group/duo/individual only, but an OPEN block
 * (no type until its first booking) and a trial are both counted in the month's
 * total. So the three never have to add up, and presenting them as if they did —
 * a donut with the total in the middle — would be a quiet lie. Any remainder is
 * shown as its own "Other" row instead, and every fraction is taken over the REAL
 * total, so the bars always describe the whole month.
 */
export function typeSlices(
  breakdown: Record<Exclude<TrainingType, 'trial'>, number> | { group: number; duo: number; individual: number },
  totalSessions: number,
): TypeSlice[] {
  const { group, duo, individual } = breakdown;
  const other = Math.max(0, totalSessions - group - duo - individual);
  const denominator = totalSessions > 0 ? totalSessions : 1;
  return [
    { label: 'Group', count: group, fraction: group / denominator },
    { label: 'Duo', count: duo, fraction: duo / denominator },
    { label: 'Individual', count: individual, fraction: individual / denominator },
    ...(other > 0 ? [{ label: 'Other', count: other, fraction: other / denominator }] : []),
  ].filter((s) => s.count > 0);
}

/** "Good morning" / "Good afternoon" / "Good evening", by Cairo wall clock. */
export function cairoGreeting(now: IsoInstant): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: 'numeric', hour12: false }).format(
      new Date(now),
    ),
  );
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
