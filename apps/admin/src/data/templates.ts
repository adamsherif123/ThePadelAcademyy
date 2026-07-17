import {
  ID_PREFIXES,
  buildAvailabilityTemplate,
  newId,
  type TemplateDraft,
  type TemplateInvalidReason,
} from '@tpa/core';
import type { AvailabilityTemplate, AvailabilityTemplateId } from '@tpa/types';

import { deleteTemplate as deleteTemplateApi, insertTemplate, updateTemplate as updateTemplateApi } from '../lib/api';
import { TOUCHED } from '../lib/queryClient';
import { runWrite } from './queries';

/**
 * Availability-template CRUD. @tpa/core's buildAvailabilityTemplate still validates
 * + normalizes the draft client-side (so a row that would fail the DB's gender/level
 * CHECK is caught early); the write itself is an is_admin()-gated INSERT/UPDATE/DELETE
 * (config, not money → no RPC). Never throws — returns a result.
 */
export type SaveTemplateResult =
  | { ok: true; template: AvailabilityTemplate }
  | { ok: false; reason: TemplateInvalidReason | 'template_missing' | 'network' };

function fields(t: AvailabilityTemplate) {
  return {
    coachId: t.coachId, weekday: t.weekday, startTime: t.startTime, endTime: t.endTime,
    trainingType: t.trainingType, capacity: t.capacity, gender: t.gender, level: t.level, isActive: t.isActive,
  };
}

export async function createTemplate(draft: TemplateDraft): Promise<SaveTemplateResult> {
  const built = buildAvailabilityTemplate(newId(ID_PREFIXES.availabilityTemplate) as AvailabilityTemplateId, draft);
  if (!built.ok) return built;
  const res = await runWrite(() => insertTemplate(fields(built.template)), TOUCHED.templates);
  return res.ok ? { ok: true, template: res.value } : { ok: false, reason: 'network' };
}

export async function updateTemplate(id: AvailabilityTemplateId, draft: TemplateDraft): Promise<SaveTemplateResult> {
  const built = buildAvailabilityTemplate(id, draft);
  if (!built.ok) return built;
  const res = await runWrite(() => updateTemplateApi(id, fields(built.template)), TOUCHED.templates);
  return res.ok ? { ok: true, template: res.value } : { ok: false, reason: 'network' };
}

/** Pause/resume a rule (stops/starts FUTURE generation; existing sessions untouched). */
export async function setTemplateActive(id: AvailabilityTemplateId, isActive: boolean): Promise<SaveTemplateResult> {
  const res = await runWrite(() => updateTemplateApi(id, { isActive }), TOUCHED.templates);
  return res.ok ? { ok: true, template: res.value } : { ok: false, reason: 'network' };
}

/** Delete a rule; its already-generated sessions stay on the calendar. */
export async function deleteTemplate(id: AvailabilityTemplateId): Promise<{ ok: boolean }> {
  const res = await runWrite(() => deleteTemplateApi(id), TOUCHED.templates);
  return { ok: res.ok };
}
