import type { LocationId } from '@tpa/types';
import { useCallback } from 'react';

import { useLocations } from '../data/queries';
import { useLocation } from './LocationProvider';
import { placeFor, type PlaceFacts } from './slotLocation';

/**
 * Where a session is — or NULL when saying so would be noise.
 *
 * Two rules in one place, because every screen that shows a branch wants both:
 *
 *   1. The place comes from the SESSION's own location_id (placeFor), never from
 *      whatever branch the player happens to be browsing.
 *   2. With a single active branch it answers null, so the caller renders
 *      nothing. An academy with one location would otherwise stamp the same name
 *      on every row — clutter that says nothing — and the day a second branch
 *      opens, every one of those rows starts answering a real question.
 *
 * `showToggle` is the same predicate the player's toggle and BranchLabel use, so
 * the whole app appears and disappears together rather than screen by screen.
 * The coach app has no toggle, but it has the same question, so it uses the same
 * answer.
 */
export function useBranchPlace(): (locationId: LocationId | null | undefined) => PlaceFacts | null {
  const { showToggle } = useLocation();
  const locationsQ = useLocations();
  const locations = locationsQ.data ?? [];
  return useCallback(
    (locationId) => (showToggle ? placeFor(locationId, locations) : null),
    // `locations` is a fresh array identity per render from `?? []`; keying on the
    // query's own data (stable while cached) keeps the callback stable too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showToggle, locationsQ.data],
  );
}
