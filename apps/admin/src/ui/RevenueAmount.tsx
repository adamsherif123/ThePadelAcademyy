import type { Piastres } from '@tpa/types';

import { REVENUE_HIDDEN_LABEL, revenueAmount, revenueCompact } from '../data/revenueMask';

/**
 * A revenue figure that may be masked (see data/revenueMask). Revealed, it is the
 * plain formatted text. Masked, it is the bullet mask behind role="img" so a screen
 * reader announces "Revenue hidden" rather than spelling out bullet characters —
 * aria-label on a bare span is not reliably read.
 */
export function RevenueAmount({
  amount,
  revealed,
  compact = false,
}: {
  amount: Piastres;
  revealed: boolean;
  /** formatCompactEgp ("80k") instead of formatPiastres ("80,000 EGP"). */
  compact?: boolean;
}) {
  const text = compact ? revenueCompact(amount, revealed) : revenueAmount(amount, revealed);
  if (revealed) return <>{text}</>;
  return (
    <span role="img" aria-label={REVENUE_HIDDEN_LABEL}>
      {text}
    </span>
  );
}
