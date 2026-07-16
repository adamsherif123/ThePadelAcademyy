import type { ReactNode } from 'react';

import styles from './Card.module.css';

/** A white surface with a hairline border and a soft, near-flat shadow. */
export function Card({
  children,
  padded = true,
  className,
}: {
  children: ReactNode;
  padded?: boolean;
  className?: string;
}) {
  return (
    <div className={[styles.card, padded ? styles.padded : '', className ?? ''].join(' ').trim()}>
      {children}
    </div>
  );
}
