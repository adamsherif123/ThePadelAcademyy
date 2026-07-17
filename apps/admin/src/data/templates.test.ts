import type { AvailabilityTemplateId, CoachId, LocalTime } from '@tpa/types';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTemplate, deleteTemplate, setTemplateActive, updateTemplate } from './templates';
import { __resetStoreForTests, getSlots, getTemplates } from './store';

beforeEach(() => __resetStoreForTests());

const draft = {
  coachId: 'co_hany' as CoachId,
  weekday: 0 as const,
  startTime: '17:00' as LocalTime,
  endTime: '18:30' as LocalTime,
  trainingType: 'group' as const,
  capacity: 4,
  gender: 'men' as const,
  level: 'beginner' as const,
  isActive: true,
};

describe('createTemplate — normalizes to a DB-CHECK-safe row', () => {
  it('creates a group template with its gender + level', () => {
    const res = createTemplate(draft);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(getTemplates().some((t) => t.id === res.template.id)).toBe(true);
    expect(res.template.gender).toBe('men');
    expect(res.template.level).toBe('beginner');
  });

  it('forces gender/level to null for a non-group type even if supplied', () => {
    const res = createTemplate({ ...draft, trainingType: 'duo', capacity: 2, gender: 'men', level: 'beginner' });
    expect(res.ok && res.template.gender).toBe(null);
    expect(res.ok && res.template.level).toBe(null);
  });

  it('rejects a group template missing gender/level', () => {
    const res = createTemplate({ ...draft, gender: null, level: null });
    expect(res.ok ? null : res.reason).toBe('group_requires_gender_level');
  });

  it('rejects end at/before start, and capacity below 1', () => {
    expect(createTemplate({ ...draft, endTime: '17:00' as LocalTime }).ok ? null : 'x').toBe('x');
    const bad = createTemplate({ ...draft, endTime: '16:00' as LocalTime });
    expect(bad.ok ? null : bad.reason).toBe('end_not_after_start');
    const zero = createTemplate({ ...draft, capacity: 0 });
    expect(zero.ok ? null : zero.reason).toBe('capacity_below_one');
  });
});

describe('updateTemplate', () => {
  it('edits in place, preserving the id (so generated slots stay linked)', () => {
    const id = 'at_grp_men_beg_sun' as AvailabilityTemplateId;
    const res = updateTemplate(id, { ...draft, capacity: 6 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.template.id).toBe(id);
    expect(getTemplates().find((t) => t.id === id)!.capacity).toBe(6);
  });

  it('returns template_missing for an unknown id', () => {
    const res = updateTemplate('at_nope' as AvailabilityTemplateId, draft);
    expect(res.ok ? null : res.reason).toBe('template_missing');
  });
});

describe('setTemplateActive — the reversible alternative to deleting', () => {
  it('pauses and resumes without touching anything else', () => {
    const id = 'at_grp_men_beg_sun' as AvailabilityTemplateId;
    expect(setTemplateActive(id, false).ok).toBe(true);
    expect(getTemplates().find((t) => t.id === id)!.isActive).toBe(false);
    expect(setTemplateActive(id, true).ok).toBe(true);
    expect(getTemplates().find((t) => t.id === id)!.isActive).toBe(true);
  });
});

describe('deleteTemplate — removes the rule, keeps its sessions', () => {
  it('deletes the template but leaves every slot it already generated', () => {
    const id = 'at_grp_men_beg_sun' as AvailabilityTemplateId;
    const generated = getSlots().filter((s) => s.templateId === id).length;
    expect(generated).toBeGreaterThan(0);

    expect(deleteTemplate(id).ok).toBe(true);
    expect(getTemplates().some((t) => t.id === id)).toBe(false);
    expect(getSlots().filter((s) => s.templateId === id).length).toBe(generated); // untouched
  });
});
