import type { Player } from '@tpa/types';

/**
 * The auth state machine, as PURE functions — the piece nothing tested before,
 * which is how both the S9 bounce (a needs_profile user landing on trial-grant got
 * replaced back) and the profile-setup trap slipped through. `deriveStatus` maps the
 * raw session/player facts to one of four states; `nextRoute` maps (state, where the
 * user is) to where the guard should send them. Both are exhaustively unit-tested.
 * The provider and the router guard are thin shells over these.
 */
export type SessionStatus = 'loading' | 'signed_out' | 'needs_profile' | 'ready';

/**
 * The four states:
 *   loading       — still restoring the session, or loading the player for a session
 *   signed_out    — no session
 *   needs_profile — a session exists but there is no player row yet (orphan / mid-signup)
 *   ready         — a session AND a player
 */
export function deriveStatus(args: {
  /** Has getSession resolved at least once? (session !== undefined) */
  sessionRestored: boolean;
  hasSession: boolean;
  /** Is the player query still loading for an existing session? */
  playerLoading: boolean;
  player: Player | null;
}): SessionStatus {
  const { sessionRestored, hasSession, playerLoading, player } = args;
  if (!sessionRestored) return 'loading';
  if (hasSession && playerLoading) return 'loading';
  if (!hasSession) return 'signed_out';
  return player ? 'ready' : 'needs_profile';
}

/** Route groups/steps the guard reasons about (from expo-router segments). */
const AUTH_GROUP = '(auth)';

/**
 * Where the guard should `router.replace` to, or null to stay put. Encodes exactly
 * three redirects: signed-out → sign-in, verified-without-profile → profile-setup,
 * onboarded → tabs. The onboarding sub-steps (otp, profile-setup, then the
 * trial-grant celebration) all live under (auth) but run AFTER a session exists, so
 * a `ready` user is only pushed out of (auth) once past those steps — the exemption
 * that stops the S9 bounce.
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
    case 'needs_profile':
      // Always land on profile-setup (which now has an escape hatch, so this is not
      // a trap). This is also what carries a freshly-verified user off the OTP screen.
      return step === 'profile-setup' ? null : '/(auth)/profile-setup';
    case 'ready':
      if (inAuth && step !== 'trial-grant' && step !== 'profile-setup') return '/(tabs)';
      return null;
  }
}
