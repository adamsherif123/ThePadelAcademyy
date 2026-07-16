/**
 * @tpa/theme — the design-token source of truth, consumed by BOTH the React
 * Native app and the web admin. Tokens are platform-agnostic primitives: numbers
 * for spacing/radii/type, hex (or rgba) strings for colors. No px strings, no RN
 * StyleSheet, no CSS — each app adapts. LIGHT theme only.
 *
 * Values trace to the academy's live site; see palette.ts for provenance.
 */
import { color } from './color';
import { creditExpiry } from './domain';
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
  space,
  radius,
  elevation,
  fontSize,
  lineHeight,
  letterSpacing,
  fontWeight,
} as const;

export type Tokens = typeof tokens;

export { color } from './color';
export { creditExpiry, type TintPair } from './domain';
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
