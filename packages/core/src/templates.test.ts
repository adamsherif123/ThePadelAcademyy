import type { AvailabilityTemplateId, LocalTime } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import { buildAvailabilityTemplate, templateRequiresGenderLevel, type TemplateDraft } from './templates';

const id = (s: string): AvailabilityTemplateId => s as AvailabilityTemplateId;

const baseDraft: TemplateDraft = {
  coachId: 'co_test' as TemplateDraft['coachId'],
  weekday: 0,
  startTime: '17:00' as LocalTime,
  endTime: '18:00' as LocalTime,
  trainingType: 'group',
  capacity: 4,
  gender: 'men',
  level: 'beginner',
  isActive: true,
};

describe('buildAvailabilityTemplate — open (untyped) recurring rules', () => {
  it('normalizes an OPEN (null) draft to the CHECK-legal untyped shape: type/gender/level all null', () => {
    const res = buildAvailabilityTemplate(id('at_open'), {
      ...baseDraft,
      trainingType: null,
      // A stale gender/level left over from switching the type picker must never
      // survive normalization for an open rule — mirrors the non-group case.
      gender: 'ladies',
      level: 'intermediate',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.template.trainingType).toBeNull();
    expect(res.template.gender).toBeNull();
    expect(res.template.level).toBeNull();
  });

  it('an open draft never triggers group_requires_gender_level — there is no group to require it', () => {
    const res = buildAvailabilityTemplate(id('at_open2'), {
      ...baseDraft,
      trainingType: null,
      gender: null,
      level: null,
    });
    expect(res.ok).toBe(true);
  });

  it('a typed group draft still requires gender + level (regression, unaffected by nullability)', () => {
    const res = buildAvailabilityTemplate(id('at_grp'), { ...baseDraft, trainingType: 'group', gender: null, level: null });
    expect(res).toEqual({ ok: false, reason: 'group_requires_gender_level' });
  });

  it('templateRequiresGenderLevel itself is unchanged — callers guard on non-null before calling it', () => {
    expect(templateRequiresGenderLevel('group')).toBe(true);
    expect(templateRequiresGenderLevel('duo')).toBe(false);
  });
});
