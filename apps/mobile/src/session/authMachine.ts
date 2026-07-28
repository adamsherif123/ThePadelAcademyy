import type { Player } from '@tpa/types';

/**
 * The auth state machine, as PURE functions — the piece nothing tested before,
 * which is how both the S9 bounce (a needs_profile user landing on trial-grant got
 * replaced back) and the profile-setup trap slipped through. `deriveStatus` maps the
 * raw session/player/admin facts to one of six states; `nextRoute` maps (state, where
 * the user is) to where the guard should send them. Both are exhaustively unit-tested.
 * The provider and the router guard are thin shells over these.
 *
 * A2 added `not_a_player`: the consumer app is email/password now, and an ADMIN
 * credential authenticates at GoTrue but has NO player identity (A1 keeps admins and
 * players separate). Such a session is REFUSED here — mirror of the admin app's
 * `not_admin` — never sent to profile-setup (that mis-route WAS bug #2), never trapped
 * (the refusal screen carries sign-out).
 *
 * A later fix added `offline`: a cold start with no connectivity restores the
 * persisted session fine (no network needed — see SessionProvider's getSession()),
 * but the player/is_admin gate queries can't reach the server. The OLD code read
 * "no player DATA yet" as "no player ROW exists" and landed a signed-in user on
 * profile-setup (whose only way out is a genuine sign-out) — collapsing "can't
 * verify right now" into "needs_profile". `offline` is a distinct state for
 * exactly that: session present, gate unreachable, don't sign out, don't route to
 * ANY auth screen — the app shell renders on cached data with an offline banner.
 * Only a definitive server verdict (a real session, or its absence) may produce
 * `signed_out` / `not_a_player` / `needs_profile` / `ready`; a fetch failure never does.
 */
export type SessionStatus =
  | 'loading'
  | 'signed_out'
  | 'offline'
  | 'not_a_player'
  | 'needs_profile'
  | 'ready';

/**
 * The six states:
 *   loading       — still restoring the session, or loading the player/admin gate for one
 *   signed_out    — no session
 *   offline       — a session IS present, but the player/admin gate can't reach the
 *                   server right now (no connectivity/timeout) — unverifiable, not absent
 *   not_a_player  — a session whose user is an ADMIN (no player identity) — refused (bug #2)
 *   needs_profile — a session, not an admin, but no player row yet (orphan / mid-signup)
 *   ready         — a session AND a player
 */
export function deriveStatus(args: {
  /** Has getSession resolved at least once? (session !== undefined) */
  sessionRestored: boolean;
  hasSession: boolean;
  /** Are the player / is_admin lookups still loading for an existing session? */
  gateLoading: boolean;
  /**
   * Did the player/admin gate fail because the SERVER couldn't be reached (no
   * connectivity, a request timeout) rather than answer? Never true for a
   * genuine server-side rejection — see lib/api.ts's isNetworkError.
   */
  gateUnreachable: boolean;
  /** is_admin() — true for an admin credential (which has no player row). */
  isAdmin: boolean;
  player: Player | null;
}): SessionStatus {
  const { sessionRestored, hasSession, gateLoading, gateUnreachable, isAdmin, player } = args;
  if (!sessionRestored) return 'loading';
  if (hasSession && gateLoading) return 'loading';
  if (!hasSession) return 'signed_out';
  // A session exists but we can't currently verify it server-side — keep the
  // session, show neither sign-in nor profile-setup. Checked BEFORE isAdmin/player
  // (both are unknowable right now, not "false"/"none").
  if (gateUnreachable) return 'offline';
  // An admin credential in the players' app is refused — never routed to profile-setup.
  // (A1 guarantees an admin has no player, so this is checked before the player branch.)
  if (isAdmin) return 'not_a_player';
  return player ? 'ready' : 'needs_profile';
}

/** Route groups/steps the guard reasons about (from expo-router segments). */
const AUTH_GROUP = '(auth)';

/**
 * Where the guard should `router.replace` to, or null to stay put. Encodes exactly
 * these redirects: signed-out → sign-in, admin-credential → not-a-player (refusal),
 * verified-without-profile → profile-setup, onboarded → tabs. The onboarding sub-steps
 * (password, profile-setup, then the trial-grant celebration) all live under (auth) but
 * run AFTER a session exists, so a `ready` user is only pushed out of (auth) once past
 * those steps — the exemption that stops the S9 bounce.
 *
 * `offline`: a session is present but unverifiable, so it is NEVER routed to any
 * (auth) screen (there is nothing to sign in to — they're already signed in). If
 * they somehow ARE on an auth screen (stale route from before a session existed),
 * this sends them to the app shell, same destination `ready` uses — the app then
 * renders on cached data with an offline banner (see RootNavigator) rather than a
 * dead auth screen. Everywhere else: stay put, no redirect.
 */
export function nextRoute(
  status: SessionStatus,
  segment0: string | undefined,
  step: string | undefined,
): string | null {
  const inAuth = segment0 === AUTH_GROUP;
  switch (status) {
    case 'loading':
      return null;
    case 'signed_out':
      return inAuth ? null : '/(auth)/sign-in';
    case 'offline':
      return inAuth ? '/(tabs)' : null;
    case 'not_a_player':
      // Hold an admin credential on the refusal screen (which carries sign-out). Never
      // profile-setup — attempting the bounce there was bug #2.
      return step === 'not-a-player' ? null : '/(auth)/not-a-player';
    case 'needs_profile':
      // Always land on profile-setup (which carries an escape hatch, so this is not a
      // trap). This is also what carries a freshly-verified user off the password screen.
      return step === 'profile-setup' ? null : '/(auth)/profile-setup';
    case 'ready':
      if (inAuth && step !== 'trial-grant' && step !== 'profile-setup') return '/(tabs)';
      return null;
  }
}
