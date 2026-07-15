/**
 * Platform-agnostic numeric scales. No px strings, no CSS, no RN StyleSheet —
 * just numbers each app interprets (RN treats them as dp; the admin maps them to
 * px via generated custom properties). Everything is typed; no stringly lookups.
 */

/** Spacing scale (dp / px). */
export const space = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

/** Corner radii. Site uses 8px controls/cards and 999px pills. */
export const radius = {
  none: 0,
  sm: 8,
  md: 12,
  lg: 16,
  pill: 9999,
} as const;

/**
 * Elevation scale as platform-agnostic primitives: vertical offset + blur +
 * opacity for iOS/web shadows, plus an Android `elevation` step. The shadow color
 * is applied by each app (mobile <Card> maps these to RN shadow props).
 */
export const elevation = {
  none: { y: 0, blur: 0, opacity: 0, elevation: 0 },
  sm: { y: 1, blur: 3, opacity: 0.06, elevation: 1 },
  md: { y: 8, blur: 24, opacity: 0.1, elevation: 4 },
  lg: { y: 16, blur: 36, opacity: 0.14, elevation: 8 },
} as const;

/** Font sizes (dp / px). */
export const fontSize = {
  caption: 12,
  label: 13,
  body: 15,
  bodyLarge: 17,
  h2: 20,
  h1: 26,
  display: 34,
} as const;

/** Absolute line heights matched to fontSize (dp / px). */
export const lineHeight = {
  caption: 16,
  label: 18,
  body: 22,
  bodyLarge: 24,
  h2: 26,
  h1: 32,
  display: 38,
} as const;

/** Letter spacing (dp / px). Site labels use ~0.08em; display is tight. */
export const letterSpacing = {
  tight: -0.5,
  normal: 0,
  label: 1,
} as const;

/**
 * Semantic font weights → numeric. These are the ONLY weight values the design
 * system uses. The mobile <Text> maps each to a specific baked font family
 * (e.g. Inter_700Bold) and never emits a `fontWeight` alongside it (Android
 * clips glyphs when both a weight-baked family and fontWeight are set).
 */
export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  black: 900,
} as const;

export type FontWeightToken = keyof typeof fontWeight;
