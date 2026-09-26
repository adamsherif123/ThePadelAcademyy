import type { Location, LocationId } from '@tpa/types';

import {
  insertLocation,
  setLocationActiveRpc,
  updateLocation as updateLocationApi,
  type LocationFields,
  type SetLocationActiveResult,
} from '../lib/api';
import { TOUCHED } from '../lib/queryClient';
import { runRpc, runWrite, type WriteResult } from './queries';

/**
 * Branch CRUD, plus the two selectors every other screen will want once it has
 * to care which branch it is looking at.
 *
 * Create and edit are plain INSERT/UPDATE: they are is_admin()-gated config, not
 * money, so they follow the coaches/packages pattern rather than going through an
 * RPC. Deactivation does not, because its refusals are workflow facts a human
 * reads — see setLocationActive.
 *
 * There is no delete. Slots, templates and packages reference a location; a
 * removed branch would either orphan history or cascade into it, so a branch is
 * retired the same way a coach or a package is.
 */

/** The original branch — the one every pre-1.4 client is pinned to. */
export function defaultLocation(locations: readonly Location[]): Location | null {
  return locations.find((l) => l.isDefault) ?? null;
}

/**
 * The branch a new slot/template/package should be created at while there is no
 * location picker in the UI (it arrives in Session 3).
 *
 * Falls back to the first location rather than null so a create can always
 * proceed: `locations` is never legitimately empty — migration 061 seeds the
 * original branch and nothing can delete it — and the DB has its own fallback
 * trigger behind this one.
 */
export function creationLocationId(locations: readonly Location[]): LocationId | null {
  return (defaultLocation(locations) ?? locations[0])?.id ?? null;
}

/** Active branches first, then the rest — both already in (sort_order, name) order. */
export function locationsForDisplay(locations: readonly Location[]): Location[] {
  return [...locations].sort((a, b) => Number(b.isActive) - Number(a.isActive));
}

export function createLocation(fields: LocationFields): Promise<WriteResult<Location>> {
  return runWrite(() => insertLocation(fields), TOUCHED.locations);
}

export function updateLocation(id: LocationId, fields: Partial<LocationFields>): Promise<WriteResult<Location>> {
  return runWrite(() => updateLocationApi(id, fields), TOUCHED.locations);
}

/**
 * Activate or deactivate a branch. The RPC refuses to deactivate the default
 * branch, one with future published sessions, or one with active recurring rules
 * — each as a {ok:false, reason} the modal renders as its own sentence.
 */
export function setLocationActive(
  id: LocationId,
  active: boolean,
): Promise<SetLocationActiveResult | { ok: false; reason: 'network' }> {
  return runRpc(() => setLocationActiveRpc(id, active), TOUCHED.locations);
}
