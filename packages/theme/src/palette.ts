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
