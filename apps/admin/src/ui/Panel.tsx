import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import styles from './Panel.module.css';

/**
 * A titled content panel (the dashboard's chart and bottom cards): an eyebrow,
 * a title, an optional "→" link to the full section, and a body. Card surface.
 */
export function Panel({
  eyebrow,
  title,
  link,
  children,
}: {
  eyebrow: string;
  title: string;
  link?: { label: string; to: string };
  children: ReactNode;
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h3 className={styles.title}>{title}</h3>
        </div>
        {link ? (
          <Link className={styles.link} to={link.to}>
            {link.label}
            <ArrowRight size={15} aria-hidden />
          </Link>
        ) : null}
      </div>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
