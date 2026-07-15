import type { AvailabilityTemplate, IsoInstant, LocalTime } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import {
  cairoCalendarDate,
  cairoOffsetMs,
  cairoWallTimeToInstant,
  materializeTemplateSlot,
} from './time';

const HOUR = 3_600_000;

/**
 * 2026 Cairo DST (from tzdata): spring-forward Fri Apr 24 (+02 -> +03),
 * fall-back Fri Oct 30 (+03 -> +02). A 6pm Cairo session is therefore 16:00Z in
 * winter but 15:00Z in summer — the whole reason a fixed offset is wrong.
 */
describe('cairoOffsetMs', () => {
  it('is +2h in winter and +3h during DST', () => {
    expect(cairoOffsetMs(new Date('2026-01-15T12:00:00Z'))).toBe(2 * HOUR);
    expect(cairoOffsetMs(new Date('2026-07-14T12:00:00Z'))).toBe(3 * HOUR);
    expect(cairoOffsetMs(new Date('2026-04-20T12:00:00Z'))).toBe(2 * HOUR); // before Apr 24
    expect(cairoOffsetMs(new Date('2026-05-01T12:00:00Z'))).toBe(3 * HOUR); // after Apr 24
    expect(cairoOffsetMs(new Date('2026-10-25T12:00:00Z'))).toBe(3 * HOUR); // before Oct 30
    expect(cairoOffsetMs(new Date('2026-11-01T12:00:00Z'))).toBe(2 * HOUR); // after Oct 30
  });
});

const groupTemplate: AvailabilityTemplate = {
  id: 'at_test' as AvailabilityTemplate['id'],
  coachId: 'co_test' as AvailabilityTemplate['coachId'],
  weekday: 0,
  startTime: '18:00' as LocalTime,
  endTime: '19:00' as LocalTime,
  trainingType: 'group',
  capacity: 4,
  gender: 'men',
  level: 'beginner',
  isActive: true,
};

describe('materializeTemplateSlot across the Cairo DST boundary', () => {
  it('spring: winter dates use +02, summer dates use +03', () => {
    // Before spring-forward (Apr 24): +02 => 18:00 Cairo is 16:00Z
    expect(materializeTemplateSlot(groupTemplate, { year: 2026, month: 4, day: 20 })).toEqual({
      startsAt: '2026-04-20T16:00:00.000Z',
      endsAt: '2026-04-20T17:00:00.000Z',
    });
    // After spring-forward: +03 => 18:00 Cairo is 15:00Z
    expect(materializeTemplateSlot(groupTemplate, { year: 2026, month: 5, day: 1 })).toEqual({
      startsAt: '2026-05-01T15:00:00.000Z',
      endsAt: '2026-05-01T16:00:00.000Z',
    });
  });

  it('fall: summer dates use +03, winter dates use +02', () => {
    // Before fall-back (Oct 30): still +03 => 15:00Z
    expect(materializeTemplateSlot(groupTemplate, { year: 2026, month: 10, day: 25 })).toEqual({
      startsAt: '2026-10-25T15:00:00.000Z',
      endsAt: '2026-10-25T16:00:00.000Z',
    });
    // After fall-back: +02 => 16:00Z
    expect(materializeTemplateSlot(groupTemplate, { year: 2026, month: 11, day: 1 })).toEqual({
      startsAt: '2026-11-01T16:00:00.000Z',
      endsAt: '2026-11-01T17:00:00.000Z',
    });
  });

  it('a naive fixed +02 offset would be wrong in summer (regression guard)', () => {
    const summer = materializeTemplateSlot(groupTemplate, { year: 2026, month: 7, day: 14 });
    const naiveFixedPlus2 = '2026-07-14T16:00:00.000Z'; // what a wrong fixed-offset impl yields
    expect(summer.startsAt).toBe('2026-07-14T15:00:00.000Z');
    expect(summer.startsAt).not.toBe(naiveFixedPlus2);
  });
});

describe('cairoWallTimeToInstant / cairoCalendarDate round-trip', () => {
  it('round-trips a summer wall time back to the same Cairo calendar date', () => {
    const instant = cairoWallTimeToInstant(2026, 7, 14, 18, 0);
    expect(instant).toBe('2026-07-14T15:00:00.000Z');
    expect(cairoCalendarDate(instant)).toEqual({ year: 2026, month: 7, day: 14, weekday: 2 });
  });

  it('maps a late-evening UTC instant to the correct Cairo day', () => {
    // 23:30Z in summer is 02:30 next day in Cairo (+03).
    const instant = '2026-07-14T23:30:00.000Z' as IsoInstant;
    expect(cairoCalendarDate(instant)).toEqual({ year: 2026, month: 7, day: 15, weekday: 3 });
  });
});
