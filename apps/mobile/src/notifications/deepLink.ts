import type { Href } from 'expo-router';

/**
 * Where a notification routes when tapped — used identically by an OS-push tap and an
 * in-app centre tap, so both go the same place. A session event opens the Sessions
 * tab (with the slot id so it can focus that session); a credits grant opens the
 * Wallet. Anything unrecognised falls back to Sessions rather than dead-ending.
 *
 * news_published opens the news feed — every visible item renders its full
 * title/body inline there (no separate detail view exists, so there's nothing
 * to focus a specific item within; the feed itself IS the destination).
 */
export function notificationHref(n: { type: string; slotId: string | null; newsId?: string | null }): Href {
  // Credit outcomes (approved grant, or a rejection the player should read) → the wallet,
  // where the request status card explains what happened.
  if (n.type === 'credits_granted' || n.type === 'credit_request_rejected') return '/wallet';
  if (n.type === 'news_published') return '/news' as Href;
  return n.slotId
    ? ({ pathname: '/(tabs)/sessions', params: { focus: n.slotId } } as Href)
    : ('/(tabs)/sessions' as Href);
}
