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
 *
 * The owner_* pings are the honest edge case. They reach the academy's owners in
 * THIS app (they're players too), but they're a nudge to go look at the ADMIN —
 * which this app has no screens for and no browser-opening path to. So they open
 * the notifications centre, where the message itself is the whole payload. The
 * alternative, falling through to the slotId branch below, would focus the Sessions
 * tab on a slot the owner has no booking on — a dead end that looks like a bug.
 */
export function notificationHref(n: { type: string; slotId: string | null; newsId?: string | null }): Href {
  // Credit outcomes (approved grant, or a rejection the player should read) → the wallet,
  // where the request status card explains what happened.
  if (n.type === 'credits_granted' || n.type === 'credit_request_rejected') return '/wallet';
  if (n.type === 'news_published') return '/news' as Href;
  if (n.type === 'owner_credit_request' || n.type === 'owner_booking') {
    return '/notifications' as Href;
  }
  return n.slotId
    ? ({ pathname: '/(tabs)/sessions', params: { focus: n.slotId } } as Href)
    : ('/(tabs)/sessions' as Href);
}
