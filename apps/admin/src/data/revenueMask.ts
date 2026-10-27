import { formatCompactEgp, formatPiastres } from '@tpa/core';
import type { Piastres } from '@tpa/types';

/**
 * Revenue is hidden until somebody asks for it.
 *
 * The owners open the admin in front of other people, so the Dashboard's money
 * figures render as a mask by default and one button reveals them. The choice is
 * kept in sessionStorage — a refresh while working keeps it, a new tab or a new
 * visit starts hidden again — and every failure to read it means hidden.
 *
 * The mask is a FIXED width, not one bullet per digit: "•••••" for 900 EGP and for
 * 2,400,000 EGP alike, or the mask itself would say how big the number is.
 */

export const MASKED_EGP = '••••• EGP';
/** For the dense chart labels that use formatCompactEgp ("80k", "1.2M"). */
export const MASKED_COMPACT = '•••';
/** What a screen reader hears instead of a run of bullet characters. */
export const REVENUE_HIDDEN_LABEL = 'Revenue hidden';

export const REVENUE_REVEALED_KEY = 'tpa.admin.revenueRevealed';

export function revenueAmount(amount: Piastres, revealed: boolean): string {
  return revealed ? formatPiastres(amount) : MASKED_EGP;
}

export function revenueCompact(amount: Piastres, revealed: boolean): string {
  return revealed ? formatCompactEgp(amount) : MASKED_COMPACT;
}

type SessionStore = Pick<Storage, 'getItem' | 'setItem'>;

/** A getter, not the object: merely touching `window.sessionStorage` throws in some
 *  privacy modes, so it has to happen inside the try. */
const browserSession = (): SessionStore | undefined =>
  typeof window === 'undefined' ? undefined : window.sessionStorage;

/** True only when this tab has explicitly revealed revenue. Anything else — no
 *  storage, an unreadable one, a value we didn't write — is hidden. */
export function readRevenueRevealed(store: () => SessionStore | undefined = browserSession): boolean {
  try {
    return store()?.getItem(REVENUE_REVEALED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Best effort. If it can't be stored the toggle still works for this page; the
 *  next load simply starts hidden, which is the safe way to lose it. */
export function writeRevenueRevealed(
  revealed: boolean,
  store: () => SessionStore | undefined = browserSession,
): void {
  try {
    store()?.setItem(REVENUE_REVEALED_KEY, revealed ? '1' : '0');
  } catch {
    // Ignored on purpose — see above.
  }
}
