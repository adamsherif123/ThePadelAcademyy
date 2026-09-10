import { Loader2 } from 'lucide-react';
import { useState } from 'react';

import { setPurchasePaid } from '../data/purchasePaid';
import { Toggle } from '../ui';
import styles from './PaidToggle.module.css';

const ERROR_COPY: Record<string, string> = {
  not_admin: 'You’re not signed in as an admin.',
  purchase_missing: 'This purchase no longer exists.',
  not_succeeded: 'Only a completed purchase can be marked paid.',
  invalid_paid: 'Something went wrong. Please try again.',
  network: 'Couldn’t reach the server. Try again.',
};

/**
 * "Has the academy collected this money?" — the switch that decides whether a
 * purchase counts toward revenue.
 *
 * The state is always the SERVER's: `paid` comes from props, and nothing flips
 * locally. That's safe without optimism because runRpc awaits the invalidation, and
 * invalidateQueries resolves only once the active queries have refetched — so by the
 * time the spinner clears, the prop already carries the new value. The label is a
 * coloured pill so an unpaid approval is obvious at a glance, not just a switch
 * position the admin has to read.
 */
export function PaidToggle({ purchaseId, paid }: { purchaseId: string; paid: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onChange = async (next: boolean) => {
    if (busy) return; // the switch has no disabled state — ignore taps mid-flight
    setBusy(true);
    setError(null);
    const res = await setPurchasePaid(purchaseId, next);
    setBusy(false);
    if (!res.ok) setError(ERROR_COPY[res.reason] ?? ERROR_COPY.network!);
  };

  return (
    <span className={styles.wrap} data-paid={paid || undefined}>
      <Toggle
        checked={paid}
        onChange={(v) => void onChange(v)}
        label={paid ? 'Paid — tap to mark not paid' : 'Not paid — tap to mark paid'}
      />
      <span className={styles.label}>{paid ? 'Paid' : 'Not paid'}</span>
      {busy ? <Loader2 size={14} className="tpa-spin" aria-hidden /> : null}
      {error ? <span className={styles.error}>{error}</span> : null}
    </span>
  );
}
