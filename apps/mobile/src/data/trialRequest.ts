import type { CreditRequest, Location } from '@tpa/types';

import type { RequestCreditsReason } from '../lib/api';

/**
 * The branch a live trial request is already sitting at, or null if there is none.
 *
 * `pending` only. An APPROVED trial is a trial the player has been given — they
 * are not waiting for anything, and `trial_already_used` is then simply true.
 * A `rejected` one is not live at all: the one-trial index excludes it precisely
 * so a declined attempt can be retried.
 */
export function pendingTrialBranchName(
  requests: readonly CreditRequest[],
  locations: readonly Location[],
): string | null {
  const pending = requests.find((r) => r.isTrial && r.status === 'pending');
  if (!pending) return null;
  return locations.find((l) => l.id === pending.locationId)?.name ?? null;
}

/** What the screen should show when request_credits refuses. */
export type TrialRefusal = 'trial_pending' | 'plain';

/**
 * `trial_already_used` is ONE reason covering TWO players, and telling them apart
 * is the difference between a true sentence and a false one.
 *
 * tpa.trial_used is `a purchased trial batch exists OR a live trial request
 * exists`. So a player who submitted a trial request at one branch and then tries
 * another gets `trial_already_used` — and "you've already used your one-time
 * trial session" is untrue for them: they have used nothing, they are waiting.
 * The server cannot distinguish the two without a new reason code, which would be
 * a migration and a new value for clients that can never update. The client can,
 * by reading its own credit_requests, which is what `hasPendingTrial` is.
 */
export function trialRefusalKind(
  reason: RequestCreditsReason,
  hasPendingTrial: boolean,
): TrialRefusal {
  return reason === 'trial_already_used' && hasPendingTrial ? 'trial_pending' : 'plain';
}
