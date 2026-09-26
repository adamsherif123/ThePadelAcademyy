import type { IsoInstant, SessionSlot } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import { coachDays, coachSchedule, sessionState, startsInLabel, typeSlices, weekStrip } from './coachSchedule';
import { MOCK_LOCATION_ID } from '@tpa/mocks';

// 2026-03-15 09:00Z is 11:00 Cairo (UTC+2 in March), so "today" in Cairo runs from
// 22:00Z the previous day to 22:00Z this one — the offsets below stay well inside it
// except where a test deliberately crosses into tomorrow.
const NOW = '2026-03-15T09:00:00.000Z' as IsoInstant;
const at = (hoursFromNow: number): IsoInstant =>
  new Date(new Date(NOW).getTime() + hoursFromNow * 3_600_000).toISOString() as IsoInstant;

function slot(id: string, startsIn: number, lengthHours = 1): SessionSlot {
  return {
    id: id as SessionSlot['id'],
    locationId: MOCK_LOCATION_ID,
    coachId: 'co_1' as SessionSlot['coachId'],
    startsAt: at(startsIn),
    endsAt: at(startsIn + lengthHours),
    trainingType: 'group',
    capacity: 4,
    bookedCount: 2,
    gender: 'men',
    level: 'beginner',
    status: 'published',
    templateId: null,
    manuallyConfirmedAt: null,
    setByBookingAt: null,
  };
}

describe('coachSchedule', () => {
  it('is empty when the coach has nothing upcoming', () => {
    expect(coachSchedule([], NOW)).toEqual({
      hero: null,
      heroInProgress: false,
      restOfToday: [],
      later: [],
    });
  });

  it('makes the next session the hero, and puts the rest of today behind it', () => {
    const s = coachSchedule([slot('a', 2), slot('b', 4), slot('c', 6)], NOW);
    expect(s.hero?.id).toBe('a');
    expect(s.heroInProgress).toBe(false);
    expect(s.restOfToday.map((x) => x.id)).toEqual(['b', 'c']);
    expect(s.later).toEqual([]);
  });

  it('prefers the session IN PROGRESS over the one that starts next', () => {
    // Mid-lesson, the roster in front of the coach should be the one on court.
    const running = slot('running', -0.5, 1.5);
    const s = coachSchedule([running, slot('next', 3)], NOW);
    expect(s.hero?.id).toBe('running');
    expect(s.heroInProgress).toBe(true);
    expect(s.restOfToday.map((x) => x.id)).toEqual(['next']);
  });

  it('drops sessions that have already finished', () => {
    // The fetch keeps a 12-hour tail so a RUNNING session is in hand; a finished one
    // is not schedule, it is history.
    const s = coachSchedule([slot('done', -4), slot('soon', 2)], NOW);
    expect(s.hero?.id).toBe('soon');
    expect([...s.restOfToday, ...s.later]).toEqual([]);
  });

  it('separates later days from the rest of today', () => {
    const s = coachSchedule([slot('today', 2), slot('tomorrow', 26), slot('nextweek', 24 * 7)], NOW);
    expect(s.hero?.id).toBe('today');
    expect(s.restOfToday).toEqual([]);
    expect(s.later.map((x) => x.id)).toEqual(['tomorrow', 'nextweek']);
  });

  it('orders by start time regardless of the order it is given them in', () => {
    const s = coachSchedule([slot('c', 6), slot('a', 2), slot('b', 4)], NOW);
    expect([s.hero, ...s.restOfToday].map((x) => x?.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('startsInLabel', () => {
  it('reads in minutes, hours, then days', () => {
    expect(startsInLabel(at(0.5), NOW)).toBe('in 30 minutes');
    expect(startsInLabel(at(1 / 60), NOW)).toBe('in 1 minute');
    expect(startsInLabel(at(3), NOW)).toBe('in 3 hours');
    expect(startsInLabel(at(48), NOW)).toBe('in 2 days');
  });

  it('says "now" once it has started, never a negative countdown', () => {
    expect(startsInLabel(at(0), NOW)).toBe('now');
    expect(startsInLabel(at(-1), NOW)).toBe('now');
  });
});

describe('coachDays', () => {
  it('groups by Cairo day, soonest first, and labels today and tomorrow', () => {
    const days = coachDays([slot('a', 2), slot('b', 5), slot('c', 26)], NOW);
    expect(days.map((d) => d.label)).toEqual(['Today', 'Tomorrow']);
    expect(days[0]?.sessions.map((s) => s.id)).toEqual(['a', 'b']);
    expect(days[1]?.sessions.map((s) => s.id)).toEqual(['c']);
  });

  it('DROPS a session the moment it ends — the schedule is what is left to teach', () => {
    const days = coachDays([slot('done', -3), slot('next', 2)], NOW);
    expect(days[0]?.sessions.map((s) => s.id)).toEqual(['next']);
  });

  it('keeps a session that is in progress — it has started, but it is not done', () => {
    // The reason the fetch holds a twelve-hour tail: startsAt is already past for a
    // running session, so without it the card would vanish the moment it began.
    const days = coachDays([slot('running', -0.5, 1.5)], NOW);
    expect(days[0]?.sessions.map((s) => s.id)).toEqual(['running']);
  });

  it('drops a whole day once everything on it has finished', () => {
    const days = coachDays([slot('done1', -4), slot('done2', -2), slot('tmrw', 26)], NOW);
    expect(days.map((d) => d.label)).toEqual(['Tomorrow']);
  });

  it('leaves a later day unlabelled, for the screen to render its date', () => {
    expect(coachDays([slot('later', 24 * 4)], NOW)[0]?.label).toBe('');
  });
});

describe('sessionState', () => {
  it('reads done / live / upcoming off the clock', () => {
    expect(sessionState(slot('a', -3), NOW)).toBe('done');
    expect(sessionState(slot('b', -0.5, 1.5), NOW)).toBe('live');
    expect(sessionState(slot('c', 2), NOW)).toBe('upcoming');
  });
});

describe('weekStrip', () => {
  it('is seven Sunday-first days, with today flagged', () => {
    const strip = weekStrip([], NOW);
    expect(strip).toHaveLength(7);
    expect(strip.map((d) => d.initial)).toEqual(['S', 'M', 'T', 'W', 'T', 'F', 'S']);
    expect(strip.filter((d) => d.isToday)).toHaveLength(1);
  });

  it('counts each day\'s sessions', () => {
    // NOW is Sunday 15 March 2026, 11:00 Cairo — index 0 of the strip.
    const strip = weekStrip([slot('a', 1), slot('b', 3), slot('c', 25)], NOW);
    const today = strip.findIndex((d) => d.isToday);
    expect(strip[today]?.count).toBe(2);
    expect(strip[today + 1]?.count).toBe(1);
  });
});

describe('typeSlices', () => {
  it('adds an "Other" row for sessions that are in no type bucket', () => {
    // The whole point: an open block or a trial counts in the month total but is in
    // none of the three buckets, so the three must never be presented as the total.
    const slices = typeSlices({ group: 3, duo: 1, individual: 1 }, 7);
    expect(slices.map((s) => s.label)).toEqual(['Group', 'Duo', 'Individual', 'Other']);
    expect(slices.find((s) => s.label === 'Other')?.count).toBe(2);
  });

  it('takes every fraction over the REAL total, so the bars describe the whole month', () => {
    const slices = typeSlices({ group: 3, duo: 1, individual: 1 }, 7);
    expect(slices.reduce((sum, s) => sum + s.fraction, 0)).toBeCloseTo(1, 10);
    expect(slices.find((s) => s.label === 'Group')?.fraction).toBeCloseTo(3 / 7, 10);
  });

  it('omits "Other" when the three buckets really are everything', () => {
    const slices = typeSlices({ group: 2, duo: 1, individual: 1 }, 4);
    expect(slices.map((s) => s.label)).toEqual(['Group', 'Duo', 'Individual']);
  });

  it('drops empty types, and survives a month with no sessions at all', () => {
    expect(typeSlices({ group: 2, duo: 0, individual: 0 }, 2).map((s) => s.label)).toEqual(['Group']);
    expect(typeSlices({ group: 0, duo: 0, individual: 0 }, 0)).toEqual([]);
  });
});
