import * as p from './palette';

/**
 * Semantic color roles for the LIGHT theme (the only theme — no dark palette, no
 * switcher). Names describe intent, never the literal hue, so the brand can shift
 * by re-pointing these at different palette entries.
 */
export const color = {
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
