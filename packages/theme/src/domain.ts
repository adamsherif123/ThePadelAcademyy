import type { CreditExpiryState } from '@tpa/core';
import type { TrainingType } from '@tpa/types';

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

/**
 * Training-type colour coding — a fg accent + soft bg fill per type, keyed by
 * @tpa/types' `TrainingType` with `satisfies` so it can't drift. From the v0
 * legend: Group=royal, Duo=navy, Individual=amber, Trial=green.
 *
 * USAGE RULE — ADMIN ONLY. The web admin may use this: its week calendar colour-
 * codes by training type and a dense grid genuinely needs type-at-a-glance. The
 * CLIENT (mobile) app may NOT: there, colour communicates credit EXPIRY only. A
 * client CreditPill already carries type + expiry, so a second hue competes (and
 * individual's amber literally collided with expiring_soon's amber). This isn't
 * just documented — an eslint rule in apps/mobile bans importing `trainingTint`
 * from @tpa/theme, with this reasoning in the message.
 */
export const trainingTint = {
  group: { fg: p.ROYAL, bg: p.ICE },
  duo: { fg: p.NAVY, bg: p.TINT_DUO_BG },
  individual: { fg: p.WARNING_FG, bg: p.WARNING_BG },
  trial: { fg: p.SUCCESS_FG, bg: p.SUCCESS_BG },
} as const satisfies Record<TrainingType, TintPair>;
