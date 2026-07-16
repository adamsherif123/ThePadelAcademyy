import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import styles from './EmptyState.module.css';

/** A considered empty state: soft icon circle, title, a line of copy, optional action. */
export function EmptyState({
  icon: Icon,
  title,
  message,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className={styles.wrap}>
      {Icon ? (
        <div className={styles.circle}>
          <Icon size={28} aria-hidden />
        </div>
      ) : null}
      <p className={styles.title}>{title}</p>
      <p className={styles.message}>{message}</p>
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
