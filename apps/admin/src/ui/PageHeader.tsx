import styles from './PageHeader.module.css';

/**
 * The brand's signature header, on every route: a periwinkle uppercase eyebrow,
 * a bold uppercase display heading, and a plain-language subtitle — the same
 * signature as the client app's ScreenHeader.
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <header className={styles.header}>
      <p className={styles.eyebrow}>{eyebrow}</p>
      <h1 className={styles.title}>{title}</h1>
      {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
    </header>
  );
}
