import { formatCompactEgp, formatPiastres } from '@tpa/core';
import type { Piastres } from '@tpa/types';

import styles from './Donut.module.css';

export interface DonutSegment {
  key: string;
  label: string;
  value: Piastres;
  /** A CSS colour token reference, e.g. "var(--tint-group-fg)". Tokens only. */
  color: string;
}

/**
 * Hand-rolled SVG donut: stroke-dasharray arcs, the total in the hole, and a
 * legend of stacked FULL-WIDTH rows below (dot · label · amount · percent).
 *
 * The v0 bug was a legend crammed to the RIGHT of the donut, where six-digit EGP
 * figures + percentages collided with the card edge. Stacking the legend below
 * gives every row the card's full width, so it can't overflow at realistic
 * amounts — verified at 999,999 EGP values.
 */
export function Donut({ segments, total }: { segments: readonly DonutSegment[]; total: Piastres }) {
  const size = 168;
  const stroke = 22;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const totalN = Math.max(1, total as number);

  // Precompute each arc's length and start offset (cumulative prior values) with
  // no mutable accumulator, so nothing is reassigned during render.
  const arcs = segments.map((s, i) => {
    const priorValue = segments.slice(0, i).reduce((sum, x) => sum + (x.value as number), 0);
    return {
      seg: s,
      dash: ((s.value as number) / totalN) * circumference,
      offset: (priorValue / totalN) * circumference,
    };
  });

  return (
    <div className={styles.wrap}>
      <div className={styles.chart}>
        <svg viewBox={`0 0 ${size} ${size}`} className={styles.svg} role="img" aria-label="Revenue by training type">
          <circle cx={size / 2} cy={size / 2} r={r} className={styles.track} fill="none" strokeWidth={stroke} />
          {arcs.map(({ seg, dash, offset }) => (
            <circle
              key={seg.key}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              strokeWidth={stroke}
              stroke={seg.color}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          ))}
        </svg>
        <div className={styles.center}>
          <span className={styles.centerLabel}>Total</span>
          <span className={styles.centerValue}>{formatCompactEgp(total)}</span>
        </div>
      </div>

      <ul className={styles.legend}>
        {segments.map((s) => (
          <li key={s.key} className={styles.legendRow}>
            <span className={styles.dot} style={{ background: s.color }} />
            <span className={styles.legendLabel}>{s.label}</span>
            <span className={styles.legendValue}>{formatPiastres(s.value)}</span>
            <span className={styles.legendPct}>{Math.round(((s.value as number) / totalN) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
