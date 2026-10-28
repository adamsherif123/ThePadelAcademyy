import type { Location, LocationId } from '@tpa/types';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useLocations } from '../data/queries';
import { useSession } from '../session/SessionProvider';
import {
  readSelectedLocation,
  resolveSelectedLocation,
  shouldShowToggle,
  toggleOptions,
  writeSelectedLocation,
} from './selectedLocation';

interface LocationState {
  /** The branch everything location-scoped is showing. Null only before locations load. */
  selected: Location | null;
  /** Convenience: `selected?.id ?? null`. Safe to put straight into a query key. */
  selectedId: LocationId | null;
  /** Active branches, in toggle order. */
  options: Location[];
  /** Whether the toggle should render at all — false while there is only one branch. */
  showToggle: boolean;
  /** True until the stored choice has been read; screens wait so they don't flash the wrong branch. */
  isLoading: boolean;
  select: (id: LocationId) => void;
}

const LocationContext = createContext<LocationState | null>(null);

/**
 * Which branch the player is looking at.
 *
 * ── it lives INSIDE SessionProvider, on purpose ──
 * `locations` grants SELECT to `authenticated` only — anon cannot read it. So the
 * branch list is not available before sign-in, and this provider is mounted below
 * the session. Signed-out screens (sign-in, the HardUpdateGate) never need it:
 * the gate reads app_config, which anon CAN read, and it still sends the
 * x-tpa-client header because that is set on the client itself.
 *
 * ── the selection is resolved, never trusted ──
 * The stored id is a hint. What the player actually sees is
 * resolveSelectedLocation's answer, which re-checks it against the branches that
 * exist and are open right now — so a branch closing while the app was shut
 * degrades to the default instead of opening on an empty screen.
 */
export function LocationProvider({ children }: { children: ReactNode }) {
  // Tied to the session, deliberately. This provider mounts once, above the
  // navigator, and lives through every sign-in and sign-out. Unkeyed, its
  // locations query fired at launch even when signed out — anon cannot read
  // `locations`, so it failed — and then SessionProvider's queryClient.clear()
  // (which runs on the launch-time null session too) removed that query from the
  // cache. Nothing re-rendered this provider afterwards, so its observer could
  // stay attached to the removed query forever: after sign-in every screen
  // fetched the branches into a NEW query this provider never saw, and the app
  // ran with zero locations — no toggle, no selected branch, packages and credits
  // filtered by a null branch — until the process was killed.
  //
  // Reading the session makes this provider re-render on every auth change, and
  // a re-render re-binds the observer to whatever `locations` query the cache
  // holds now. `enabled` keeps the doomed anon request from being made at all.
  const { isAuthed } = useSession();
  const locationsQ = useLocations({ enabled: isAuthed });
  const [stored, setStored] = useState<LocationId | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void readSelectedLocation().then((v) => {
      if (!cancelled) setStored(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const locations = useMemo(() => locationsQ.data ?? [], [locationsQ.data]);
  // `stored === undefined` means the read hasn't finished; treat it as "nothing
  // stored" for resolution but keep isLoading true so screens can wait.
  const selected = resolveSelectedLocation(locations, stored ?? null);

  const select = useCallback((id: LocationId) => {
    setStored(id);
    void writeSelectedLocation(id);
  }, []);

  const value = useMemo<LocationState>(
    () => ({
      selected,
      selectedId: selected?.id ?? null,
      options: toggleOptions(locations),
      showToggle: shouldShowToggle(locations),
      isLoading: stored === undefined || locationsQ.isPending,
      select,
    }),
    [selected, locations, stored, locationsQ.isPending, select],
  );

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

/**
 * The selected branch.
 *
 * Returns a safe empty state rather than throwing when used outside the provider,
 * so a screen that is reachable both inside and outside the session (a modal
 * pushed from the coach shell, say) does not crash — it just behaves as if there
 * were one branch.
 */
export function useLocation(): LocationState {
  return (
    useContext(LocationContext) ?? {
      selected: null,
      selectedId: null,
      options: [],
      showToggle: false,
      isLoading: false,
      select: () => {},
    }
  );
}
