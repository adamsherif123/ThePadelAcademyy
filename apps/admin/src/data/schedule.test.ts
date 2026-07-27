import { MOCK_NOW, mockSlots, mockTemplates } from '@tpa/mocks';
import type { SessionSlot } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import {
  cairoWallMinutes,
  closedWeekdays,
  eventBox,
  layoutDay,
  slotsForDay,
  weekColumns,
  weekTimeRange,
} from './schedule';

const addHours = (instant: SessionSlot['startsAt'], hours: number): SessionSlot['startsAt'] =>
  new Date(new Date(instant).getTime() + hours * 3_600_000).toISOString() as SessionSlot['startsAt'];

function oneOffSlot(over: Partial<SessionSlot> & Pick<SessionSlot, 'startsAt' | 'endsAt'>): SessionSlot {
  return {
    id: 'sl_oneoff_test' as SessionSlot['id'],
    coachId: mockTemplates[0]!.coachId,
    trainingType: null,
    capacity: 1,
    bookedCount: 0,
    gender: null,
    level: null,
    status: 'published',
    templateId: null,
    manuallyConfirmedAt: null,
    setByBookingAt: null,
    ...over,
  };
}

/**
 * Week-calendar layout math. S10b killed the mock store: the selectors now take
 * the fetched arrays, so the tests build the columns/slots from the fixtures
 * (mockTemplates / mockSlots) and pass them in.
 */

const HOUR_PX = 84;

describe('closedWeekdays', () => {
  it('closes weekdays with no active template (Thu/Fri/Sat)', () => {
    expect([...closedWeekdays(mockTemplates)].sort()).toEqual([4, 5, 6]);
  });
});

describe('weekColumns isClosed — the isDayOpen union (@tpa/core)', () => {
  it('a published one-off on a template-uncovered day opens ONLY that date, not the whole weekday', () => {
    const baseline = weekColumns(mockTemplates, [], MOCK_NOW, 0);
    const thursday = baseline.find((c) => c.weekday === 4)!;
    expect(thursday.isClosed).toBe(true); // sanity: Thursday has no active template

    const oneOff = oneOffSlot({ startsAt: addHours(thursday.dayStart, 18), endsAt: addHours(thursday.dayStart, 19) });

    const thisWeek = weekColumns(mockTemplates, [oneOff], MOCK_NOW, 0);
    expect(thisWeek.find((c) => c.weekday === 4)!.isClosed).toBe(false);

    // Next week's Thursday is untouched — the slot side opens a DATE, not a weekday.
    const nextWeek = weekColumns(mockTemplates, [oneOff], MOCK_NOW, 1);
    expect(nextWeek.find((c) => c.weekday === 4)!.isClosed).toBe(true);
  });

  it('a cancelled-only one-off does not open a template-uncovered day', () => {
    const baseline = weekColumns(mockTemplates, [], MOCK_NOW, 0);
    const thursday = baseline.find((c) => c.weekday === 4)!;
    const cancelledOneOff = oneOffSlot({
      status: 'cancelled',
      startsAt: addHours(thursday.dayStart, 18),
      endsAt: addHours(thursday.dayStart, 19),
    });

    const cols = weekColumns(mockTemplates, [cancelledOneOff], MOCK_NOW, 0);
    expect(cols.find((c) => c.weekday === 4)!.isClosed).toBe(true);
  });
});

describe('weekTimeRange', () => {
  it('spans at least midday→midnight and covers every slot this week', () => {
    const cols = weekColumns(mockTemplates, mockSlots, MOCK_NOW, 0);
    const { startMin, endMin } = weekTimeRange(mockSlots, cols);
    expect(startMin).toBeLessThanOrEqual(12 * 60);
    expect(endMin).toBeGreaterThanOrEqual(24 * 60);
    // No slot may fall outside the derived range — that's what prevents escape.
    for (const col of cols) {
      for (const s of slotsForDay(mockSlots, col.dayStart)) {
        expect(cairoWallMinutes(s.startsAt)).toBeGreaterThanOrEqual(startMin);
        expect(cairoWallMinutes(s.endsAt)).toBeLessThanOrEqual(endMin);
      }
    }
  });
});

describe('eventBox — the escape invariant', () => {
  const gridPx = 12 * HOUR_PX; // noon..midnight

  it('clamps an 8 AM one-off (before the grid) to the top edge, never negative', () => {
    const b = eventBox(8 * 60, 9 * 60, 12 * 60, HOUR_PX, gridPx);
    expect(b.top).toBe(0);
    expect(b.top + b.height).toBeLessThanOrEqual(gridPx);
    expect(b.height).toBeGreaterThan(0);
  });

  it('clamps a 2 AM one-off (past the grid) to stay inside the bottom edge', () => {
    // 26*60 = 2 AM next day, well past a midnight grid end.
    const b = eventBox(25 * 60, 26 * 60, 12 * 60, HOUR_PX, gridPx);
    expect(b.top).toBeLessThanOrEqual(gridPx);
    expect(b.top + b.height).toBeLessThanOrEqual(gridPx);
  });

  it('places an in-range 6–8 PM event at its true position', () => {
    const b = eventBox(18 * 60, 20 * 60, 12 * 60, HOUR_PX, gridPx);
    expect(b.top).toBe(6 * HOUR_PX); // 6 hours below noon
    expect(b.height).toBe(2 * HOUR_PX);
  });
});

describe('layoutDay', () => {
  it('keeps every box inside the grid and within its lane, across the whole week', () => {
    const cols = weekColumns(mockTemplates, mockSlots, MOCK_NOW, 0);
    const { startMin, endMin } = weekTimeRange(mockSlots, cols);
    const gridPx = ((endMin - startMin) / 60) * HOUR_PX;
    let total = 0;
    for (const col of cols) {
      const placed = layoutDay(slotsForDay(mockSlots, col.dayStart), startMin, HOUR_PX, gridPx);
      total += placed.length;
      for (const p of placed) {
        expect(p.top).toBeGreaterThanOrEqual(0);
        expect(p.top + p.height).toBeLessThanOrEqual(gridPx + 0.001);
        expect(p.leftPct).toBeGreaterThanOrEqual(0);
        expect(p.leftPct + p.widthPct).toBeLessThanOrEqual(100.001);
        expect(p.height).toBeGreaterThan(0);
      }
    }
    expect(total).toBeGreaterThan(0); // the week actually has slots to lay out
  });
});
