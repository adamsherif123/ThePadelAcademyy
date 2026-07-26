import Ionicons from '@expo/vector-icons/Ionicons';
import type { CreditBatch, Gender, Level, TrainingType } from '@tpa/types';
import type { ComponentProps } from 'react';

export type IoniconName = ComponentProps<typeof Ionicons>['name'];

/**
 * Presentation labels for the domain enums. `satisfies Record<Enum, string>`
 * keeps them exhaustive — add a Gender/Level to @tpa/types and this stops
 * compiling until it's labelled here, so the copy can't drift from the type.
 * The ONE place these live; screens/cards import them instead of re-declaring.
 */
export const GENDER_LABEL = {
  men: 'Men',
  ladies: 'Ladies',
} as const satisfies Record<Gender, string>;

export const LEVEL_LABEL = {
  beginner: 'Beginner',
  adv_beginner: 'Adv. Beginner',
  intermediate: 'Intermediate',
} as const satisfies Record<Level, string>;

/**
 * Presentation metadata for a TrainingType: a human label and the icon shown on
 * type pills. Color is deliberately NOT here — type is communicated by label +
 * icon only; hue is reserved for expiry state (see @tpa/theme creditExpiry).
 * `satisfies Record<TrainingType, …>` keeps it exhaustive.
 */
export const TRAINING_META = {
  trial: { label: 'Trial', icon: 'sparkles-outline' },
  group: { label: 'Group', icon: 'people-outline' },
  duo: { label: 'Duo', icon: 'person-add-outline' },
  individual: { label: 'Individual', icon: 'person-outline' },
} as const satisfies Record<TrainingType, { label: string; icon: IoniconName }>;

/**
 * Null-safe TRAINING_META lookup — a slot's trainingType is nullable (the
 * booking rework: an OPEN block has no type until its first booking sets one).
 * Every card that renders a slot's type badge/label should go through this
 * instead of indexing TRAINING_META directly, so a still-open slot gets an
 * honest "Open" meta instead of a `Record` lookup crash. In practice, every
 * screen that reaches this with a null trainingType is one that shows an
 * open BLOCK (not yet a session) — e.g. the schedule/browse list; screens that
 * only ever render an EXISTING booking (Sessions tab, cancel screen) never see
 * null here by construction (a booking implies a resolved type), but still
 * route through this for a single, consistent fallback instead of an assumed
 * invariant at each call site.
 */
export function trainingMetaFor(trainingType: TrainingType | null): { label: string; icon: IoniconName } {
  return trainingType === null ? { label: 'Open', icon: 'add-circle-outline' } : TRAINING_META[trainingType];
}

/** Human name for a credit batch — "Group 8-Pack" or "Welcome Trial Credits". */
export function batchLabel(batch: CreditBatch): string {
  if (batch.source === 'signup_grant') return 'Welcome Trial Credits';
  return `${TRAINING_META[batch.trainingType].label} ${batch.quantityTotal}-Pack`;
}
