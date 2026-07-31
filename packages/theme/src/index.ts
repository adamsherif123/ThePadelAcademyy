/**
 * @tpa/theme — the design-token source of truth, consumed by BOTH the React
 * Native app and the web admin. Tokens are platform-agnostic primitives: numbers
 * for spacing/radii/type, hex (or rgba) strings for colors. No px strings, no RN
 * StyleSheet, no CSS — each app adapts.
 *
 * `tokens`/`color`/`creditExpiry` stay LIGHT-ONLY and byte-identical to before
 * dark mode existed — the admin's token codegen (apps/admin/scripts/generate-
 * tokens.ts) imports `tokens` directly and has no dark mode. `colorSchemes` /
 * `creditExpirySchemes` are the scheme-aware pairs the MOBILE app's theme
 * provider resolves against (apps/mobile/src/theme/ThemeProvider.tsx) — this
 * package stays platform-agnostic, so the provider itself (useColorScheme,
 * AsyncStorage, React context) lives there, not here.
 *
 * Values trace to the academy's live site; see palette.ts for provenance.
 */
import { color, colorSchemes } from './color';
import { creditExpiry, creditExpirySchemes, trainingTint } from './domain';
import {
  elevation,
  fontSize,
  fontWeight,
  letterSpacing,
  lineHeight,
  radius,
  space,
} from './scale';

export const tokens = {
  color,
  creditExpiry,
  trainingTint,
  space,
  radius,
  elevation,
  fontSize,
  lineHeight,
  letterSpacing,
  fontWeight,
} as const;

export type Tokens = typeof tokens;

export { color, colorSchemes, type ColorScheme } from './color';
export { creditExpiry, creditExpirySchemes, trainingTint, type TintPair } from './domain';
export type { CreditExpiryState } from '@tpa/core';
export {
  elevation,
  fontSize,
  fontWeight,
  letterSpacing,
  lineHeight,
  radius,
  space,
  type FontWeightToken,
} from './scale';
