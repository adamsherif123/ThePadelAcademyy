import { cairoCalendarDate } from '@tpa/core';
import { MOCK_NOW, mockBookings, mockSlots, mockTemplates } from '@tpa/mocks';
import type { AvailabilityTemplate, AvailabilityTemplateId, CoachId, IsoInstant, LocalTime } from '@tpa/types';
import { describe, expect, it, vi } from 'vitest';

// generate.ts imports lib/api → lib/supabase, whose module-load env guard throws
// under the node test env. We only exercise the pure planner + pre-network
// validation rejections (which never reach the client), so stub it past the guard.
vi.mock('../lib/supabase', () => ({ supabase: {} }));

import { createOneOffSlot, generateSlots } from './generate';
import { slotTimesFromWall } from './schedule';

/**
 * generateSlots is the PURE plan (templates + existing slots + range + now → a
 * dry-run preview). S10b moved commitGeneration to a bulk INSERT and createOneOffSlot
 * to an async INSERT, both proven server-side — so only the planner's skip logic and
 * createOneOffSlot's pre-network VALIDATION rejections are unit-testable here.
 */

const now = MOCK_NOW;
const pad = (n: number) => String(n).padStart(2, '0');

/** Slots with bookedCount reconciled from non-cancelled bookings (old store seeding). */
function seededSlots() {
  const seats = new Map<string, number>();
  for (const b of mockBookings) if (b.status !== 'cancelled') seats.set(b.slotId, (seats.get(b.slotId) ?? 0) + 1);
  return mockSlots.map((s) => ({ ...s, bookedCount: seats.get(s.id) ?? 0 }));
}

describe('generateSlots — idempotency (identity = template + Cairo date)', () => {
  const range = { fromDate: '2026-08-01', toDate: '2026-08-14' }; // beyond the fixture window

  it('re-running over an already-generated range is a no-op — every slot skips as already_exists', () => {
    const plan1 = generateSlots(mockTemplates, mockSlots, range, now);
    expect(plan1.toCreate.length).toBeGreaterThan(0);
    expect(plan1.skipped.length).toBe(0); // clean future range: nothing to skip the first time

    // Feed the freshly planned slots back as existing — the second run must skip them all.
    const existing = [...mockSlots, ...plan1.toCreate.map((p) => p.slot)];
    const plan2 = generateSlots(mockTemplates, existing, range, now);
    expect(plan2.toCreate.length).toBe(0); // nothing new the second time
    expect(plan2.skipped.length).toBe(plan1.toCreate.length);
    expect(plan2.skipped.every((s) => s.reason === 'already_exists')).toBe(true);
  });

  it('identity survives the random slot id — a differently-id’d slot on the same template+date still collides', () => {
    const plan = generateSlots(mockTemplates, mockSlots, range, now);
    const keys = plan.toCreate.map((p) => {
      const c = cairoCalendarDate(p.slot.startsAt);
      return `${p.template.id}|${c.year}-${pad(c.month)}-${pad(c.day)}`;
    });
    expect(new Set(keys).size).toBe(keys.length); // no dupes within one plan
  });
});

describe('generateSlots — never touches an existing (or booked) session', () => {
  it('a date already in the fixtures generates nothing new for that template', () => {
    const seeded = seededSlots();
    const booked = seeded.find(
      (s) => s.status === 'published' && s.templateId !== null && s.bookedCount > 0,
    );
    if (!booked) throw new Error('no booked template slot in fixtures');
    const c = cairoCalendarDate(booked.startsAt);
    const day = `${c.year}-${pad(c.month)}-${pad(c.day)}`;

    const plan = generateSlots(mockTemplates, seeded, { fromDate: day, toDate: day }, now);
    // Nothing planned touches the booked slot, and its whole day is already present.
    expect(plan.toCreate.some((p) => p.slot.id === booked.id)).toBe(false);
    expect(plan.skipped.some((s) => s.template.id === booked.templateId && s.reason === 'already_exists')).toBe(true);
  });
});

describe('generateSlots — Cairo DST across the spring boundary (via @tpa/core)', () => {
  it('the same 17:00 wall time is +02 before 24 Apr 2026 and +03 after', () => {
    // Egypt springs forward on the last Friday of April (24 Apr 2026).
    const plan = generateSlots(
      mockTemplates,
      [],
      { fromDate: '2026-04-20', toDate: '2026-04-30' },
      '2026-04-01T00:00:00.000Z' as IsoInstant,
    );
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
    const overlapper: AvailabilityTemplate = {
      id: 'at_overlap_test' as AvailabilityTemplateId,
      coachId: 'co_hany' as CoachId,
      weekday: 3,
      startTime: '17:30' as LocalTime,
      endTime: '18:30' as LocalTime,
      trainingType: 'group',
      capacity: 4,
      gender: 'men',
      level: 'beginner',
      isActive: true,
    };
    const templates = [...mockTemplates, overlapper];

    const plan = generateSlots(templates, [], { fromDate: '2026-08-01', toDate: '2026-08-31' }, now);
    const conflicts = plan.skipped.filter((s) => s.reason === 'coach_conflict');
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts.every((s) => s.conflictWith !== undefined)).toBe(true);
    expect(plan.toCreate.length).toBeGreaterThan(0); // batch didn't collapse
  });
});

describe('generateSlots — past excluded, inactive ignored', () => {
  it('candidates whose start is at/before now are skipped as in_past', () => {
    const plan = generateSlots(mockTemplates, [], { fromDate: '2026-07-01', toDate: '2026-07-05' }, now); // before MOCK_NOW
    expect(plan.toCreate.length).toBe(0);
    expect(plan.skipped.length).toBeGreaterThan(0);
    expect(plan.skipped.every((s) => s.reason === 'in_past')).toBe(true);
  });

  it('a paused template is never considered — not created, not even reported as skipped', () => {
    const paused = mockTemplates.find((t) => !t.isActive);
    if (!paused) throw new Error('no paused template in fixtures');
    const plan = generateSlots(mockTemplates, [], { fromDate: '2026-08-01', toDate: '2026-08-31' }, now);
    expect(plan.toCreate.some((p) => p.template.id === paused.id)).toBe(false);
    expect(plan.skipped.some((s) => s.template.id === paused.id)).toBe(false);
  });
});

describe('createOneOffSlot — validation rejections (return before any network call)', () => {
  const future = slotTimesFromWall(2026, 8, 10, 8 * 60, 90); // 8 AM — outside operating hours, allowed

  it('rejects end before or equal to start', async () => {
    const res = await createOneOffSlot(
      { coachId: 'co_karim' as CoachId, trainingType: 'individual', capacity: 1, gender: null, level: null, startsAt: future.endsAt, endsAt: future.startsAt },
      now,
    );
    expect(res.ok ? null : res.reason).toBe('end_before_start');
  });

  it('rejects a start in the past', async () => {
    const past = slotTimesFromWall(2026, 7, 1, 18 * 60, 90);
    const res = await createOneOffSlot(
      { coachId: 'co_karim' as CoachId, trainingType: 'individual', capacity: 1, gender: null, level: null, startsAt: past.startsAt, endsAt: past.endsAt },
      now,
    );
    expect(res.ok ? null : res.reason).toBe('in_past');
  });

  it('rejects a capacity below one', async () => {
    const res = await createOneOffSlot(
      { coachId: 'co_karim' as CoachId, trainingType: 'individual', capacity: 0, gender: null, level: null, startsAt: future.startsAt, endsAt: future.endsAt },
      now,
    );
    expect(res.ok ? null : res.reason).toBe('capacity_below_one');
  });

  it('requires gender + level for a group one-off', async () => {
    const res = await createOneOffSlot(
      { coachId: 'co_hany' as CoachId, trainingType: 'group', capacity: 4, gender: null, level: null, startsAt: future.startsAt, endsAt: future.endsAt },
      now,
    );
    expect(res.ok ? null : res.reason).toBe('group_requires_gender_level');
  });
});
