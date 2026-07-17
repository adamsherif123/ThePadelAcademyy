import { templateRequiresGenderLevel } from '@tpa/core';
import type { CoachId, Gender, Level, TrainingType, Weekday } from '@tpa/types';
import { useState } from 'react';

/**
 * The field LOGIC shared by the template modal and the one-off modal: the option
 * lists, the per-type default capacity, and the group-gender/level rule. Both
 * modals compose this so the two never drift — a session's coach/type/capacity/
 * gender/level behave identically whether it's a recurring rule or a one-off. Each
 * modal lays out its OWN time fields (a template has a weekday + start/end; a
 * one-off has a concrete date + start + duration), which is the only real
 * difference between them.
 */

export const SESSION_TYPE_OPTIONS: readonly { value: TrainingType; label: string }[] = [
  { value: 'group', label: 'Group' },
  { value: 'duo', label: 'Duo' },
  { value: 'individual', label: 'Individual' },
  { value: 'trial', label: 'Trial' },
];

export const GENDER_OPTIONS: readonly { value: Gender; label: string }[] = [
  { value: 'men', label: "Men's" },
  { value: 'ladies', label: "Ladies'" },
];

export const LEVEL_OPTIONS: readonly { value: Level; label: string }[] = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'adv_beginner', label: 'Adv. Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
];

export const WEEKDAY_OPTIONS: readonly { value: Weekday; label: string }[] = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

/** Sane session durations for a concrete-time form (the select IS the guard). */
export const DURATION_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '1 hr' },
  { value: 90, label: '1.5 hr' },
  { value: 120, label: '2 hr' },
  { value: 150, label: '2.5 hr' },
  { value: 180, label: '3 hr' },
];

/** The capacity a type leads with — group fills a court (4), a duo is 2, the rest 1. */
export const DEFAULT_CAPACITY: Record<TrainingType, number> = {
  group: 4,
  duo: 2,
  individual: 1,
  trial: 1,
};

export interface SessionDraftInit {
  coachId: CoachId;
  trainingType: TrainingType;
  capacity: number;
  gender: Gender | null;
  level: Level | null;
}

export interface SessionDraft {
  coachId: CoachId;
  setCoachId: (id: CoachId) => void;
  trainingType: TrainingType;
  /** Changing the type LEADS the capacity to that type's default (still overridable). */
  setTrainingType: (t: TrainingType) => void;
  capacity: number;
  setCapacity: (n: number) => void;
  gender: Gender;
  setGender: (g: Gender) => void;
  level: Level;
  setLevel: (l: Level) => void;
  /** Whether gender + level apply (group only) — drives showing the two fields. */
  requiresGenderLevel: boolean;
  /** The values to persist: the chosen gender/level for group, null otherwise. */
  effectiveGender: Gender | null;
  effectiveLevel: Level | null;
}

/**
 * Local form state for a session's shared fields. gender/level are always held as
 * real values (so switching to group never lands on an empty select), but the
 * EFFECTIVE values are nulled for non-group — matching what the seam will persist.
 */
export function useSessionDraft(init: SessionDraftInit): SessionDraft {
  const [coachId, setCoachId] = useState<CoachId>(init.coachId);
  const [trainingType, setType] = useState<TrainingType>(init.trainingType);
  const [capacity, setCapacity] = useState<number>(init.capacity);
  const [gender, setGender] = useState<Gender>(init.gender ?? 'men');
  const [level, setLevel] = useState<Level>(init.level ?? 'beginner');

  const requiresGenderLevel = templateRequiresGenderLevel(trainingType);

  const setTrainingType = (t: TrainingType) => {
    setType(t);
    setCapacity(DEFAULT_CAPACITY[t]);
  };

  return {
    coachId,
    setCoachId,
    trainingType,
    setTrainingType,
    capacity,
    setCapacity,
    gender,
    setGender,
    level,
    setLevel,
    requiresGenderLevel,
    effectiveGender: requiresGenderLevel ? gender : null,
    effectiveLevel: requiresGenderLevel ? level : null,
  };
}
