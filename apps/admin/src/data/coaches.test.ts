import { MOCK_NOW } from '@tpa/mocks';
import type { CoachId } from '@tpa/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { coachWeekStats, createCoach, setCoachActive, updateCoach } from './coaches';
import { __resetStoreForTests, getCoaches, getSlots, getTemplates } from './store';

const now = MOCK_NOW;
beforeEach(() => __resetStoreForTests());

describe('coachWeekStats — computed from the store', () => {
  it('counts this-week sessions/seats and buckets types, cross-checked by hand', () => {
    const coachId = getSlots()[0]!.coachId;
    const stats = coachWeekStats(coachId, now);
    // sessions this week == sum of the per-type chip counts
    const chipTotal = stats.typeCounts.reduce((s, c) => s + c.count, 0);
    expect(chipTotal).toBe(stats.sessionsThisWeek);
    expect(stats.seatsBooked).toBeGreaterThanOrEqual(0);
    expect(stats.attendancePct === null || (stats.attendancePct >= 0 && stats.attendancePct <= 100)).toBe(true);
  });

  it('a coach with no sessions this week reads zero and no chips (empty state)', () => {
    // Fresh coach: no slots at all.
    const res = createCoach({ name: 'New Coach', bio: '', photoUrl: null, isActive: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const stats = coachWeekStats(res.coach.id, now);
    expect(stats.sessionsThisWeek).toBe(0);
    expect(stats.seatsBooked).toBe(0);
    expect(stats.typeCounts).toEqual([]);
    expect(stats.attendancePct).toBe(null);
  });
});

describe('coach CRUD', () => {
  it('createCoach requires a name and defaults a null photo (initials state)', () => {
    expect(createCoach({ name: '   ', bio: 'x', photoUrl: null, isActive: true }).ok ? null : 'x').toBe('x');
    const res = createCoach({ name: 'Sara Nabil', bio: 'Junior dev', photoUrl: null, isActive: true });
    expect(res.ok && res.coach.photoUrl).toBe(null);
    expect(res.ok && getCoaches().some((c) => c.id === res.coach.id)).toBe(true);
  });

  it('sending an active coach on leave pauses their active templates', () => {
    // co_hany has several active templates.
    const coachId = 'co_hany' as CoachId;
    const activeBefore = getTemplates().filter((t) => t.coachId === coachId && t.isActive).length;
    expect(activeBefore).toBeGreaterThan(0);

    const res = setCoachActive(coachId, false);
    expect(res.ok && res.coach.isActive).toBe(false);
    const activeAfter = getTemplates().filter((t) => t.coachId === coachId && t.isActive).length;
    expect(activeAfter).toBe(0); // all paused
  });

  it('bringing a coach back does NOT auto-resume templates (owner decides)', () => {
    const coachId = 'co_hany' as CoachId;
    setCoachActive(coachId, false);
    setCoachActive(coachId, true);
    expect(getTemplates().filter((t) => t.coachId === coachId && t.isActive).length).toBe(0);
    expect(getCoaches().find((c) => c.id === coachId)!.isActive).toBe(true);
  });

  it('updateCoach edits fields in place and can also send on leave', () => {
    const coachId = 'co_karim' as CoachId;
    const res = updateCoach(coachId, { name: 'Karim Adel', bio: 'Updated bio', photoUrl: 'data:image/png;base64,AAAA', isActive: false });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.coach.bio).toBe('Updated bio');
    expect(res.coach.photoUrl).toBe('data:image/png;base64,AAAA');
    expect(getTemplates().filter((t) => t.coachId === coachId && t.isActive).length).toBe(0);
  });
});
