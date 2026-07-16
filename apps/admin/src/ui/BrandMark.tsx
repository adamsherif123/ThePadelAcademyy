import { Target } from 'lucide-react';

import styles from './BrandMark.module.css';

/**
 * The brand lockup: a royal circle badge + the stacked "THE PADEL / ACADEMY"
 * wordmark. The badge uses a glyph rather than brand/logo.png — that asset is a
 * JPEG-on-grey lockup (no transparency), so dropping it in a circle shows grey
 * corners; the royal-circle treatment here matches the v0 design directly. A
 * transparent SVG/PNG would let the real mark replace the glyph with no crop hack.
 */
export function BrandMark({ wordmark = true, size = 40 }: { wordmark?: boolean; size?: number }) {
  return (
    <span className={styles.lockup}>
      <span className={styles.badge} style={{ width: size, height: size }} aria-hidden>
        <Target size={Math.round(size * 0.55)} strokeWidth={2.25} />
      </span>
      {wordmark ? (
        <span className={styles.wordmark}>
          <span className={styles.line1}>THE PADEL</span>
          <span className={styles.line2}>ACADEMY</span>
        </span>
      ) : null}
    </span>
  );
}
