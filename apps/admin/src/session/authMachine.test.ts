import type { Player } from '@tpa/types';
import { describe, expect, it } from 'vitest';

import { deriveStatus } from './authMachine';

/**
 * The admin state machine, tested exhaustively — the same discipline S9.2 added on
 * the client after an untested guard shipped two bugs. Key case: a verified NON-admin
 * (a real player who signed into the wrong app) must land on `not_admin`, never
 * `ready` and never a trap.
 */
const player = { id: 'pl_1', phone: '+20', name: 'A', gender: 'men', level: 'beginner', createdAt: '2026-01-01T00:00:00.000Z' } as unknown as Player;

describe('deriveStatus', () => {
  it('loading until the session is restored', () => {
    expect(deriveStatus({ sessionRestored: false, hasSession: false, gateLoading: false, isAdmin: false, player: null })).toBe('loading');
  });
  it('loading while the gate (player + is_admin) resolves for a session', () => {
    expect(deriveStatus({ sessionRestored: true, hasSession: true, gateLoading: true, isAdmin: false, player: null })).toBe('loading');
  });
  it('signed_out with no session', () => {
    expect(deriveStatus({ sessionRestored: true, hasSession: false, gateLoading: false, isAdmin: false, player: null })).toBe('signed_out');
  });
  it('ready with a session that is an admin', () => {
    expect(deriveStatus({ sessionRestored: true, hasSession: true, gateLoading: false, isAdmin: true, player })).toBe('ready');
  });
  it('not_admin: a verified player who is NOT an admin (wrong app)', () => {
    expect(deriveStatus({ sessionRestored: true, hasSession: true, gateLoading: false, isAdmin: false, player })).toBe('not_admin');
  });
  it('not_admin: a verified user with NO player row', () => {
    expect(deriveStatus({ sessionRestored: true, hasSession: true, gateLoading: false, isAdmin: false, player: null })).toBe('not_admin');
  });
});
