import type { TrainingType } from '@tpa/types';

import styles from './TypePill.module.css';
import { trainingLabelFor } from './trainingLabel';

/**
 * A neutral pill with a training-type-coloured dot + label (the calendar / table
 * type marker). The dot colour is the theme's `trainingTint` fg, exposed as the
 * generated `--tint-<type>-fg` custom property — admin-only by the theme's rule.
 *
 * `type` is nullable — an OPEN (untyped) block gets its own neutral accent dot
 * (`data-type="open"`, not one of the four real trainingTint colours — "open"
 * isn't a TrainingType, so it stays out of that theme-package union) and the
 * "Open" label via trainingLabelFor.
 */
export function TypePill({ type }: { type: TrainingType | null }) {
  return (
    <span className={styles.pill}>
      <span className={styles.dot} data-type={type ?? 'open'} />
      {trainingLabelFor(type)}
    </span>
  );
}
