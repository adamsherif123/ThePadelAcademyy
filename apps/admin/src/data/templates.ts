import {
  ID_PREFIXES,
  buildAvailabilityTemplate,
  newId,
  type TemplateDraft,
  type TemplateInvalidReason,
} from '@tpa/core';
import type { AvailabilityTemplate, AvailabilityTemplateId } from '@tpa/types';

import {
  deleteTemplateRpc,
  insertTemplate,
  updateTemplate as updateTemplateApi,
  type DeleteTemplateResult,
} from '../lib/api';
import { TOUCHED } from '../lib/queryClient';
import { runRpc, runWrite } from './queries';

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

/**
 * Retire a rule: cancels every FUTURE session it generated (refund + notify via
 * the existing cancel_session RPC, one call per slot — the atomic delete_template
 * RPC does the cancelling, the retiring, and the idempotency check all in one
 * transaction) and marks it deleted. Past sessions are untouched. Touches
 * templates AND everything cancel_session touches (bookings/slots/batches), so
 * the caller's list refreshes with the right counts with no manual refetch.
 */
export function deleteTemplate(
  id: AvailabilityTemplateId,
): Promise<DeleteTemplateResult | { ok: false; reason: 'network' }> {
  return runRpc(() => deleteTemplateRpc(id), [...TOUCHED.templates, ...TOUCHED.booking]);
}
