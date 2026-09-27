import type { Booking, SessionSlot, SlotId } from '@tpa/types';

/**
 * The slots a player's own bookings point at that the branch-filtered feed does
 * not contain.
 *
 * This is the price of filtering the feed server-side (see fetchSlots): a booking
 * at Branch B is invisible while Branch A is selected, and "your sessions" must
 * never depend on which branch you happen to be looking at. Cancelled bookings
 * are included — the Past list shows them too.
 */
export function missingSlotIds(
  bookings: readonly Booking[],
  feed: readonly SessionSlot[],
): SlotId[] {
  const have = new Set(feed.map((s) => s.id));
  const out = new Set<SlotId>();
  for (const b of bookings) {
    if (!have.has(b.slotId)) out.add(b.slotId);
  }
  // Sorted so the array — and therefore the query key built from it — is stable
  // across renders; an unsorted set would refetch whenever iteration order moved.
  return [...out].sort();
}

/**
 * The feed plus the fetched stragglers, de-duplicated.
 *
 * The feed wins on conflict: it is the fresher read (it carries the branch the
 * player is actually looking at, refetched on focus), while the by-id read exists
 * only to fill gaps.
 */
export function mergeSlots(
  feed: readonly SessionSlot[],
  extra: readonly SessionSlot[],
): SessionSlot[] {
  if (extra.length === 0) return [...feed];
  const byId = new Map<SlotId, SessionSlot>();
  for (const s of extra) byId.set(s.id, s);
  for (const s of feed) byId.set(s.id, s);
  return [...byId.values()];
}
