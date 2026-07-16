import type { TrainingType } from '@tpa/types';

import styles from './TypePill.module.css';
import { TRAINING_LABEL as LABEL } from './trainingLabel';

/**
 * A neutral pill with a training-type-coloured dot + label (the calendar / table
 * type marker). The dot colour is the theme's `trainingTint` fg, exposed as the
 * generated `--tint-<type>-fg` custom property — admin-only by the theme's rule.
 */
export function TypePill({ type }: { type: TrainingType }) {
  return (
    <span className={styles.pill}>
      <span className={styles.dot} data-type={type} />
      {LABEL[type]}
    </span>
  );
}
