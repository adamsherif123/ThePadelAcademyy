import { addCairoDays, cairoCalendarDate, cairoWeekStart, parseInstant } from '@tpa/core';
import type { IsoInstant } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import {
  addCairoMonths,
  cairoMonthOf,
  chartAnchorFor,
  isCurrentCairoMonth,
  monthChoices,
  monthEndInstant,
  monthFetchRange,
  monthKey,
  monthLabel,
  monthLastInstant,
  monthOptions,
  monthRange,
  monthStartInstant,
  monthsDescending,
  parseMonthKey,
  type CairoMonth,
} from './months';

const ms = (i: IsoInstant): number => parseInstant(i).getTime();
const SEP: CairoMonth = { year: 2026, month: 9 };
const OCT: CairoMonth = { year: 2026, month: 10 };
const DEC: CairoMonth = { year: 2026, month: 12 };

describe('monthKey / parseMonthKey', () => {
  it('round-trips', () => {
    for (const m of [SEP, OCT, DEC, { year: 2001, month: 1 }]) {
      expect(parseMonthKey(monthKey(m))).toEqual(m);
    }
  });

  it('zero-pads, so the keys sort as strings in calendar order', () => {
    expect(monthKey({ year: 2026, month: 1 })).toBe('2026-01');
    expect(monthKey({ year: 2026, month: 12 })).toBe('2026-12');
    expect(['2026-10', '2026-01', '2026-09'].sort()).toEqual(['2026-01', '2026-09', '2026-10']);
  });

  it('refuses anything that is not a real YYYY-MM, rather than yielding NaN', () => {
    // A <Select> value can be stale, hand-edited, or come back from a URL one day.
    // Every one of these has to fall back, not render "NaN 2026".
    for (const bad of ['', '2026', '2026-1', '2026-00', '2026-13', '2026-9', 'x026-09', '2026-09-01']) {
      expect(parseMonthKey(bad)).toBeNull();
    }
  });
});

describe('addCairoMonths', () => {
  it('rolls the year in both directions', () => {
    expect(addCairoMonths(DEC, 1)).toEqual({ year: 2027, month: 1 });
    expect(addCairoMonths({ year: 2027, month: 1 }, -1)).toEqual(DEC);
    expect(addCairoMonths(SEP, 12)).toEqual({ year: 2027, month: 9 });
    expect(addCairoMonths(SEP, -12)).toEqual({ year: 2025, month: 9 });
  });

  it('never leaves month 0 or 13 behind', () => {
    for (let d = -30; d <= 30; d += 1) {
      const m = addCairoMonths(SEP, d);
      expect(m.month).toBeGreaterThanOrEqual(1);
      expect(m.month).toBeLessThanOrEqual(12);
    }
  });
});

describe('month boundaries are Cairo boundaries, not UTC ones', () => {
  // Asserted as a property rather than against a fixed offset: Egypt observes DST,
  // so September's offset and December's differ. What must hold in both is that
  // the boundary instant belongs to the NEXT month and the one before it to this
  // one — which is the whole reason a month here is a calendar pair and not a Date.
  it('the last instant of a month is still in that month', () => {
    for (const m of [SEP, OCT, DEC, { year: 2026, month: 2 }]) {
      expect(cairoMonthOf(monthLastInstant(m))).toEqual(m);
    }
  });

  it('the end instant belongs to the next month', () => {
    for (const m of [SEP, OCT, DEC]) {
      expect(cairoMonthOf(monthEndInstant(m))).toEqual(addCairoMonths(m, 1));
    }
  });

  it("one month's end IS the next month's start — no gap, no overlap", () => {
    expect(monthEndInstant(SEP)).toBe(monthStartInstant(OCT));
    expect(monthEndInstant(DEC)).toBe(monthStartInstant({ year: 2027, month: 1 }));
  });

  it('is one millisecond wide at the seam', () => {
    expect(ms(monthEndInstant(SEP)) - ms(monthLastInstant(SEP))).toBe(1);
  });

  it('the start instant is Cairo-midnight on the 1st', () => {
    const c = cairoCalendarDate(monthStartInstant(OCT));
    expect([c.year, c.month, c.day]).toEqual([2026, 10, 1]);
  });
});

describe('monthRange', () => {
  it('is half-open, so adjacent months cannot both claim an instant', () => {
    const sep = monthRange(SEP);
    const oct = monthRange(OCT);
    expect(sep.end).toBe(oct.start);
    const seam = ms(sep.end);
    // Standing on the seam: it is October's, and September's range excludes it.
    expect(seam >= ms(sep.start) && seam < ms(sep.end)).toBe(false);
    expect(seam >= ms(oct.start) && seam < ms(oct.end)).toBe(true);
  });
});

describe('monthFetchRange', () => {
  it('reaches back exactly one month, and no further', () => {
    const w = monthFetchRange(OCT);
    expect(w.start).toBe(monthStartInstant(SEP));
    expect(w.end).toBe(monthEndInstant(OCT));
  });

  it('rolls the year at January', () => {
    const w = monthFetchRange({ year: 2027, month: 1 });
    expect(w.start).toBe(monthStartInstant(DEC));
  });

  /**
   * The load-bearing claim in monthFetchRange's comment: one extra month is enough
   * for the eight-week chart. revenueOverTime buckets backwards from the week start
   * of its anchor, 8 weeks of 7 days, so its earliest bucket opens 49 days before
   * that Sunday. If the fetch window started after that, the chart's left-hand
   * columns would silently read zero — a wrong chart, not a broken one, which is
   * the kind that gets believed.
   */
  it('covers the earliest bucket of the 8-week chart, for every month of several years', () => {
    for (let year = 2024; year <= 2028; year += 1) {
      for (let month = 1; month <= 12; month += 1) {
        const m = { year, month };
        const w = monthFetchRange(m);
        const anchor = monthLastInstant(m);
        const sunday = cairoCalendarDate(cairoWeekStart(anchor));
        const earliestBucketStart = addCairoDays(sunday, -7 * 7);
        const bucketMs = Date.UTC(
          earliestBucketStart.year,
          earliestBucketStart.month - 1,
          earliestBucketStart.day,
        );
        const startC = cairoCalendarDate(w.start);
        const windowMs = Date.UTC(startC.year, startC.month - 1, startC.day);
        expect(bucketMs).toBeGreaterThanOrEqual(windowMs);
      }
    }
  });
});

describe('chartAnchorFor', () => {
  const now = '2026-10-15T09:00:00.000Z' as IsoInstant;

  it('stops at today for the current month, so the chart has no empty future tail', () => {
    expect(chartAnchorFor(cairoMonthOf(now), now)).toBe(now);
  });

  it('runs to the end of a month that is over', () => {
    expect(chartAnchorFor(SEP, now)).toBe(monthLastInstant(SEP));
  });
});

describe('isCurrentCairoMonth', () => {
  const now = '2026-10-15T09:00:00.000Z' as IsoInstant;
  it('is true only for the month Cairo is in', () => {
    expect(isCurrentCairoMonth(OCT, now)).toBe(true);
    expect(isCurrentCairoMonth(SEP, now)).toBe(false);
    expect(isCurrentCairoMonth({ year: 2025, month: 10 }, now)).toBe(false);
  });
});

describe('monthsDescending', () => {
  it('is newest first and inclusive at both ends', () => {
    const list = monthsDescending(SEP, DEC);
    expect(list).toEqual([DEC, { year: 2026, month: 11 }, OCT, SEP]);
  });

  it('is a single entry when the two ends are the same month', () => {
    expect(monthsDescending(OCT, OCT)).toEqual([OCT]);
  });

  it('falls back to the latest month when earliest is somehow after it', () => {
    // Clock skew, or a row with a future date. Better one sane option than a
    // backwards loop or an empty <Select>.
    expect(monthsDescending(DEC, SEP)).toEqual([SEP]);
  });

  it('caps the list rather than building a decade of options', () => {
    const list = monthsDescending({ year: 1990, month: 1 }, DEC);
    expect(list).toHaveLength(120);
    expect(list[0]).toEqual(DEC);
  });
});

describe('monthChoices', () => {
  const now = '2026-10-15T09:00:00.000Z' as IsoInstant;

  it('offers only this month when there is nothing on record', () => {
    // A <Select> whose value is missing from its options renders blank in every
    // browser, so the list must always contain the default.
    expect(monthChoices(null, now)).toEqual([OCT]);
  });

  it('runs from the earliest instant to now, newest first', () => {
    const list = monthChoices('2026-08-03T12:00:00.000Z' as IsoInstant, now);
    expect(list).toEqual([OCT, SEP, { year: 2026, month: 8 }]);
  });

  it('always contains the current month, so the default is selectable', () => {
    for (const earliest of [null, '2020-01-01T00:00:00.000Z' as IsoInstant, now]) {
      expect(monthChoices(earliest, now).map(monthKey)).toContain(monthKey(cairoMonthOf(now)));
    }
  });
});

describe('monthOptions', () => {
  it('pairs the key with a readable label', () => {
    expect(monthOptions([OCT, SEP])).toEqual([
      { value: '2026-10', label: 'October 2026' },
      { value: '2026-09', label: 'September 2026' },
    ]);
  });

  it('names the year, because a picker that spans one is otherwise ambiguous', () => {
    expect(monthLabel({ year: 2025, month: 9 })).toBe('September 2025');
    expect(monthLabel({ year: 2026, month: 9 })).toBe('September 2026');
  });
});
