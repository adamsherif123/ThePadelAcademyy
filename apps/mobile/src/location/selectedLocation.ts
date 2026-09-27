import type { Location, LocationId } from '@tpa/types';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'tpa.selectedLocation';

/**
 * Which branch the player is looking at, remembered across launches.
 *
 * Same shape as updatePrompt.ts: every read and write is wrapped, because
 * AsyncStorage failing is not a reason to fail to render the app. A read that
 * throws is indistinguishable from "nothing stored", and both mean "use the
 * default branch".
 */
export async function readSelectedLocation(): Promise<LocationId | null> {
  try {
    return (await AsyncStorage.getItem(STORAGE_KEY)) as LocationId | null;
  } catch {
    // Storage unavailable — fall back to the default branch rather than blocking.
    return null;
  }
}

export async function writeSelectedLocation(id: LocationId): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Non-fatal: the choice holds for this run, it just won't survive a restart.
  }
}

/**
 * The branch to actually show, given what was stored and what exists right now.
 *
 * Pure, and the whole fallback rule in one place, because every one of these
 * cases is real and each would otherwise be a different bug:
 *   • nothing stored — first launch
 *   • stored id no longer exists — the branch was removed from the account
 *   • stored id is now INACTIVE — the branch closed while the app was shut
 *   • no default flagged — shouldn't happen (061 seeds one) but must not crash
 *
 * An inactive branch is NOT honoured: a closed branch has no bookable sessions
 * and no sellable packages, so restoring it would open the app on an empty
 * screen with no explanation. Falling back to the default shows the player
 * something real.
 */
export function resolveSelectedLocation(
  locations: readonly Location[],
  stored: LocationId | null,
): Location | null {
  const active = locations.filter((l) => l.isActive);
  const named = stored === null ? undefined : active.find((l) => l.id === stored);
  return named ?? active.find((l) => l.isDefault) ?? active[0] ?? null;
}

/** Active branches in the order the toggle lists them (sort_order, then name). */
export function toggleOptions(locations: readonly Location[]): Location[] {
  return locations
    .filter((l) => l.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/**
 * The toggle is hidden with fewer than two branches.
 *
 * 1.4 ships before the second branch opens, and a picker with one option is a
 * control that cannot do anything — the app should look exactly like 1.3 until
 * there is a real choice to make.
 */
export function shouldShowToggle(locations: readonly Location[]): boolean {
  return toggleOptions(locations).length > 1;
}
