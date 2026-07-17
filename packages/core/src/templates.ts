import type {
  AvailabilityTemplate,
  AvailabilityTemplateId,
  CoachId,
  Gender,
  Level,
  LocalTime,
  TrainingType,
  Weekday,
} from '@tpa/types';

import { parseLocalTime } from './time';

/**
 * The fields an admin supplies for an availability template. The id, validation,
 * and gender/level normalization are added by `buildAvailabilityTemplate` — a
 * draft is never trusted to already satisfy the DB's invariants.
 */
export interface TemplateDraft {
  coachId: CoachId;
  weekday: Weekday;
  startTime: LocalTime;
  endTime: LocalTime;
  trainingType: TrainingType;
  capacity: number;
  gender: Gender | null;
  level: Level | null;
  isActive: boolean;
}

export type TemplateInvalidReason =
  | 'end_not_after_start'
  | 'capacity_below_one'
  | 'group_requires_gender_level';

/**
 * A group session carries a REQUIRED gender + level; every other format (duo,
 * individual, trial) carries neither. This mirrors the DB CHECK constraint and is
 * the single predicate both apps use to decide whether to show/require those two
 * fields — so the client never builds a row the database will reject.
 */
export function templateRequiresGenderLevel(trainingType: TrainingType): boolean {
  return trainingType === 'group';
}

const minutesOf = (t: LocalTime): number => {
  const { hour, minute } = parseLocalTime(t);
  return hour * 60 + minute;
};

/**
 * Validate + NORMALIZE a template draft into a row that cannot violate the
 * gender/level CHECK constraint: group ⇒ both set, non-group ⇒ both null. The
 * normalization (forcing gender/level to null for non-group) happens HERE, not in
 * the UI, so a stale selection left over from switching session type can never
 * reach the store/DB. Also enforces end-after-start and capacity ≥ 1. Both create
 * and edit go through this one constructor; templates never cross midnight, so a
 * plain end > start check is correct (one-off sessions handle wrap separately).
 */
export function buildAvailabilityTemplate(
  id: AvailabilityTemplateId,
  draft: TemplateDraft,
): { ok: true; template: AvailabilityTemplate } | { ok: false; reason: TemplateInvalidReason } {
  if (minutesOf(draft.endTime) <= minutesOf(draft.startTime)) {
    return { ok: false, reason: 'end_not_after_start' };
  }
  if (draft.capacity < 1) return { ok: false, reason: 'capacity_below_one' };

  const needsGenderLevel = templateRequiresGenderLevel(draft.trainingType);
  if (needsGenderLevel && (draft.gender === null || draft.level === null)) {
    return { ok: false, reason: 'group_requires_gender_level' };
  }

  return {
    ok: true,
    template: {
      id,
      coachId: draft.coachId,
      weekday: draft.weekday,
      startTime: draft.startTime,
      endTime: draft.endTime,
      trainingType: draft.trainingType,
      capacity: Math.floor(draft.capacity),
      gender: needsGenderLevel ? draft.gender : null,
      level: needsGenderLevel ? draft.level : null,
      isActive: draft.isActive,
    },
  };
}
