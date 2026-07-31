import * as p from './palette';

/** Which scheme a resolved token set belongs to — the mobile app's only switch. */
export type ColorScheme = 'light' | 'dark';

/**
 * Semantic color roles, one object per scheme. Names describe intent, never the
 * literal hue, so the brand can shift by re-pointing these at different palette
 * entries — and now a SECOND set of entries for dark. Token names are identical
 * across both; only the palette values differ. `border.onInverse` and
 * `pillOnInverse.*` are deliberately IDENTICAL in both schemes: `bg.inverse` is a
 * navy-family surface in both light and dark, so the translucent-white overlay
 * designed for "on navy" already reads correctly regardless of the app's overall
 * scheme — there is no separate "on navy, but the app is dark" case to design for.
 */
const lightColor = {
  bg: {
    /** App/page background — light section canvas. */
    canvas: p.CANVAS,
    /** Cards and raised surfaces. */
    surface: p.SURFACE,
    /** Deep-navy surfaces: nav, hero, inverse cards. */
    inverse: p.NAVY,
  },
  text: {
    /** Headings and primary body copy on light. */
    primary: p.INK,
    /** Secondary / supporting copy. */
    secondary: p.MUTED,
    /** Least-emphasis copy (meta, captions). DERIVED. */
    muted: p.TEXT_MUTED,
    /** Copy on inverse (navy) surfaces. */
    inverse: p.SURFACE,
    /** Small uppercase eyebrow labels (PROGRAMS, WHY TRAIN WITH US). */
    label: p.PERIWINKLE,
  },
  accent: {
    /** Primary action — royal blue. */
    default: p.ROYAL,
    /** Pressed / active accent. */
    pressed: p.ROYAL_2,
    /** Disabled action. DERIVED. */
    disabled: p.ACCENT_DISABLED,
    /** Soft royal surface — tinted chips/badges on light (the site's `--ice`). */
    soft: p.ICE,
  },
  border: {
    /** Hairline dividers / card borders on light. */
    subtle: p.BORDER_SUBTLE,
    /** Stronger borders — inputs, controls. */
    strong: p.BORDER_INPUT,
    /** Borders on inverse (navy) surfaces. */
    onInverse: p.ON_NAVY_LINE,
  },
  status: {
    success: p.SUCCESS_FG,
    /** DERIVED — site has no warning hue. */
    warning: p.WARNING_FG,
    danger: p.DANGER_FG,
  },
  /** Translucent pill/badge styling on navy (the hero's coach badges). */
  pillOnInverse: {
    bg: p.ON_NAVY_PILL_BG,
    border: p.ON_NAVY_PILL_BORDER,
    text: p.ON_NAVY_PILL_TEXT,
  },
} as const;

/**
 * The dark scheme. Not an inversion — a dark charcoal-navy canvas (never pure
 * black), a lighter step for surfaces so cards separate from the page, and
 * accent/status hues LIFTED in lightness so they still read against a dark
 * background (the light palette's saturated-but-dark royal/success/danger would
 * look muddy or nearly vanish here). See palette.ts's DARK_* block for the raw
 * values and per-token reasoning.
 */
const darkColor = {
  bg: {
    canvas: p.DARK_CANVAS,
    surface: p.DARK_SURFACE,
    inverse: p.DARK_INVERSE,
  },
  text: {
    primary: p.DARK_INK,
    secondary: p.DARK_MUTED,
    muted: p.DARK_TEXT_MUTED,
    /** Copy on the dark "inverse" surface — same soft off-white as primary text,
     * rather than a second, brighter white, so a screen doesn't carry two
     * different whites at once. */
    inverse: p.DARK_INK,
    label: p.DARK_LABEL,
  },
  accent: {
    default: p.DARK_ROYAL,
    pressed: p.DARK_ROYAL_2,
    disabled: p.DARK_ACCENT_DISABLED,
    soft: p.DARK_ICE,
  },
  border: {
    subtle: p.DARK_BORDER_SUBTLE,
    strong: p.DARK_BORDER_INPUT,
    onInverse: p.ON_NAVY_LINE,
  },
  status: {
    success: p.DARK_SUCCESS_FG,
    warning: p.DARK_WARNING_FG,
    danger: p.DARK_DANGER_FG,
  },
  pillOnInverse: {
    bg: p.ON_NAVY_PILL_BG,
    border: p.ON_NAVY_PILL_BORDER,
    text: p.ON_NAVY_PILL_TEXT,
  },
} as const satisfies Record<keyof typeof lightColor, unknown>;

/** The light scheme — kept as the plain `color` export (byte-identical to
 * before dark mode existed): the admin's token codegen (generate-tokens.ts)
 * imports `tokens.color` directly and stays light-only, unaffected by this. */
export const color = lightColor;

/** Both schemes, keyed by `ColorScheme` — what the mobile app's theme
 * provider resolves against at runtime. */
export const colorSchemes = { light: lightColor, dark: darkColor } as const;
