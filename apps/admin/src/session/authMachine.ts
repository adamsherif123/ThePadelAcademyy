import type { Player } from '@tpa/types';

/**
 * The admin auth state machine — the same pure-`deriveStatus` shape the client uses
 * (session/authMachine.ts in apps/mobile), with one different terminal state. The
 * client's fourth state is `needs_profile` (a verified user finishes signup); the
 * admin's is `not_admin` (a verified user who ISN'T an admin — a player who typed
 * their number into the wrong app, or a verified user with no player row). There's
 * no complete_signup here: admins sign up on the mobile app and are promoted
 * out-of-band (`update players set is_admin = true`, S5.1). Routing differs too — the
 * admin renders conditionally in App.tsx (react-router) rather than via a guard
 * effect — so only deriveStatus is shared in shape, kept deliberately parallel.
 */
export type AdminStatus = 'loading' | 'signed_out' | 'not_admin' | 'ready';

export function deriveStatus(args: {
  /** Has getSession resolved at least once? (session !== undefined) */
  sessionRestored: boolean;
  hasSession: boolean;
  /** Are the player / is_admin lookups still loading for an existing session? */
  gateLoading: boolean;
  /** is_admin() — false for no player row, an unlinked user, or a non-admin player. */
  isAdmin: boolean;
  player: Player | null;
}): AdminStatus {
  const { sessionRestored, hasSession, gateLoading, isAdmin } = args;
  if (!sessionRestored) return 'loading';
  if (hasSession && gateLoading) return 'loading';
  if (!hasSession) return 'signed_out';
  // A session that isn't an admin is refused — never trapped (App offers sign-out).
  return isAdmin ? 'ready' : 'not_admin';
}
