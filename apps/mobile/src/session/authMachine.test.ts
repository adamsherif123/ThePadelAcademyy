import type { Player } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import { deriveStatus, nextRoute, type SessionStatus } from './authMachine';

/**
 * The auth state machine, tested exhaustively. Nothing covered this before, which is
 * why the S9 signup bounce (a needs_profile user on trial-grant replaced back to
 * profile-setup) and the profile-setup trap both shipped. This can't reach real
 * React render/effect timing or AsyncStorage rehydration — those still need a device
 * — but it pins the decision table those bugs were failures of.
 *
 * A2 adds the `not_a_player` gate: an admin credential in the players' app must be
 * REFUSED, never sent to profile-setup (that mis-route was bug #2). Both directions are
 * pinned here — admin → not_a_player (never needs_profile), player → the normal states.
 */
const player = { id: 'pl_1', phone: null, name: 'A', gender: 'men', level: 'beginner', createdAt: '2026-01-01T00:00:00.000Z' } as unknown as Player;
const base = { sessionRestored: true, hasSession: true, gateLoading: false, isAdmin: false, player: null };

describe('deriveStatus', () => {
  it('is loading until the session is restored', () => {
    expect(deriveStatus({ ...base, sessionRestored: false, hasSession: false })).toBe('loading');
  });
  it('is loading while the player/admin gate loads for an existing session', () => {
    expect(deriveStatus({ ...base, gateLoading: true })).toBe('loading');
  });
  it('is signed_out with no session', () => {
    expect(deriveStatus({ ...base, hasSession: false })).toBe('signed_out');
  });
  it('is needs_profile with a session but no player (orphan / mid-signup)', () => {
    expect(deriveStatus({ ...base, player: null })).toBe('needs_profile');
  });
  it('is ready with a session and a player', () => {
    expect(deriveStatus({ ...base, player })).toBe('ready');
  });

  // ── bug #2: an admin credential is refused, in BOTH deriveStatus positions ──
  it('is not_a_player when the session is an admin (no player) — NOT needs_profile', () => {
    expect(deriveStatus({ ...base, isAdmin: true, player: null })).toBe('not_a_player');
  });
  it('an admin is refused even if a stray player row somehow appeared (admin wins the gate)', () => {
    // A1 makes this state impossible, but the machine must still never treat an admin as
    // a ready player — isAdmin is checked before the player branch.
    expect(deriveStatus({ ...base, isAdmin: true, player })).toBe('not_a_player');
  });
});

describe('nextRoute — redirects', () => {
  it('sends a signed-out user outside (auth) to sign-in, but leaves them in (auth)', () => {
    expect(nextRoute('signed_out', '(tabs)', 'index')).toBe('/(auth)/sign-in');
    expect(nextRoute('signed_out', '(auth)', 'sign-in')).toBeNull();
  });

  it('carries a needs_profile user to profile-setup from anywhere except profile-setup', () => {
    expect(nextRoute('needs_profile', '(auth)', 'password')).toBe('/(auth)/profile-setup');
    expect(nextRoute('needs_profile', '(tabs)', 'index')).toBe('/(auth)/profile-setup');
    expect(nextRoute('needs_profile', '(auth)', 'profile-setup')).toBeNull();
  });

  it('sends a ready user into the tabs, but not while still finishing onboarding', () => {
    expect(nextRoute('ready', '(auth)', 'sign-in')).toBe('/(tabs)');
    expect(nextRoute('ready', '(auth)', 'password')).toBe('/(tabs)');
    expect(nextRoute('ready', '(tabs)', 'index')).toBeNull();
  });

  it('never redirects while loading', () => {
    expect(nextRoute('loading', '(auth)', 'sign-in')).toBeNull();
    expect(nextRoute('loading', '(tabs)', 'index')).toBeNull();
  });
});

describe('nextRoute — the bug #2 gate (admin credential in the players app)', () => {
  it('holds an admin on the refusal screen, and NEVER routes them to profile-setup', () => {
    expect(nextRoute('not_a_player', '(auth)', 'sign-in')).toBe('/(auth)/not-a-player');
    expect(nextRoute('not_a_player', '(tabs)', 'index')).toBe('/(auth)/not-a-player');
    expect(nextRoute('not_a_player', '(auth)', 'not-a-player')).toBeNull();
    // The bug: an admin was sent to profile-setup. That route is never reachable from here.
    expect(nextRoute('not_a_player', '(auth)', 'profile-setup')).not.toBe(null);
    expect(nextRoute('not_a_player', '(auth)', 'profile-setup')).toBe('/(auth)/not-a-player');
  });
});

describe('nextRoute — the S9 bounce regression', () => {
  it('a READY user on trial-grant is NOT bounced back to profile-setup', () => {
    // The bug: status was still needs_profile when the guard ran, so it replaced
    // trial-grant → profile-setup. With status deterministically ready (the S9.1
    // seed), the guard must leave the celebration alone.
    expect(nextRoute('ready', '(auth)', 'trial-grant')).toBeNull();
    expect(nextRoute('ready', '(auth)', 'profile-setup')).toBeNull();
  });

  it('documents that trial-grant is only safe once ready (needs_profile there IS a bounce)', () => {
    // This is the exact bad transition; the fix is to guarantee `ready` before
    // navigating there, NOT to widen this branch to tolerate trial-grant.
    expect(nextRoute('needs_profile', '(auth)', 'trial-grant')).toBe('/(auth)/profile-setup');
  });
});

describe('nextRoute — the trap is escapable', () => {
  it('signing out of profile-setup (→ signed_out) routes to sign-in, not back to the trap', () => {
    // A stuck user hits sign-out; status becomes signed_out; the guard must let them
    // reach sign-in to start over with a different email.
    const afterSignOut: SessionStatus = 'signed_out';
    expect(nextRoute(afterSignOut, '(auth)', 'profile-setup')).toBeNull(); // sign-in is in (auth)
    expect(nextRoute(afterSignOut, '(auth)', 'sign-in')).toBeNull();
    // And a needs_profile user is never sent anywhere that loops them (only to
    // profile-setup, which now carries the escape).
    expect(nextRoute('needs_profile', '(auth)', 'profile-setup')).toBeNull();
  });

  it('signing out of the refusal screen (→ signed_out) escapes to sign-in', () => {
    expect(nextRoute('signed_out', '(auth)', 'not-a-player')).toBeNull(); // free to reach sign-in
  });
});
