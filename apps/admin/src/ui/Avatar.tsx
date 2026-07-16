import { useState } from 'react';

import styles from './Avatar.module.css';

/** First-letter initials of the first two words (e.g. "Rania Adham" → "RA"). */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '');
  return letters.toUpperCase() || '?';
}

/** Deterministic tinted variant (0–3) from the name, so the fallback is stable. */
function variantOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 4;
}

/**
 * A circular avatar: the photo when it loads, the initials otherwise. Falls back
 * on load FAILURE too (not just a missing url) — the client app needed exactly
 * this, so it's built in here from the start. Tinted background is derived from
 * the name for a stable, varied look.
 */
export function Avatar({
  name,
  photoUrl,
  size = 40,
}: {
  name: string;
  photoUrl?: string | null;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(photoUrl) && !failed;

  return (
    <span
      className={styles.avatar}
      data-variant={showImage ? undefined : variantOf(name)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      aria-label={name}
      role="img"
    >
      {showImage ? (
        <img
          className={styles.image}
          src={photoUrl ?? undefined}
          alt=""
          onError={() => setFailed(true)}
        />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}
