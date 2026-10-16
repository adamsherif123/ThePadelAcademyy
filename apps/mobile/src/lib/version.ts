/**
 * App-version comparison for the update prompt.
 *
 * Hand-rolled rather than pulling in `semver`: this needs ONE predicate over the
 * `major.minor.patch` strings Expo puts in CFBundleShortVersionString, and semver
 * is a full range/prerelease parser. The rule below is deliberately narrow and
 * fully tested (version.test.ts).
 *
 * String comparison is NOT good enough — '1.0.10' < '1.0.9' lexicographically,
 * which would tell every user on 1.0.10 they're behind forever. Each part is
 * compared as a NUMBER.
 */

/** Parse 'a.b.c' into numeric parts. Missing parts are 0 ('1.0' === '1.0.0'). */
function parts(version: string): number[] | null {
  const trimmed = version.trim();
  if (trimmed === '') return null;
  // Tolerate a leading 'v' and drop any build/prerelease suffix ('1.0.1-beta.2',
  // '1.0.1+42') — the numeric release is all that orders these.
  const core = trimmed.replace(/^v/i, '').split(/[-+]/)[0] ?? '';
  const segments = core.split('.');
  if (segments.length === 0 || segments.length > 4) return null;
  const nums = segments.map((s) => (/^\d+$/.test(s) ? Number(s) : Number.NaN));
  return nums.some(Number.isNaN) ? null : nums;
}

/** -1 | 0 | 1 for a < b, a === b, a > b. `null` when either side isn't parseable. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const pa = parts(a);
  const pb = parts(b);
  if (!pa || !pb) return null;
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/**
 * Is the installed app older than what's live on the App Store?
 *
 * FAIL SAFE: anything unparseable or missing returns false. A malformed config
 * value, or a version string we can't read, must never nag a user who might well
 * be up to date — a missed prompt is recoverable, a permanent false prompt is not.
 * Being AHEAD of the config (a TestFlight build newer than the store) is also
 * false: those users are not behind.
 */
export function isOutdated(installed: string | null | undefined, latest: string | null | undefined): boolean {
  if (!installed || !latest) return false;
  return compareVersions(installed, latest) === -1;
}

/**
 * Is the installed app BELOW the minimum this backend still supports?
 *
 * The hard gate's predicate — the counterpart to isOutdated, and deliberately a
 * separate function rather than a flag on it. They answer different questions and
 * have different consequences: isOutdated drives a once-a-day nudge the user can
 * dismiss, this one locks the app. Sharing one function would mean one edit could
 * silently turn a nudge into a wall.
 *
 * FAIL OPEN, for the same reason isOutdated fails safe but harder: a missed gate
 * is a user on an old build for another day, while a false gate is an app nobody
 * can open and no way to take it back except an App Store review cycle. So a null,
 * empty or unparseable value on EITHER side returns false. `min` null is the
 * normal state — it means "no floor set", which is how this ships.
 *
 * Strictly below: installed === min is supported, not blocked. The floor names the
 * OLDEST version that still works.
 */
export function isBelowMinimum(installed: string | null | undefined, min: string | null | undefined): boolean {
  if (!installed || !min) return false;
  return compareVersions(installed, min) === -1;
}

/** The two stores this app ships through. Anything else (web, an unknown OS) has no store. */
export type StorePlatform = 'ios' | 'android';

/**
 * The store this platform installs from, or null when there is none.
 *
 * `platform` is a plain string (Platform.OS) so this stays importable under the
 * node test environment, like everything else in this file. Null is the fail-open
 * answer: a platform with no store has no version to compare and nowhere to send
 * anyone, so neither the gate nor the prompt may act on it.
 */
export function storePlatform(platform: string): StorePlatform | null {
  return platform === 'ios' || platform === 'android' ? platform : null;
}

/**
 * The app_config columns each platform reads. Named, never derived, because anon
 * holds COLUMN grants on exactly these four (058, 073): a select that names any
 * other column — or `*` — is a permission error on the signed-out gate read.
 */
export const VERSION_COLUMNS = {
  ios: { latest: 'latest_ios_version', min: 'min_supported_ios_version' },
  android: { latest: 'latest_android_version', min: 'min_supported_android_version' },
} as const satisfies Record<StorePlatform, { latest: string; min: string }>;

/** The version fields of app_config, as the client maps them (mappers.ts AppConfig). */
export interface StoreVersions {
  latestIosVersion: string | null;
  latestAndroidVersion: string | null;
}

/**
 * The "latest live in the store" version THIS platform compares against, or null.
 *
 * Android reads its own field, never the iOS one: the stores release on their own
 * clocks, and an Android user told to install a version Play is still reviewing
 * would tap "Update now" and find nothing. Null (no row, offline, a backend that
 * predates 073, or no store at all) means no prompt.
 */
export function latestVersionFor(
  config: StoreVersions | null | undefined,
  platform: string,
): string | null {
  if (!config) return null;
  const store = storePlatform(platform);
  if (store === 'ios') return config.latestIosVersion || null;
  if (store === 'android') return config.latestAndroidVersion || null;
  return null;
}

/**
 * The Play Store package — expo.android.package in app.json, which is permanent
 * once the Play Console app exists. version.test.ts reads app.json and fails if
 * the two ever disagree, so a rename cannot leave the gate opening someone else's
 * listing.
 */
export const ANDROID_PACKAGE = 'com.thepadelacademy.app';

/** The App Store page. The numeric id is the App Store app id, not the bundle id. */
export const APP_STORE_URL = 'https://apps.apple.com/app/id6793803171';
/** Opens the App Store app directly; the gate falls back to https when nothing handles it. */
export const APP_STORE_DEEP_LINK = 'itms-apps://apps.apple.com/app/id6793803171';
/** Opens the Play Store app directly. */
export const PLAY_STORE_DEEP_LINK = `market://details?id=${ANDROID_PACKAGE}`;
/** The Play listing in a browser — for a device with no Play Store app to take market://. */
export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;

/**
 * The store URLs an "Update now" button tries, in order, until one opens.
 *
 * `surface` exists to keep iOS exactly as it shipped: the hard gate tries the
 * itms-apps deep link and then https, while the soft prompt has only ever opened
 * the https page. Android tries market:// (straight into the Play Store app) and
 * then the https listing, on both surfaces. An empty list — no store on this
 * platform — makes the button a no-op rather than a crash.
 */
export function storeUrls(platform: string, surface: 'gate' | 'prompt'): string[] {
  const store = storePlatform(platform);
  if (store === 'ios') return surface === 'gate' ? [APP_STORE_DEEP_LINK, APP_STORE_URL] : [APP_STORE_URL];
  if (store === 'android') return [PLAY_STORE_DEEP_LINK, PLAY_STORE_URL];
  return [];
}

/**
 * The hard gate's whole decision, as a pure function: should THIS build, on THIS
 * platform, against THIS floor, be locked out?
 *
 * Extracted from the component deliberately. There is no component-test harness in
 * this repo (vitest runs under `node`, and screens are rendering-proofs only), so
 * anything left inside HardUpdateGate is untested by construction. Everything that
 * can be decided from three values is decided here instead, where the fail-open
 * matrix is covered exhaustively — leaving the component with only what genuinely
 * needs a runtime: the fetch, its timeout, and the AppState subscription.
 *
 * `floor` must be THIS platform's floor (fetchVersionFloor reads the column
 * VERSION_COLUMNS names for it). `platform` is passed in rather than read from
 * react-native so this file stays importable under the node test environment.
 */
export function shouldHardBlock(
  platform: string,
  installed: string | null | undefined,
  floor: string | null | undefined,
): boolean {
  // Only the two store platforms have a floor; anything else is never blocked.
  if (storePlatform(platform) === null) return false;
  return isBelowMinimum(installed, floor);
}
