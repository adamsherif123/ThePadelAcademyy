import { describe, expect, it } from 'vitest';

import appJson from '../../app.json';
import { rowToAppConfig } from './mappers';
import {
  ANDROID_PACKAGE,
  APP_STORE_DEEP_LINK,
  APP_STORE_URL,
  PLAY_STORE_DEEP_LINK,
  PLAY_STORE_URL,
  VERSION_COLUMNS,
  compareVersions,
  isBelowMinimum,
  isOutdated,
  latestVersionFor,
  shouldHardBlock,
  storePlatform,
  storeUrls,
} from './version';

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

  it('blocks an Android build below the Android floor — from the first Android release', () => {
    expect(shouldHardBlock('android', '1.4', '1.5')).toBe(true);
    expect(shouldHardBlock('android', '1.0', '9.9')).toBe(true);
    expect(shouldHardBlock('android', '1.4.9', '1.10')).toBe(true);
  });

  it('never blocks a platform with no store, whatever the versions say', () => {
    expect(shouldHardBlock('web', '1.0', '9.9')).toBe(false);
    expect(shouldHardBlock('windows', '1.0', '9.9')).toBe(false);
    expect(shouldHardBlock('', '1.0', '9.9')).toBe(false);
  });

  it('fails open on Android exactly as on iOS', () => {
    // No Android floor set (how 073 ships) — and the null a pre-073 backend
    // produces once fetchVersionFloor's 42703 throw has been swallowed.
    expect(shouldHardBlock('android', '1.4', null)).toBe(false);
    expect(shouldHardBlock('android', '1.4', undefined)).toBe(false);
    expect(shouldHardBlock('android', '1.4', '')).toBe(false);
    expect(shouldHardBlock('android', null, '9.9')).toBe(false);
    expect(shouldHardBlock('android', undefined, '9.9')).toBe(false);
    expect(shouldHardBlock('android', 'dev', '9.9')).toBe(false);
    expect(shouldHardBlock('android', '1.4', 'soon')).toBe(false);
    expect(shouldHardBlock('android', '1.4', '1.4')).toBe(false);
    expect(shouldHardBlock('android', '1.5', '1.4')).toBe(false);
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

describe('storePlatform', () => {
  it('names the two store platforms', () => {
    expect(storePlatform('ios')).toBe('ios');
    expect(storePlatform('android')).toBe('android');
  });

  it('is null for anything else — no store, nothing to gate or prompt', () => {
    for (const p of ['web', 'windows', 'macos', '', 'IOS', 'Android']) expect(storePlatform(p)).toBeNull();
  });
});

describe('VERSION_COLUMNS — the columns anon is granted (058, 073)', () => {
  it('iOS reads exactly the columns it always has', () => {
    expect(VERSION_COLUMNS.ios).toEqual({ latest: 'latest_ios_version', min: 'min_supported_ios_version' });
  });

  // Exactly the names 073 grants to anon — app_config_android_test.sql selects each
  // of them as the real anon role.
  it('Android reads its own columns, never the iOS ones', () => {
    expect(VERSION_COLUMNS.android).toEqual({
      latest: 'latest_android_version',
      min: 'min_supported_android_version',
    });
  });
});

describe('latestVersionFor — which "latest" the soft prompt compares against', () => {
  const both = { latestIosVersion: '1.4', latestAndroidVersion: '1.5' };

  it('iOS reads latest_ios_version, unchanged', () => {
    expect(latestVersionFor(both, 'ios')).toBe('1.4');
    expect(latestVersionFor({ latestIosVersion: '1.4', latestAndroidVersion: null }, 'ios')).toBe('1.4');
  });

  it('Android reads latest_android_version and never falls back to the iOS value', () => {
    expect(latestVersionFor(both, 'android')).toBe('1.5');
    expect(latestVersionFor({ latestIosVersion: '9.9', latestAndroidVersion: null }, 'android')).toBeNull();
    expect(latestVersionFor({ latestIosVersion: '9.9', latestAndroidVersion: '' }, 'android')).toBeNull();
  });

  it('is null with no config (offline, no row) and on a platform with no store', () => {
    expect(latestVersionFor(null, 'ios')).toBeNull();
    expect(latestVersionFor(undefined, 'android')).toBeNull();
    expect(latestVersionFor(both, 'web')).toBeNull();
  });

  it('a pre-073 backend (the row has no Android keys) prompts nobody on Android and iOS as before', () => {
    // What `select *` returns on prod until 073 is pushed there.
    const pre073 = rowToAppConfig({ id: 1, latest_ios_version: '1.4', min_supported_ios_version: null });
    expect(pre073.latestAndroidVersion).toBeNull();
    expect(pre073.minSupportedAndroidVersion).toBeNull();
    expect(latestVersionFor(pre073, 'android')).toBeNull();
    expect(isOutdated('1.4', latestVersionFor(pre073, 'android'))).toBe(false);
    expect(latestVersionFor(pre073, 'ios')).toBe('1.4');
  });

  it('maps the 073 columns when present', () => {
    const row = rowToAppConfig({
      id: 1,
      latest_ios_version: '1.4',
      min_supported_ios_version: '1.3.1',
      latest_android_version: '1.5',
      min_supported_android_version: '1.4',
    });
    expect(row).toEqual({
      latestIosVersion: '1.4',
      minSupportedIosVersion: '1.3.1',
      latestAndroidVersion: '1.5',
      minSupportedAndroidVersion: '1.4',
    });
  });
});

describe('storeUrls — where "Update now" goes', () => {
  it('iOS is byte-for-byte what shipped: the gate tries itms-apps then https, the prompt https only', () => {
    expect(storeUrls('ios', 'gate')).toEqual([
      'itms-apps://apps.apple.com/app/id6793803171',
      'https://apps.apple.com/app/id6793803171',
    ]);
    expect(storeUrls('ios', 'prompt')).toEqual(['https://apps.apple.com/app/id6793803171']);
    expect(APP_STORE_DEEP_LINK).toBe('itms-apps://apps.apple.com/app/id6793803171');
    expect(APP_STORE_URL).toBe('https://apps.apple.com/app/id6793803171');
  });

  it('Android opens the Play Store app first, then the https listing, on both surfaces', () => {
    const expected = [
      'market://details?id=com.thepadelacademy.app',
      'https://play.google.com/store/apps/details?id=com.thepadelacademy.app',
    ];
    expect(storeUrls('android', 'gate')).toEqual(expected);
    expect(storeUrls('android', 'prompt')).toEqual(expected);
    expect([PLAY_STORE_DEEP_LINK, PLAY_STORE_URL]).toEqual(expected);
  });

  it('is empty on a platform with no store — the button does nothing rather than crash', () => {
    expect(storeUrls('web', 'gate')).toEqual([]);
    expect(storeUrls('web', 'prompt')).toEqual([]);
  });

  it('the Play package is app.json expo.android.package — the permanent Play Console id', () => {
    expect(appJson.expo.android.package).toBe(ANDROID_PACKAGE);
  });
});
