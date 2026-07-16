import type { TrainingType } from '@tpa/types';

/** Human labels for the training types — shared by TypePill and the dashboard rows. */
export const TRAINING_LABEL: Record<TrainingType, string> = {
  trial: 'Trial',
  group: 'Group',
  duo: 'Duo',
  individual: 'Individual',
};
