import { describe, expect, it } from 'vitest';

import { compareVersions, isOutdated } from './version';

describe('compareVersions', () => {
  it('orders each part NUMERICALLY, not as a string', () => {
    // The whole reason this exists: '1.0.10' < '1.0.9' as strings.
    expect(compareVersions('1.0.10', '1.0.9')).toBe(1);
    expect(compareVersions('1.0.9', '1.0.10')).toBe(-1);
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('2.0.0', '10.0.0')).toBe(-1);
  });

  it('treats missing trailing parts as zero', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.1', '1.0')).toBe(1);
  });

  it('is equal for identical versions', () => {
    expect(compareVersions('1.0.1', '1.0.1')).toBe(0);
  });

  it('tolerates a leading v and a prerelease/build suffix', () => {
    expect(compareVersions('v1.0.1', '1.0.1')).toBe(0);
    expect(compareVersions('1.0.1-beta.2', '1.0.1')).toBe(0);
    expect(compareVersions('1.0.1+42', '1.0.2')).toBe(-1);
  });

  it('returns null for anything unparseable', () => {
    for (const bad of ['', '   ', 'abc', '1.x.0', '1..0', '1.0.0.0.0']) {
      expect(compareVersions(bad, '1.0.0')).toBeNull();
      expect(compareVersions('1.0.0', bad)).toBeNull();
    }
  });
});

describe('isOutdated', () => {
  it('is true ONLY when installed is genuinely behind', () => {
    expect(isOutdated('1.0.1', '1.0.2')).toBe(true);
    expect(isOutdated('1.0.9', '1.0.10')).toBe(true);
    expect(isOutdated('0.9.9', '1.0.0')).toBe(true);
  });

  it('is false when up to date or ahead', () => {
    expect(isOutdated('1.0.1', '1.0.1')).toBe(false);
    // A TestFlight build newer than the store must not be told it is behind.
    expect(isOutdated('1.0.2', '1.0.1')).toBe(false);
  });

  it('FAILS SAFE — never nags on missing or malformed input', () => {
    expect(isOutdated(null, '1.0.2')).toBe(false);
    expect(isOutdated(undefined, '1.0.2')).toBe(false);
    expect(isOutdated('1.0.1', null)).toBe(false);
    expect(isOutdated('1.0.1', '')).toBe(false);
    expect(isOutdated('not-a-version', '1.0.2')).toBe(false);
    expect(isOutdated('1.0.1', 'latest')).toBe(false);
  });
});
