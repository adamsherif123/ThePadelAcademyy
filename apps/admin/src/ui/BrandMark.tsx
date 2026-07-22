import styles from './BrandMark.module.css';
import badge from './brand-badge.png';

/**
 * The brand lockup: the real academy badge + the stacked "THE PADEL / ACADEMY" wordmark.
 * B3 replaced the placeholder glyph (a lucide Target in a royal circle) with the actual
 * badge — a clean transparent circular PNG extracted from the source logo. The S4a hack
 * existed only because the source was a JPEG-on-grey with no transparency; the transparent
 * badge drops straight in.
 */
export function BrandMark({ wordmark = true, size = 40 }: { wordmark?: boolean; size?: number }) {
  return (
    <span className={styles.lockup}>
      <img className={styles.badge} src={badge} alt="" width={size} height={size} aria-hidden />
      {wordmark ? (
        <span className={styles.wordmark}>
          <span className={styles.line1}>THE PADEL</span>
          <span className={styles.line2}>ACADEMY</span>
        </span>
      ) : null}
    </span>
  );
}
