import type { CreditExpiryState } from '@tpa/core';
import type { TrainingType } from '@tpa/types';

import * as p from './palette';

/** A foreground/background tint pair for tinted surfaces (pills, chips). */
export interface TintPair {
  fg: string;
  bg: string;
}

/**
 * A distinct tint per TrainingType so typed credits and slots are separable at a
 * glance. `satisfies Record<TrainingType, TintPair>` makes this exhaustive and
 * drift-proof: add a training type to the union and this stops compiling until a
 * tint exists for it.
 *
 * DESIGNED, not extracted — the site has no per-training-type colors (its program
 * cards all use royal/navy). Hues chosen for maximum separability while staying in
 * the brand's cool register where possible. See the S2 report.
 */
export const trainingTint = {
  trial: { fg: p.ROYAL, bg: p.ICE }, //          royal blue — the entry format, uses the brand accent
  group: { fg: '#0f766e', bg: '#d5efeb' }, //    teal
  duo: { fg: '#6d28d9', bg: '#ece4fb' }, //      violet
  individual: { fg: '#b45309', bg: '#fbecd6' }, // amber
} as const satisfies Record<TrainingType, TintPair>;

/**
 * Credit-expiry visual states for the wallet, keyed by @tpa/core's canonical
 * `CreditExpiryState` union (single source of truth). `ok` reads healthy (green),
 * `expiring_soon` a warning (amber, DERIVED), `expired` danger (red). Pairs a
 * strong `fg` with a soft `bg` for pills/badges.
 */
export const creditExpiry = {
  ok: { fg: p.SUCCESS_FG, bg: p.SUCCESS_BG },
  expiring_soon: { fg: p.WARNING_FG, bg: p.WARNING_BG },
  expired: { fg: p.DANGER_FG, bg: p.DANGER_BG },
} as const satisfies Record<CreditExpiryState, TintPair>;
