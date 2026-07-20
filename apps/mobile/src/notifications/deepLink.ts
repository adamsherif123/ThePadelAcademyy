import type { Href } from 'expo-router';

/**
 * Where a notification routes when tapped — used identically by an OS-push tap and an
 * in-app centre tap, so both go the same place. A session event opens the Sessions
 * tab (with the slot id so it can focus that session); a credits grant opens the
 * Wallet. Anything unrecognised falls back to Sessions rather than dead-ending.
 */
export function notificationHref(n: { type: string; slotId: string | null }): Href {
  if (n.type === 'credits_granted') return '/wallet';
  return n.slotId
    ? ({ pathname: '/(tabs)/sessions', params: { focus: n.slotId } } as Href)
    : ('/(tabs)/sessions' as Href);
}
