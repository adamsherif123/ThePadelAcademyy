import type { AvailabilityTemplate, IsoInstant, LocalTime, SessionSlot } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import { isDayOpen, templateCoveredWeekdays } from './availability';

const sunTemplate: AvailabilityTemplate = {
  id: 'at_sun' as AvailabilityTemplate['id'],
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

const pausedMonTemplate: AvailabilityTemplate = { ...sunTemplate, id: 'at_mon' as AvailabilityTemplate['id'], weekday: 1, isActive: false };

function slotOn(dateIso: string, status: SessionSlot['status'] = 'published'): SessionSlot {
  return {
    id: 'sl_test' as SessionSlot['id'],
    coachId: 'co_test' as SessionSlot['coachId'],
    startsAt: dateIso as IsoInstant,
    endsAt: dateIso as IsoInstant,
    trainingType: null,
    capacity: 1,
    bookedCount: 0,
    gender: null,
    level: null,
    status,
    templateId: null,
    manuallyConfirmedAt: null,
    setByBookingAt: null,
  };
}

describe('templateCoveredWeekdays', () => {
  it('includes only weekdays with an ACTIVE template', () => {
    expect(templateCoveredWeekdays([sunTemplate, pausedMonTemplate])).toEqual(new Set([0]));
  });
});

describe('isDayOpen', () => {
  const templates = [sunTemplate, pausedMonTemplate];

  it('is open for a template-covered weekday even with zero slots generated', () => {
    // Sunday 2026-08-02, weekday 0 — template-covered, no slots at all.
    expect(isDayOpen(templates, [], 0, { year: 2026, month: 8, day: 2 })).toBe(true);
  });

  it('is closed for an uncovered weekday with no slots', () => {
    // Tuesday 2026-08-04, weekday 2 — no template, no slots.
    expect(isDayOpen(templates, [], 2, { year: 2026, month: 8, day: 4 })).toBe(false);
  });

  it('opens ONLY the specific date a one-off published slot falls on, not the whole weekday', () => {
    // A one-off published slot on Tue 2026-08-04 (weekday 2, template-uncovered).
    const slots = [slotOn('2026-08-04T15:00:00.000Z')];
    expect(isDayOpen(templates, slots, 2, { year: 2026, month: 8, day: 4 })).toBe(true);
    // The following Tuesday (2026-08-11) must NOT be opened by that one-off.
    expect(isDayOpen(templates, slots, 2, { year: 2026, month: 8, day: 11 })).toBe(false);
  });

  it('a cancelled-only slot does NOT open an otherwise-closed day', () => {
    const slots = [slotOn('2026-08-04T15:00:00.000Z', 'cancelled')];
    expect(isDayOpen(templates, slots, 2, { year: 2026, month: 8, day: 4 })).toBe(false);
  });

  it('a paused templates weekday stays closed regardless of its own slots elsewhere', () => {
    // Monday template is paused (isActive: false) — Monday itself is uncovered...
    expect(isDayOpen(templates, [], 1, { year: 2026, month: 8, day: 3 })).toBe(false);
    // ...but a published one-off ON that Monday date still opens that one date.
    const slots = [slotOn('2026-08-03T15:00:00.000Z')];
    expect(isDayOpen(templates, slots, 1, { year: 2026, month: 8, day: 3 })).toBe(true);
  });
});
