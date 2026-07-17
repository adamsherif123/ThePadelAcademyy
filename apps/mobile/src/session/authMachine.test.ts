import type { Player } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import { deriveStatus, nextRoute, type SessionStatus } from './authMachine';

/**
 * The auth state machine, tested exhaustively. Nothing covered this before, which is
 * why the S9 signup bounce (a needs_profile user on trial-grant replaced back to
 * profile-setup) and the profile-setup trap both shipped. This can't reach real
 * React render/effect timing or AsyncStorage rehydration — those still need a device
 * — but it pins the decision table those bugs were failures of.
 */
const player = { id: 'pl_1', phone: '+201555550001', name: 'A', gender: 'men', level: 'beginner', createdAt: '2026-01-01T00:00:00.000Z' } as unknown as Player;

describe('deriveStatus', () => {
  it('is loading until the session is restored', () => {
    expect(deriveStatus({ sessionRestored: false, hasSession: false, playerLoading: false, player: null })).toBe('loading');
  });
  it('is loading while the player loads for an existing session', () => {
    expect(deriveStatus({ sessionRestored: true, hasSession: true, playerLoading: true, player: null })).toBe('loading');
  });
  it('is signed_out with no session', () => {
    expect(deriveStatus({ sessionRestored: true, hasSession: false, playerLoading: false, player: null })).toBe('signed_out');
  });
  it('is needs_profile with a session but no player (orphan / mid-signup)', () => {
    expect(deriveStatus({ sessionRestored: true, hasSession: true, playerLoading: false, player: null })).toBe('needs_profile');
  });
  it('is ready with a session and a player', () => {
    expect(deriveStatus({ sessionRestored: true, hasSession: true, playerLoading: false, player })).toBe('ready');
  });
});

describe('nextRoute — redirects', () => {
  it('sends a signed-out user outside (auth) to sign-in, but leaves them in (auth)', () => {
    expect(nextRoute('signed_out', '(tabs)', 'index')).toBe('/(auth)/sign-in');
    expect(nextRoute('signed_out', '(auth)', 'sign-in')).toBeNull();
  });

  it('carries a needs_profile user to profile-setup from anywhere except profile-setup', () => {
    expect(nextRoute('needs_profile', '(auth)', 'otp')).toBe('/(auth)/profile-setup');
    expect(nextRoute('needs_profile', '(tabs)', 'index')).toBe('/(auth)/profile-setup');
    expect(nextRoute('needs_profile', '(auth)', 'profile-setup')).toBeNull();
  });

  it('sends a ready user into the tabs, but not while still finishing onboarding', () => {
    expect(nextRoute('ready', '(auth)', 'sign-in')).toBe('/(tabs)');
    expect(nextRoute('ready', '(auth)', 'otp')).toBe('/(tabs)');
    expect(nextRoute('ready', '(tabs)', 'index')).toBeNull();
  });

  it('never redirects while loading', () => {
    expect(nextRoute('loading', '(auth)', 'sign-in')).toBeNull();
    expect(nextRoute('loading', '(tabs)', 'index')).toBeNull();
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
    // reach sign-in to start over with a different number.
    const afterSignOut: SessionStatus = 'signed_out';
    expect(nextRoute(afterSignOut, '(auth)', 'profile-setup')).toBeNull(); // sign-in is in (auth)
    expect(nextRoute(afterSignOut, '(auth)', 'sign-in')).toBeNull();
    // And a needs_profile user is never sent anywhere that loops them (only to
    // profile-setup, which now carries the escape).
    expect(nextRoute('needs_profile', '(auth)', 'profile-setup')).toBeNull();
  });
});
