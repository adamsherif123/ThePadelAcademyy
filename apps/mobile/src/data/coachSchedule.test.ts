import type { IsoInstant, SessionSlot } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import { coachSchedule, startsInLabel } from './coachSchedule';

// 2026-03-15 09:00Z is 11:00 Cairo (UTC+2 in March), so "today" in Cairo runs from
// 22:00Z the previous day to 22:00Z this one — the offsets below stay well inside it
// except where a test deliberately crosses into tomorrow.
const NOW = '2026-03-15T09:00:00.000Z' as IsoInstant;
const at = (hoursFromNow: number): IsoInstant =>
  new Date(new Date(NOW).getTime() + hoursFromNow * 3_600_000).toISOString() as IsoInstant;

function slot(id: string, startsIn: number, lengthHours = 1): SessionSlot {
  return {
    id: id as SessionSlot['id'],
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
