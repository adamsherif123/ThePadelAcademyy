import type { LucideIcon } from 'lucide-react';

import styles from './StatCard.module.css';

/**
 * A dashboard KPI card: periwinkle eyebrow + icon, a big figure, an optional
 * signed delta chip (green up / red down), and a caption. The value is
 * pre-formatted by the caller (money via @tpa/core); this is presentation only.
 */
export function StatCard({
  eyebrow,
  icon: Icon,
  iconTone = 'muted',
  value,
  delta,
  caption,
}: {
  eyebrow: string;
  icon: LucideIcon;
  iconTone?: 'accent' | 'muted';
  value: string;
  /** Signed % change; null/undefined renders no chip. */
  delta?: number | null;
  caption: string;
}) {
  return (
    <div className={styles.card}>
      <div className={styles.top}>
        <span className={styles.eyebrow}>{eyebrow}</span>
        <span className={styles.icon} data-tone={iconTone}>
          <Icon size={18} aria-hidden />
        </span>
      </div>
      <div className={styles.figure}>{value}</div>
      <div className={styles.footer}>
        {delta != null ? (
          <span className={styles.delta} data-dir={delta < 0 ? 'down' : 'up'}>
            {delta < 0 ? '↓' : '↑'} {Math.abs(delta)}%
          </span>
        ) : null}
        <span className={styles.caption}>{caption}</span>
      </div>
    </div>
  );
}
