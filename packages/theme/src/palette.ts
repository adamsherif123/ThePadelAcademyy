/**
 * Raw brand palette — the exact hex values extracted from the academy's live
 * site (the-padel-academy-eg…chatgpt.site), taken from its CSS `:root` custom
 * properties and component rules. These are INTERNAL literals; nothing outside
 * @tpa/theme should import them. UI code consumes the semantic `tokens` instead,
 * so a brand shift changes one mapping here, not a thousand call sites.
 *
 * Provenance is noted per value. Values marked DERIVED are NOT on the site (it
 * simply has no such role) and were chosen here — see the S2 report.
 */

// --- Core brand (site :root) ---
export const NAVY = '#06122f'; //        --navy      nav / hero canvas
export const NAVY_2 = '#091b49'; //      --navy-2    hero gradient end
export const NAVY_HERO_PANEL = '#0b1735'; // .hero-visual background
export const NAVY_DARKEST = '#030817'; // .footer background
export const INK = '#07101f'; //         --ink       body text / headings on light
export const ROYAL = '#1557ff'; //       --royal     Book Now, prices, numerals, links
export const ROYAL_2 = '#0d3cc7'; //     --royal-2   pressed / gradient accent
export const MUTED = '#60708f'; //       --muted     secondary text
export const PERIWINKLE = '#82a4ff'; //  .eyebrow    PROGRAMS / WHY TRAIN WITH US labels
export const PERIWINKLE_BORDER = '#c6d7ff'; // .location-link border
export const SURFACE = '#ffffff'; //     --surface   white card surfaces
export const CANVAS = '#f3f6fb'; //      --soft      body / light section background
export const ICE = '#eaf1ff'; //         --ice       small chip / label background on light

// --- Borders on light ---
export const BORDER_SUBTLE = '#dce5f5'; // .price-card / .coach-card border
export const BORDER_INPUT = '#cad6ea'; //  .input border
export const BORDER_FAINT = '#e1e8f4'; //  .schedule-grid top border

// --- Status (site) ---
export const SUCCESS_FG = '#075e35'; //  .form-success color
export const SUCCESS_BG = '#dff8eb'; //  .form-success background
export const DANGER_FG = '#8f1c1c'; //   .form-error color
export const DANGER_BG = '#ffe4e4'; //   .form-error background

// --- Translucent white on navy (site uses #ffffffAA overlays) ---
export const ON_NAVY_LINE = 'rgba(255,255,255,0.14)'; //   --line #ffffff24, borders on navy
export const ON_NAVY_PILL_BG = 'rgba(255,255,255,0.08)'; // .coach-badges small bg #ffffff14
export const ON_NAVY_PILL_BORDER = 'rgba(255,255,255,0.16)'; // #ffffff29
export const ON_NAVY_PILL_TEXT = 'rgba(255,255,255,0.82)'; //  #ffffffd1

// --- DERIVED (not on the site; chosen here — flagged in the S2 report) ---
export const WARNING_FG = '#92600a'; //  amber; site has no warning role
export const WARNING_BG = '#fbeccb'; //  amber tint
export const TEXT_MUTED = '#9aa7bd'; //  lighter neutral than --muted; site has no 3rd text level
export const ACCENT_DISABLED = '#aebfe8'; // desaturated royal for disabled actions
export const TINT_DUO_BG = '#e6ebf4'; // soft slate: the admin's duo (navy) tint fill — the site has no navy-tint surface

// --- DARK scheme (mobile only — the admin stays light-only) ---
// Designed as a real dark palette, not an inversion: a dark charcoal-navy canvas
// (never pure black — reads softer, and stays a family with the brand's own
// navy), a lighter step for surfaces so cards separate from the page, and
// accent/status hues LIFTED in lightness (not just reused) since the light
// palette's saturated-but-dark royal/success/danger read muddy or nearly
// invisible against a dark background — each needs more luminance to still
// pop, same as the reasoning already documented for translucent-white-on-navy.
export const DARK_CANVAS = '#0a1220'; //        page background
export const DARK_SURFACE = '#141d33'; //       card / raised surface (a step lighter than canvas)
export const DARK_INVERSE = '#1c2b52'; //       hero/summary "inverse" surface — richer navy, distinct from ordinary surface
export const DARK_INK = '#eef1f8'; //           primary text on dark — soft off-white, not stark #fff
export const DARK_MUTED = '#9aa8c7'; //         secondary text on dark
export const DARK_TEXT_MUTED = '#6d7994'; //    least-emphasis text (captions/meta) on dark
export const DARK_LABEL = '#9db4ff'; //         eyebrow labels on dark — periwinkle family, lifted for legibility
export const DARK_ROYAL = '#5b93ff'; //         primary accent on dark — lightened; the light ROYAL reads muddy on dark navy
export const DARK_ROYAL_2 = '#3f6fe0'; //       pressed accent on dark — deeper than DARK_ROYAL, still clearly brighter than base ROYAL
export const DARK_ACCENT_DISABLED = '#3c4a70'; // dim/desaturated accent for disabled actions on dark
export const DARK_ICE = '#1a2c52'; //           soft tinted chip/badge fill on dark — ICE's role, inverted
export const DARK_BORDER_SUBTLE = '#232f4d'; // hairline dividers on dark
export const DARK_BORDER_INPUT = '#3a4568'; //  stronger borders (inputs/controls) on dark
export const DARK_SUCCESS_FG = '#3ddc84'; //    brighter green — the light SUCCESS_FG would nearly vanish on dark
export const DARK_SUCCESS_BG = '#123023'; //    success pill/badge fill on dark
export const DARK_WARNING_FG = '#f0b74a'; //    brighter amber on dark
export const DARK_WARNING_BG = '#3a2c11'; //    warning pill/badge fill on dark
export const DARK_DANGER_FG = '#ff6b6b'; //     brighter coral-red — the light DANGER_FG would nearly vanish on dark
export const DARK_DANGER_BG = '#3a1414'; //     danger pill/badge fill on dark
