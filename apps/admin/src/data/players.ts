import type {
  Booking,
  CreditBatch,
  Gender,
  IsoInstant,
  Level,
  Player,
  PlayerId,
  Purchase,
  SessionSlot,
} from '@tpa/types';

import { usableCreditFor } from './selectors';

/**
 * Player read selectors (pure, over fetched rows). NOTE: editing another player's
 * profile is intentionally NOT wired in S10b — the only players UPDATE policy is
 * `players_update_self` (a player edits their OWN row); there is no admin-edit-other
 * policy, and Task 4 doesn't list a player-edit write. So updatePlayerProfile below
 * is a no-op stub that reports `not_supported`; the admin can grant credits and
 * manage bookings, but not rewrite a player's name/gender/level from here.
 */

const ms = (i: IsoInstant): number => new Date(i).getTime();

export interface CreditBreakdown {
  /** Usable G + D + I credits (the list row's headline; trial is not a bought type). */
  total: number;
  group: number;
  duo: number;
  individual: number;
}

/** The G · D · I usable-credit breakdown shown on the Players list. */
export function creditBreakdown(batches: CreditBatch[], playerId: PlayerId, now: IsoInstant): CreditBreakdown {
  const group = usableCreditFor(batches, playerId, 'group', now);
  const duo = usableCreditFor(batches, playerId, 'duo', now);
  const individual = usableCreditFor(batches, playerId, 'individual', now);
  return { total: group + duo + individual, group, duo, individual };
}

/** Every credit batch a player holds, newest first (for the wallet in player detail). */
export const batchesForPlayerSorted = (batches: CreditBatch[], playerId: PlayerId) =>
  batches
    .filter((b) => b.playerId === playerId)
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt));

/** A player's purchases, newest first (for purchase history). */
export const purchasesForPlayer = (purchases: Purchase[], playerId: PlayerId): Purchase[] =>
  purchases
    .filter((p) => p.playerId === playerId)
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt));

/**
 * Active bookings this player holds on GROUP slots whose gender/level wouldn't
 * match a proposed profile — surfaced when the owner edits gender/level, so the
 * change is made with eyes open. The bookings themselves are never touched.
 */
export function mismatchedActiveBookings(
  bookings: Booking[],
  slots: SessionSlot[],
  playerId: PlayerId,
  gender: Gender,
  level: Level,
): number {
  const slotById = new Map(slots.map((s) => [s.id, s]));
  return bookings.filter((b) => {
    if (b.playerId !== playerId || b.status !== 'booked') return false;
    const slot = slotById.get(b.slotId);
    if (!slot || slot.trainingType !== 'group') return false;
    return (slot.gender !== null && slot.gender !== gender) || (slot.level !== null && slot.level !== level);
  }).length;
}

// --- Profile edit seam ---
export interface PlayerProfilePatch {
  name: string;
  phone: string;
  gender: Gender;
  level: Level;
}

export type UpdatePlayerResult =
  | { ok: true; player: Player }
  | { ok: false; reason: 'not_supported' };

/**
 * NOT wired in S10b: there is no admin policy to UPDATE another player's row (only
 * `players_update_self`), and Task 4 doesn't include a player-edit write — so this
 * reports `not_supported` rather than silently doing nothing or reaching for a
 * privilege the RLS design withholds. If the academy later needs admin profile
 * edits, it's a new column-scoped policy + an RPC, not a client workaround.
 */
export function updatePlayerProfile(playerId: PlayerId, patch: PlayerProfilePatch): UpdatePlayerResult {
  void playerId;
  void patch;
  return { ok: false, reason: 'not_supported' };
}
