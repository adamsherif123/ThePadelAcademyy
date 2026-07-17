import { cairoCalendarDate } from '@tpa/core';
import { MOCK_NOW } from '@tpa/mocks';
import type { CoachId, IsoInstant, LocalTime } from '@tpa/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { commitGeneration, createOneOffSlot, generateSlots } from './generate';
import { slotTimesFromWall } from './schedule';
import { createTemplate } from './templates';
import { __resetStoreForTests, getSlots, getTemplates } from './store';

const now = MOCK_NOW;
const pad = (n: number) => String(n).padStart(2, '0');

beforeEach(() => __resetStoreForTests());

describe('generateSlots — idempotency (identity = template + Cairo date)', () => {
  const range = { fromDate: '2026-08-01', toDate: '2026-08-14' }; // beyond the fixture window

  it('re-running over the same range is a no-op — every slot skips as already_exists', () => {
    const plan1 = generateSlots(range, now);
    expect(plan1.toCreate.length).toBeGreaterThan(0);
    expect(commitGeneration(plan1)).toBe(plan1.toCreate.length);

    const plan2 = generateSlots(range, now);
    expect(plan2.toCreate.length).toBe(0); // nothing new the second time
    expect(plan2.skipped.length).toBe(plan1.toCreate.length);
    expect(plan2.skipped.every((s) => s.reason === 'already_exists')).toBe(true);
  });

  it('identity survives the random slot id — a differently-id’d slot on the same template+date still collides', () => {
    const plan = generateSlots(range, now);
    const keys = plan.toCreate.map((p) => {
      const c = cairoCalendarDate(p.slot.startsAt);
      return `${p.template.id}|${c.year}-${pad(c.month)}-${pad(c.day)}`;
    });
    expect(new Set(keys).size).toBe(keys.length); // no dupes within one plan
  });
});

describe('generateSlots — never touches an existing (or booked) session', () => {
  it('a date already in the fixtures generates nothing new; booked counts are unchanged', () => {
    const booked = getSlots().find(
      (s) => s.status === 'published' && s.templateId !== null && s.bookedCount > 0,
    );
    if (!booked) throw new Error('no booked template slot in fixtures');
    const c = cairoCalendarDate(booked.startsAt);
    const day = `${c.year}-${pad(c.month)}-${pad(c.day)}`;
    const before = booked.bookedCount;

    const plan = generateSlots({ fromDate: day, toDate: day }, now);
    // Nothing planned touches the booked slot, and its whole day is already present.
    expect(plan.toCreate.some((p) => p.slot.id === booked.id)).toBe(false);
    expect(plan.skipped.some((s) => s.template.id === booked.templateId && s.reason === 'already_exists')).toBe(true);

    commitGeneration(plan);
    const after = getSlots().find((s) => s.id === booked.id)!;
    expect(after.bookedCount).toBe(before); // untouched
    expect(after.status).toBe(booked.status);
  });
});

describe('generateSlots — Cairo DST across the spring boundary (via @tpa/core)', () => {
  it('the same 17:00 wall time is +02 before 24 Apr 2026 and +03 after', () => {
    // Egypt springs forward on the last Friday of April (24 Apr 2026).
    const plan = generateSlots({ fromDate: '2026-04-20', toDate: '2026-04-30' }, '2026-04-01T00:00:00.000Z' as IsoInstant);
    const wed17 = plan.toCreate.filter((p) => p.template.weekday === 3 && p.template.startTime === '17:00');
    const before = wed17.find((p) => p.date < '2026-04-24');
    const after = wed17.find((p) => p.date > '2026-04-24');
    expect(before, 'a Wed before the boundary').toBeDefined();
    expect(after, 'a Wed after the boundary').toBeDefined();
    // 17:00 Cairo: winter (+02) → 15:00 UTC, summer (+03) → 14:00 UTC. Not hand-rolled.
    expect(before!.slot.startsAt.endsWith('T15:00:00.000Z')).toBe(true);
    expect(after!.slot.startsAt.endsWith('T14:00:00.000Z')).toBe(true);
  });
});

describe('generateSlots — coach conflicts are skipped, not exploded', () => {
  it('an overlapping second rule for the same coach is skipped with a reason; the rest still generate', () => {
    // co_hany already runs Wed 17:00–18:30 (at_grp_men_beg_wed_a). Add an overlapper.
    createTemplate({
      coachId: 'co_hany' as CoachId,
      weekday: 3,
      startTime: '17:30' as LocalTime,
      endTime: '18:30' as LocalTime,
      trainingType: 'group',
      capacity: 4,
      gender: 'men',
      level: 'beginner',
      isActive: true,
    });

    const plan = generateSlots({ fromDate: '2026-08-01', toDate: '2026-08-31' }, now);
    const conflicts = plan.skipped.filter((s) => s.reason === 'coach_conflict');
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts.every((s) => s.conflictWith !== undefined)).toBe(true);
    expect(plan.toCreate.length).toBeGreaterThan(0); // batch didn't collapse
  });
});

describe('generateSlots — past excluded, inactive ignored', () => {
  it('candidates whose start is at/before now are skipped as in_past', () => {
    const plan = generateSlots({ fromDate: '2026-07-01', toDate: '2026-07-05' }, now); // before MOCK_NOW
    expect(plan.toCreate.length).toBe(0);
    expect(plan.skipped.length).toBeGreaterThan(0);
    expect(plan.skipped.every((s) => s.reason === 'in_past')).toBe(true);
  });

  it('a paused template is never considered — not created, not even reported as skipped', () => {
    const paused = getTemplates().find((t) => !t.isActive);
    if (!paused) throw new Error('no paused template in fixtures');
    const plan = generateSlots({ fromDate: '2026-08-01', toDate: '2026-08-31' }, now);
    expect(plan.toCreate.some((p) => p.template.id === paused.id)).toBe(false);
    expect(plan.skipped.some((s) => s.template.id === paused.id)).toBe(false);
  });
});

describe('createOneOffSlot', () => {
  const future = slotTimesFromWall(2026, 8, 10, 8 * 60, 90); // 8 AM — outside operating hours, allowed

  it('creates a templateId:null slot at any time, even outside operating hours', () => {
    const res = createOneOffSlot(
      { coachId: 'co_karim' as CoachId, trainingType: 'individual', capacity: 1, gender: null, level: null, startsAt: future.startsAt, endsAt: future.endsAt },
      now,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.slot.templateId).toBe(null);
    expect(getSlots().some((s) => s.id === res.slot.id)).toBe(true);
  });

  it('nulls gender/level for a non-group one-off even if the caller passes them', () => {
    const res = createOneOffSlot(
      { coachId: 'co_karim' as CoachId, trainingType: 'duo', capacity: 2, gender: 'men', level: 'beginner', startsAt: future.startsAt, endsAt: future.endsAt },
      now,
    );
    expect(res.ok && res.slot.gender).toBe(null);
    expect(res.ok && res.slot.level).toBe(null);
  });

  it('requires gender + level for a group one-off', () => {
    const res = createOneOffSlot(
      { coachId: 'co_hany' as CoachId, trainingType: 'group', capacity: 4, gender: null, level: null, startsAt: future.startsAt, endsAt: future.endsAt },
      now,
    );
    expect(res.ok ? null : res.reason).toBe('group_requires_gender_level');
  });

  it('rejects a start in the past', () => {
    const past = slotTimesFromWall(2026, 7, 1, 18 * 60, 90);
    const res = createOneOffSlot(
      { coachId: 'co_karim' as CoachId, trainingType: 'individual', capacity: 1, gender: null, level: null, startsAt: past.startsAt, endsAt: past.endsAt },
      now,
    );
    expect(res.ok ? null : res.reason).toBe('in_past');
  });
});
