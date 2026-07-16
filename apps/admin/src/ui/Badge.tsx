import type { ReactNode } from 'react';

import styles from './Badge.module.css';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/** A small soft-filled status pill (Active / On leave / Paused, and the like). */
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: BadgeTone }) {
  return <span className={[styles.badge, styles[tone]].join(' ')}>{children}</span>;
}
