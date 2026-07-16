import type { CreditExpiryState } from '@tpa/core';

import * as p from './palette';

/** A foreground/background tint pair for tinted surfaces (pills, chips). */
export interface TintPair {
  fg: string;
  bg: string;
}

/**
 * Credit-expiry visual states for the wallet, keyed by @tpa/core's canonical
 * `CreditExpiryState` union (single source of truth). `ok` reads healthy (green),
 * `expiring_soon` a warning (amber, DERIVED), `expired` danger (red). Pairs a
 * strong `fg` with a soft `bg` for pills/badges.
 *
 * NOTE (S3a): color communicates EXPIRY ONLY. Per-TrainingType tints were removed
 * — training type is shown as a labelled pill with an icon, never a hue (two color
 * dimensions on one card read as noise, and individual's amber collided with
 * expiring_soon).
 */
export const creditExpiry = {
  ok: { fg: p.SUCCESS_FG, bg: p.SUCCESS_BG },
  expiring_soon: { fg: p.WARNING_FG, bg: p.WARNING_BG },
  expired: { fg: p.DANGER_FG, bg: p.DANGER_BG },
} as const satisfies Record<CreditExpiryState, TintPair>;
