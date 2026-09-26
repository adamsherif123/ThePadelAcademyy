import type { Location, LocationId } from '@tpa/types';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

import { defaultLocation } from './locations';

/** Active branches, in the order the admin list and the picker show them. */
export function activeLocations(locations: readonly Location[]): Location[] {
  return locations.filter((l) => l.isActive).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/**
 * Which branch a `?loc=` value actually resolves to — the whole fallback rule,
 * as a pure function.
 *
 * Extracted from the hook because the hook needs a Router to run and this repo
 * has no component-test harness (vitest runs under `node`); anything left inside
 * the hook is untested by construction. Everything decidable from (locations,
 * raw) is decided here, leaving the hook with only the URL plumbing.
 */
export function resolveSelectedLocation(locations: readonly Location[], raw: string | null): Location | null {
  const options = activeLocations(locations);
  // An INACTIVE branch named in the URL is not honoured — a closed branch is
  // exactly what must not be scheduled into — nor is an id that does not exist.
  const named = options.find((l) => l.id === raw) ?? null;
  return named ?? defaultLocation(locations) ?? options[0] ?? null;
}

export interface SelectedLocation {
  /** Never null once locations have loaded — the default branch is the floor. */
  id: LocationId | null;
  location: Location | null;
  /** What the picker lists. */
  options: Location[];
  select: (id: LocationId) => void;
}

/**
 * Which branch the Schedule is showing, held in the URL as `?loc=<id>`.
 *
 * The URL rather than a context, for three reasons: the owner links people to a
 * week and the link should carry the branch; a reload must land on the same
 * branch rather than snapping back; and a context would be a second source of
 * truth that the browser's back button could desync.
 *
 * ── the fallback is deliberately narrow ──
 * A missing, unknown, or INACTIVE `loc` resolves to the default branch. Inactive
 * matters: a branch can be closed while an old tab or a bookmarked link still
 * names it, and scheduling into a closed branch is exactly what deactivation
 * exists to prevent. Resolving rather than erroring keeps a stale link useful.
 *
 * When the resolved id differs from what the URL says, the URL is rewritten with
 * `replace` so the bad value does not sit in history for the back button to
 * return to — and so what the admin copies out of the address bar is the branch
 * they are actually looking at.
 */
export function useSelectedLocation(locations: readonly Location[]): SelectedLocation {
  const [params, setParams] = useSearchParams();
  const raw = params.get('loc');

  const options = activeLocations(locations);
  const resolved = resolveSelectedLocation(locations, raw);

  // Rewrite only when the URL disagrees with what is actually being shown.
  // Effect, not render: setSearchParams during render would be a side effect in
  // the render phase, and React would warn about updating during render.
  useEffect(() => {
    if (!resolved) return; // locations still loading — leave the URL alone
    if (raw === resolved.id) return;
    const next = new URLSearchParams(params);
    next.set('loc', resolved.id);
    setParams(next, { replace: true });
  }, [raw, resolved, params, setParams]);

  return {
    id: resolved?.id ?? null,
    location: resolved,
    options,
    select: (id: LocationId) => {
      const next = new URLSearchParams(params);
      next.set('loc', id);
      // NOT replace: switching branch is a navigation the admin may want to undo
      // with the back button.
      setParams(next);
    },
  };
}
