import type { IsoInstant } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import { sessionCountdown } from './schedule';

/**
 * Cairo is UTC+2 in winter and UTC+3 in summer. Every `now` here is written in
 * UTC and the comment says what it is in Cairo, because the whole point of this
 * helper is that "tomorrow" is a Cairo calendar fact rather than a 24-hour one.
 */
const at = (iso: string) => iso as IsoInstant;

describe('sessionCountdown', () => {
  // Late September → Cairo is UTC+3.
  const now = at('2026-09-28T16:00:00.000Z'); // 7:00 PM Cairo, Monday

  it('is "Now" once it has started, and for anything already past', () => {
    expect(sessionCountdown(at('2026-09-28T16:00:00.000Z'), now)).toBe('Now');
    expect(sessionCountdown(at('2026-09-28T15:00:00.000Z'), now)).toBe('Now');
  });

  it('counts minutes under the hour', () => {
    expect(sessionCountdown(at('2026-09-28T16:25:00.000Z'), now)).toBe('In 25 min');
    expect(sessionCountdown(at('2026-09-28T16:59:00.000Z'), now)).toBe('In 59 min');
  });

  it('counts hours for later the same Cairo day', () => {
    expect(sessionCountdown(at('2026-09-28T19:00:00.000Z'), now)).toBe('In 3 hours');
    expect(sessionCountdown(at('2026-09-28T17:30:00.000Z'), now)).toBe('In 2 hours');
  });

  it('is singular at one hour', () => {
    expect(sessionCountdown(at('2026-09-28T17:00:00.000Z'), now)).toBe('In 1 hour');
  });

  it('says "Tomorrow" for the next Cairo day', () => {
    // 7:30 PM Cairo on Tuesday — 24.5 hours out.
    expect(sessionCountdown(at('2026-09-29T16:30:00.000Z'), now)).toBe('Tomorrow');
  });

  // The case the Cairo-day rule exists for. At 11 PM Cairo, a session at 7:30 PM
  // "tomorrow" is 20.5 hours away — under 24, and a naive helper would call it
  // "In 21 hours", which is true and useless.
  it('says "Tomorrow" even when it is under 24 hours away', () => {
    const lateTonight = at('2026-09-28T20:00:00.000Z'); // 11:00 PM Cairo
    expect(sessionCountdown(at('2026-09-29T16:30:00.000Z'), lateTonight)).toBe('Tomorrow');
  });

  // And the mirror: more than 24 hours away but still the NEXT Cairo day.
  it('says "Tomorrow" when it is over 24 hours away but still the next day', () => {
    const earlyToday = at('2026-09-28T04:00:00.000Z'); // 7:00 AM Cairo
    expect(sessionCountdown(at('2026-09-29T17:00:00.000Z'), earlyToday)).toBe('Tomorrow'); // 8 PM Cairo Tue
  });

  it('counts Cairo days beyond tomorrow', () => {
    expect(sessionCountdown(at('2026-09-30T16:30:00.000Z'), now)).toBe('In 2 days');
    expect(sessionCountdown(at('2026-10-05T16:30:00.000Z'), now)).toBe('In 7 days');
  });

  // Counted in calendar days, not by dividing hours: 6:00 AM on Wednesday is 35
  // hours out from 7 PM Monday, which rounds to "1 day" the naive way and is
  // plainly two sleeps away.
  it('counts the DAY, not the hours, for an early-morning session', () => {
    expect(sessionCountdown(at('2026-09-30T03:00:00.000Z'), now)).toBe('In 2 days');
  });

  // Egypt ends DST in late October (UTC+3 → UTC+2). A day either side of the
  // change is still one day, however many hours it contains.
  it('is not thrown off by the DST change', () => {
    const before = at('2026-10-29T16:00:00.000Z'); // Thu, Cairo
    const after = at('2026-10-30T16:00:00.000Z'); // Fri, Cairo
    expect(sessionCountdown(after, before)).toBe('Tomorrow');
  });
});
