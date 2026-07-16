import { buildSignupGrant } from '@tpa/core';
import { MOCK_NOW, mockCurrentPlayer } from '@tpa/mocks';
import type { CreditBatch, Gender, Level, Player } from '@tpa/types';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Mock session state. Deliberately a tiny React Context, not a state-management
 * library: the whole app needs exactly one small, mostly-static object (the
 * signed-in player + onboarding progress) read in a handful of places. Context is
 * the right-sized tool; adding Redux/Zustand here would be ceremony.
 *
 * S8 swaps this provider's internals for real Supabase auth, and S9 swaps the
 * data selectors (src/data/*) for real queries. The screens depend only on this
 * hook's shape, so neither swap touches screen code.
 *
 * `now` is fixed to MOCK_NOW so every screen's dates/expiry line up with the
 * @tpa/mocks fixtures; S9 replaces it with the real clock.
 */
interface ProfileDraft {
  name: string;
  gender: Gender;
  level: Level;
}

interface SessionValue {
  isAuthed: boolean;
  now: typeof MOCK_NOW;
  phone: string | null;
  player: Player | null;
  /** The signup trial grant, built via @tpa/core once the profile is created. */
  trialGrant: CreditBatch | null;
  setPhone: (phone: string) => void;
  completeProfile: (draft: ProfileDraft) => void;
  finishOnboarding: () => void;
  signOut: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [isAuthed, setIsAuthed] = useState(false);
  const [phone, setPhoneState] = useState<string | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [trialGrant, setTrialGrant] = useState<CreditBatch | null>(null);

  const value = useMemo<SessionValue>(
    () => ({
      isAuthed,
      now: MOCK_NOW,
      phone,
      player,
      trialGrant,
      setPhone: (p) => setPhoneState(p),
      completeProfile: (draft) => {
        // Reuse the mock player's id so the wallet/session fixtures resolve; the
        // profile fields the user just entered override name/gender/level.
        const next: Player = { ...mockCurrentPlayer, ...draft };
        setPlayer(next);
        setTrialGrant(buildSignupGrant(next.id, MOCK_NOW));
      },
      finishOnboarding: () => setIsAuthed(true),
      signOut: () => {
        setIsAuthed(false);
        setPhoneState(null);
        setPlayer(null);
        setTrialGrant(null);
      },
    }),
    [isAuthed, phone, player, trialGrant],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}
