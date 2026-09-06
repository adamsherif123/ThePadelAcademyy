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
