import type { CoachId, PlayerId } from '@tpa/types';

import { setPlayerCoachRpc, type SetPlayerCoachResult } from '../lib/api';
import { TOUCHED } from '../lib/queryClient';
import { runRpc } from './queries';

/**
 * Link a player account to a coaches record — the account that coach signs in with —
 * or clear it by passing null.
 *
 * Admin-gated SECURITY DEFINER, like every other write to a player-owned row: there
 * is no admin UPDATE policy on `players` (only players_update_self), which
 * data/players.ts's `updatePlayerProfile` reports as `not_supported`. That stays
 * true; this grants exactly "an admin may set the coach link", one column wide.
 */
export function setPlayerCoach(
  playerId: PlayerId,
  coachId: CoachId | null,
): Promise<SetPlayerCoachResult | { ok: false; reason: 'network' }> {
  return runRpc(() => setPlayerCoachRpc(playerId, coachId), TOUCHED.playerCoach);
}
