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
 * `platform` is passed in rather than read from react-native so this file stays
 * importable under the node test environment.
 */
export function shouldHardBlock(
  platform: string,
  installed: string | null | undefined,
  floor: string | null | undefined,
): boolean {
  // Only iOS ships this app, and the floor is an iOS version string.
  if (platform !== 'ios') return false;
  return isBelowMinimum(installed, floor);
}
