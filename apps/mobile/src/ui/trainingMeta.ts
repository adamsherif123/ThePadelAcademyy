import Ionicons from '@expo/vector-icons/Ionicons';
import type { CreditBatch, TrainingType } from '@tpa/types';
import type { ComponentProps } from 'react';

export type IoniconName = ComponentProps<typeof Ionicons>['name'];

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

/** Human name for a credit batch — "Group 8-Pack" or "Welcome Trial Credits". */
export function batchLabel(batch: CreditBatch): string {
  if (batch.source === 'signup_grant') return 'Welcome Trial Credits';
  return `${TRAINING_META[batch.trainingType].label} ${batch.quantityTotal}-Pack`;
}
