import { GENDERS, LEVELS } from '@tpa/core';
import type { Gender, Level, TrainingType } from '@tpa/types';

/** Human labels for the training types — shared by TypePill, calendar, dashboard. */
export const TRAINING_LABEL: Record<TrainingType, string> = {
  trial: 'Trial',
  group: 'Group',
  duo: 'Duo',
  individual: 'Individual',
};

/** Gender labels (possessive, as the schedule/modal read them). */
export const GENDER_LABEL: Record<Gender, string> = {
  men: "Men's",
  ladies: "Ladies'",
};

/** Level labels — the client app's wording, kept consistent across apps. */
export const LEVEL_LABEL: Record<Level, string> = {
  beginner: 'Beginner',
  adv_beginner: 'Adv. Beginner',
  intermediate: 'Intermediate',
};

/**
 * Dropdown options for gender and level — the ONE source both the recurring-session
 * modals and the player editor build their `<Select>` from (they used to spell
 * these separately). Derived from the core unions + the labels above.
 */
export const GENDER_OPTIONS: readonly { value: Gender; label: string }[] = GENDERS.map((g) => ({
  value: g,
  label: GENDER_LABEL[g],
}));

export const LEVEL_OPTIONS: readonly { value: Level; label: string }[] = LEVELS.map((l) => ({
  value: l,
  label: LEVEL_LABEL[l],
}));

/** "Men's · Beginner" for a group slot; "" for non-group (no gender/level). */
export function groupTags(gender: Gender | null, level: Level | null): string {
  if (gender === null || level === null) return '';
  return `${GENDER_LABEL[gender]} · ${LEVEL_LABEL[level]}`;
}

/** The players-per-session descriptor by type (for the modal summary/hint). */
export const TYPE_PLAYERS: Record<TrainingType, string> = {
  group: '3–4 players',
  duo: '2 players',
  individual: '1 player',
  trial: '1 player',
};
