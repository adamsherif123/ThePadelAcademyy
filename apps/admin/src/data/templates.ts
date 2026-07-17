import {
  ID_PREFIXES,
  buildAvailabilityTemplate,
  newId,
  type TemplateDraft,
  type TemplateInvalidReason,
} from '@tpa/core';
import type { AvailabilityTemplate, AvailabilityTemplateId } from '@tpa/types';

import { commitTemplateDelete, commitTemplateSave, getTemplates } from './store';

/**
 * The availability-template CRUD seam. Every write goes through @tpa/core's
 * buildAvailabilityTemplate, which validates and normalizes the draft so a row
 * that would fail the DB's gender/level CHECK can never be committed. S10 replaces
 * these bodies with INSERT/UPDATE/DELETE (or one RPC); the screens don't change.
 */

export type SaveTemplateResult =
  | { ok: true; template: AvailabilityTemplate }
  | { ok: false; reason: TemplateInvalidReason | 'template_missing' };

/** Create a new template with a fresh id. */
export function createTemplate(draft: TemplateDraft): SaveTemplateResult {
  const built = buildAvailabilityTemplate(
    newId(ID_PREFIXES.availabilityTemplate) as AvailabilityTemplateId,
    draft,
  );
  if (!built.ok) return built;
  commitTemplateSave(built.template);
  return built;
}

/** Edit an existing template IN PLACE (id preserved → its generated slots stay linked). */
export function updateTemplate(id: AvailabilityTemplateId, draft: TemplateDraft): SaveTemplateResult {
  if (!getTemplates().some((t) => t.id === id)) return { ok: false, reason: 'template_missing' };
  const built = buildAvailabilityTemplate(id, draft);
  if (!built.ok) return built;
  commitTemplateSave(built.template);
  return built;
}

/**
 * Pause or resume a rule. Pausing stops it from generating FUTURE slots; resuming
 * lets it generate again. Already-generated sessions are never touched either way —
 * this is the safe, reversible alternative to deleting.
 */
export function setTemplateActive(id: AvailabilityTemplateId, isActive: boolean): SaveTemplateResult {
  const current = getTemplates().find((t) => t.id === id);
  if (!current) return { ok: false, reason: 'template_missing' };
  const updated = { ...current, isActive };
  commitTemplateSave(updated);
  return { ok: true, template: updated };
}

/**
 * Delete a rule entirely. The sessions it already generated remain on the calendar
 * (see the report on delete-vs-deactivate) — deletion only removes the recurring
 * rule, never a scheduled or booked session.
 */
export function deleteTemplate(id: AvailabilityTemplateId): { ok: boolean } {
  if (!getTemplates().some((t) => t.id === id)) return { ok: false };
  commitTemplateDelete(id);
  return { ok: true };
}
