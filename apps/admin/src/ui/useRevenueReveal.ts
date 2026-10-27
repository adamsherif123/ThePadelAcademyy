import { useCallback, useState } from 'react';

import { readRevenueRevealed, writeRevenueRevealed } from '../data/revenueMask';

/**
 * Whether this tab has revealed revenue. Starts from sessionStorage (so hidden on
 * any new visit), and every change is written back so a refresh keeps it.
 */
export function useRevenueReveal(): [boolean, (revealed: boolean) => void] {
  const [revealed, setRevealed] = useState(readRevenueRevealed);
  const set = useCallback((next: boolean) => {
    writeRevenueRevealed(next);
    setRevealed(next);
  }, []);
  return [revealed, set];
}
