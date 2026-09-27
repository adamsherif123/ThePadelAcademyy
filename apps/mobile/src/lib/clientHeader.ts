/**
 * How the app identifies itself to the backend, as a pure function.
 *
 * Deliberately free of any React Native import so it can be unit-tested: the
 * module that reads the actual installed version (clientVersion.ts) pulls in
 * expo-constants, which drags in react-native and cannot be parsed under the
 * node test runner.
 *
 * ── what the server does with this ──
 * tpa.client_is_location_aware() matches the pattern below EXACTLY. A client that
 * sends nothing, or anything malformed, is treated as pre-1.4 and sees only the
 * default branch. That is the fail-safe direction: the worst case for a mangled
 * version is that this build behaves like 1.3 — never that a 1.3 build starts
 * seeing branches it has no screens for.
 */
export const CLIENT_HEADER_PATTERN = /^mobile\/\d+\.\d+(\.\d+)?$/;

/**
 * `mobile/1.4.0`, or undefined when there is no usable version.
 *
 * Undefined rather than a placeholder: a header the server would reject has the
 * same effect as no header, and `mobile/unknown` would only make the logs lie
 * about what happened.
 */
export function clientHeaderValue(version: string | undefined): string | undefined {
  if (!version) return undefined;
  const value = `mobile/${version}`;
  return CLIENT_HEADER_PATTERN.test(value) ? value : undefined;
}
