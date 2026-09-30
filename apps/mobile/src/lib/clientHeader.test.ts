import { describe, expect, it } from 'vitest';

import { CLIENT_HEADER_PATTERN, clientHeaderValue } from './clientHeader';

/**
 * The server's regex, copied verbatim from tpa.client_is_location_aware(). If the
 * two ever drift, this is where it surfaces — rather than as a branch quietly
 * going missing from the app.
 */
const SERVER_PATTERN = /^mobile\/\d+\.\d+(\.\d+)?$/;

describe('clientHeaderValue', () => {
  it('matches the server pattern for 1.3.1, the version before this release', () => {
    expect(clientHeaderValue('1.3.1')).toBe('mobile/1.3.1');
    expect(SERVER_PATTERN.test(clientHeaderValue('1.3.1')!)).toBe(true);
  });

  it('matches for 1.4 and 1.4.0 — the release this ships in', () => {
    expect(SERVER_PATTERN.test(clientHeaderValue('1.4')!)).toBe(true);
    expect(SERVER_PATTERN.test(clientHeaderValue('1.4.0')!)).toBe(true);
  });

  it('is undefined when there is no version, rather than a header the server rejects', () => {
    expect(clientHeaderValue(undefined)).toBeUndefined();
    expect(clientHeaderValue('')).toBeUndefined();
  });

  // A malformed version must degrade to "no header" = legacy = default branch
  // only. The dangerous direction is the other one.
  it('refuses a version the server would not accept', () => {
    for (const v of ['1', 'abc', '1.4.0-beta', 'v1.4.0', '1.4.0 ', ' 1.4.0', '1..4']) {
      expect(clientHeaderValue(v)).toBeUndefined();
    }
  });

  it('exports the same pattern the server uses', () => {
    expect(CLIENT_HEADER_PATTERN.source).toBe(SERVER_PATTERN.source);
  });
});
