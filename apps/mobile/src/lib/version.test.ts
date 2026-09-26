import { describe, expect, it } from 'vitest';

import { compareVersions, isBelowMinimum, isOutdated, shouldHardBlock } from './version';

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

describe('isBelowMinimum — the hard gate predicate', () => {
  it('blocks a build below the floor', () => {
    expect(isBelowMinimum('1.2', '1.3.1')).toBe(true);
    expect(isBelowMinimum('1.3', '1.3.1')).toBe(true);
    expect(isBelowMinimum('1.0.1', '1.4')).toBe(true);
  });

  it('does NOT block at or above the floor — the floor is the oldest SUPPORTED version', () => {
    expect(isBelowMinimum('1.3.1', '1.3.1')).toBe(false);
    expect(isBelowMinimum('1.4', '1.3.1')).toBe(false);
    // A TestFlight build ahead of the floor is not too old.
    expect(isBelowMinimum('2.0', '1.3.1')).toBe(false);
  });

  it('orders MIXED-LENGTH versions numerically, not lexically', () => {
    // The exact ladder this release walks: 1.3 < 1.3.1 < 1.4.
    expect(isBelowMinimum('1.3', '1.3.1')).toBe(true);
    expect(isBelowMinimum('1.3.1', '1.4')).toBe(true);
    expect(isBelowMinimum('1.4', '1.3.1')).toBe(false);
    // '1.3.1' < '1.10' numerically, though it sorts AFTER as a string.
    expect(isBelowMinimum('1.3.1', '1.10')).toBe(true);
    expect(isBelowMinimum('1.10', '1.3.1')).toBe(false);
    // Missing parts are zero: '1.3' === '1.3.0', so it is below '1.3.1' but not '1.3.0'.
    expect(isBelowMinimum('1.3', '1.3.0')).toBe(false);
  });

  it('FAILS OPEN — a floor it cannot read never locks anyone out', () => {
    // null/undefined min is the normal state: no floor set.
    expect(isBelowMinimum('1.2', null)).toBe(false);
    expect(isBelowMinimum('1.2', undefined)).toBe(false);
    expect(isBelowMinimum('1.2', '')).toBe(false);
    // An unknown installed version proves nothing about the build.
    expect(isBelowMinimum(null, '9.9')).toBe(false);
    expect(isBelowMinimum(undefined, '9.9')).toBe(false);
    expect(isBelowMinimum('', '9.9')).toBe(false);
    // Malformed on either side.
    expect(isBelowMinimum('not-a-version', '9.9')).toBe(false);
    expect(isBelowMinimum('1.2', 'latest')).toBe(false);
    expect(isBelowMinimum('1.2', '9.9.9.9.9')).toBe(false);
  });

  it('is independent of isOutdated — a nudge is not a block', () => {
    // Behind the store but at/above the floor: nudge yes, block no.
    expect(isOutdated('1.3.1', '1.4')).toBe(true);
    expect(isBelowMinimum('1.3.1', '1.3.1')).toBe(false);
  });
});

describe('shouldHardBlock — the whole gate decision, minus the runtime', () => {
  it('blocks an iOS build below the floor', () => {
    expect(shouldHardBlock('ios', '1.3', '1.3.1')).toBe(true);
    expect(shouldHardBlock('ios', '1.2', '1.4')).toBe(true);
  });

  it('never blocks a non-iOS platform, whatever the versions say', () => {
    expect(shouldHardBlock('android', '1.0', '9.9')).toBe(false);
    expect(shouldHardBlock('web', '1.0', '9.9')).toBe(false);
    expect(shouldHardBlock('', '1.0', '9.9')).toBe(false);
  });

  it('fails open on every unknown — the matrix that must never brick the app', () => {
    // no floor set (how this ships)
    expect(shouldHardBlock('ios', '1.3.1', null)).toBe(false);
    expect(shouldHardBlock('ios', '1.3.1', undefined)).toBe(false);
    expect(shouldHardBlock('ios', '1.3.1', '')).toBe(false);
    // unknown installed version
    expect(shouldHardBlock('ios', null, '9.9')).toBe(false);
    expect(shouldHardBlock('ios', undefined, '9.9')).toBe(false);
    // malformed either side
    expect(shouldHardBlock('ios', 'dev', '9.9')).toBe(false);
    expect(shouldHardBlock('ios', '1.3.1', 'soon')).toBe(false);
  });

  it('does not block at or above the floor', () => {
    expect(shouldHardBlock('ios', '1.3.1', '1.3.1')).toBe(false);
    expect(shouldHardBlock('ios', '1.4', '1.3.1')).toBe(false);
  });

  it('ships inert: 1.3.1 against the NULL floor this migration leaves in place', () => {
    expect(shouldHardBlock('ios', '1.3.1', null)).toBe(false);
  });
});
