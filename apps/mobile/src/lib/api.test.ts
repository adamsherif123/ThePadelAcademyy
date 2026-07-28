import { describe, expect, it, vi } from 'vitest';

import { ApiError, isNetworkError } from './api';

// api.ts imports lib/supabase, whose module-load env guard throws under the node
// test env (no EXPO_PUBLIC_SUPABASE_URL/ANON_KEY here) — stub it past the guard.
// Neither ApiError nor isNetworkError touches the client itself. vitest hoists
// vi.mock calls above imports at transform time, so ordering here is cosmetic.
vi.mock('./supabase', () => ({ supabase: {} }));

/**
 * isNetworkError is the one seam that decides "the server couldn't be reached"
 * vs "the server answered no" for every caller that could otherwise misread a
 * fetch failure as an auth/business fact (SessionProvider's player/admin gate —
 * the cold-start-offline bug — and complete_signup). postgrest-js resolves
 * (never throws) with `code: ''` for a transport failure or our own request
 * timeout, because `code` is reserved for a genuine PostgREST/Postgres error the
 * server actually returned — this pins that exact distinction.
 */
describe('isNetworkError', () => {
  it('is true for a transport failure (postgrest-js resolves with code: "")', () => {
    const e = new ApiError('Failed to load player: TypeError: Network request failed', {
      message: 'TypeError: Network request failed',
      details: '',
      hint: '',
      code: '',
    });
    expect(isNetworkError(e)).toBe(true);
  });

  it('is true for a request timeout (AbortError also resolves with code: "")', () => {
    const e = new ApiError('complete_signup failed: AbortError: Aborted', {
      message: 'AbortError: The operation was aborted',
      details: '',
      hint: 'Request was aborted (timeout or manual cancellation)',
      code: '',
    });
    expect(isNetworkError(e)).toBe(true);
  });

  it('is false for a genuine server-side rejection (a real Postgres/PostgREST code)', () => {
    const e = new ApiError('Failed to load player: permission denied', {
      message: 'permission denied for table players',
      details: '',
      hint: '',
      code: '42501',
    });
    expect(isNetworkError(e)).toBe(false);
  });

  it('is false when the cause carries no code field at all (not the network shape)', () => {
    const e = new ApiError('Failed to load player: weird body', { message: 'weird body' });
    expect(isNetworkError(e)).toBe(false);
  });

  it('is false for a non-ApiError (e.g. a plain thrown Error)', () => {
    expect(isNetworkError(new Error('boom'))).toBe(false);
  });

  it('is false for an ApiError with no cause at all', () => {
    expect(isNetworkError(new ApiError('no cause'))).toBe(false);
  });
});
