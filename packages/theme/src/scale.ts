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

/**
 * Corner radii. SHAPE derives from the approved app design (design/rork/*), NOT
 * the marketing website — those are different sources of truth (colors come from
 * the site, shape/spacing/elevation from the product design). The mobile design
 * is soft and generously rounded: controls/inputs ~14, cards ~18, the navy
 * hero/summary cards rounder still ~24, and every button/chip/progress bar a
 * full pill.
 */
export const radius = {
  none: 0,
  sm: 10, // inner tiles / tight rounded rects
  md: 14, // inputs, choice buttons, info & level cards, OTP boxes
  lg: 18, // standard white cards
  xl: 24, // navy hero / summary cards (read rounder)
  pill: 9999, // buttons, chips, status pills, progress bars, avatars
} as const;

/**
 * Elevation scale as platform-agnostic primitives: vertical offset + blur +
 * opacity for iOS/web shadows, plus an Android `elevation` step. The shadow color
 * is applied by each app (mobile <Card> maps these to RN shadow props).
 *
 * The app design reads nearly FLAT — a hairline border does the work and the
 * shadow is only a whisper. `card` is the soft, diffuse, very-low-opacity ambient
 * used by <Card>; `md`/`lg` remain for anything that genuinely needs to float.
 */
export const elevation = {
  none: { y: 0, blur: 0, opacity: 0, elevation: 0 },
  card: { y: 2, blur: 12, opacity: 0.05, elevation: 1 },
  sm: { y: 1, blur: 3, opacity: 0.06, elevation: 1 },
  md: { y: 8, blur: 24, opacity: 0.1, elevation: 4 },
  lg: { y: 16, blur: 36, opacity: 0.14, elevation: 8 },
} as const;

/**
 * Font sizes (dp / px). TYPOGRAPHY derives from the approved app design
 * (design/rork/*), NOT the marketing website — different sources of truth (colors
 * come from the site, but shape/spacing/elevation/typography from the product
 * design). The site's 34px/900 headings and 13px/900 eyebrows are desktop
 * marketing weights; the phone design reads smaller and lighter. `micro` is for
 * tiny uppercase tile labels (e.g. "SESSIONS").
 */
export const fontSize = {
  micro: 10,
  caption: 12,
  label: 12,
  body: 15,
  bodyLarge: 17,
  h2: 18,
  h1: 24,
  display: 28,
} as const;

/** Absolute line heights matched to fontSize (dp / px). Retuned with the sizes above. */
export const lineHeight = {
  micro: 12,
  caption: 16,
  label: 16,
  body: 22,
  bodyLarge: 24,
  h2: 24,
  h1: 30,
  display: 32,
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
