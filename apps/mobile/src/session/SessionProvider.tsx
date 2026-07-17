import { buildSignupGrant, toInstant } from '@tpa/core';
import type { CreditBatch, Gender, IsoInstant, Level, Player } from '@tpa/types';
import type { Session } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { completeSignupRpc, fetchCurrentPlayer } from '../lib/api';
import { queryClient, queryKeys } from '../lib/queryClient';
import { supabase } from '../lib/supabase';
import { resetMockOverlay } from '../data/mockPayments';
import { deriveStatus, type SessionStatus } from './authMachine';

export type { SessionStatus } from './authMachine';

/**
 * Real Supabase auth (S9). The mock context is gone: `session` comes from the
 * auth client (persisted in AsyncStorage, auto-refreshed), and `player` is the
 * signed-in player's row read through RLS. The three meaningful states are made
 * explicit as `status`, because "verified but no profile yet" is a real place a
 * user can be — a route, not an error:
 *
 *   signed_out    — no session          → (auth)/sign-in
 *   needs_profile — session, no player   → (auth)/profile-setup, run complete_signup
 *   ready         — session + player     → (tabs)
 *
 * The non-auth screens still read only `player` / `now` / `signOut`, so swapping
 * the internals here left them untouched. `now` is the real clock, refreshed on an
 * interval so expiry countdowns and the 3-hour cancel window stay honest.
 */
interface ProfileDraft {
  name: string;
  gender: Gender;
  level: Level;
}

interface SessionValue {
  status: SessionStatus;
  isAuthed: boolean;
  now: IsoInstant;
  phone: string | null;
  player: Player | null;
  trialGrant: CreditBatch | null;
  /** Send an OTP to `phone`. Returns an error message on transport failure. */
  sendOtp: (phone: string) => Promise<{ ok: boolean; error?: string }>;
  /** Verify the SMS code, establishing a session. */
  verifyOtp: (code: string) => Promise<{ ok: boolean; error?: string }>;
  /** Create the player + trial grant via complete_signup. */
  completeProfile: (draft: ProfileDraft) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

/** Digits only, always +20 E.164 — matches how the DB stores phone + the test_otp keys. */
function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, '').replace(/^0+/, '');
  const local = digits.startsWith('20') ? digits : `20${digits}`;
  return `+${local}`;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  // `undefined` = still restoring from storage; `null` = restored, signed out.
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [phone, setPhone] = useState<string | null>(null);
  const [trialGrant, setTrialGrant] = useState<CreditBatch | null>(null);
  const [now, setNow] = useState<IsoInstant>(() => toInstant(new Date()));

  // Restore the persisted session, then track every auth change (verify, refresh,
  // sign-out) for the life of the app.
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Keep `now` current so expiry / cancel-window UI doesn't drift during a session.
  useEffect(() => {
    const id = setInterval(() => setNow(toInstant(new Date())), 30_000);
    return () => clearInterval(id);
  }, []);

  // The player row (RLS returns exactly the caller's own, or none). Only queried
  // once a session exists; on sign-out React Query drops it.
  const hasSession = Boolean(session);
  const playerQuery = useQuery({
    queryKey: queryKeys.player,
    queryFn: fetchCurrentPlayer,
    enabled: hasSession,
  });
  const player = hasSession ? (playerQuery.data ?? null) : null;

  const status: SessionStatus = deriveStatus({
    sessionRestored: session !== undefined,
    hasSession,
    playerLoading: playerQuery.isLoading,
    player,
  });

  // Every seam below returns a result and NEVER throws — the same contract the SQL
  // RPCs honour ({ok, reason} as data). A transport/DB failure (offline, a raised
  // exception like the deleted-auth-user 23502) becomes {ok:false, error}, so a
  // screen's `if (res.ok)` handles it — it can't escape as an unhandled rejection
  // that freezes a submit button.
  const asMessage = (e: unknown, fallback: string): string =>
    e instanceof Error && e.message ? e.message : fallback;

  const sendOtp = useCallback(async (input: string) => {
    const e164 = normalizePhone(input);
    setPhone(e164);
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone: e164 });
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: asMessage(e, 'Could not send the code. Please try again.') };
    }
  }, []);

  const verifyOtp = useCallback(
    async (code: string) => {
      if (!phone) return { ok: false, error: 'No phone number to verify.' };
      try {
        const { error } = await supabase.auth.verifyOtp({ phone, token: code, type: 'sms' });
        if (error) return { ok: false, error: error.message };
        // onAuthStateChange will flip `session`; the player query then decides
        // needs_profile vs ready.
        return { ok: true };
      } catch (e) {
        return { ok: false, error: asMessage(e, 'Could not verify the code. Please try again.') };
      }
    },
    [phone],
  );

  const completeProfile = useCallback(
    async (draft: ProfileDraft) => {
      try {
        const res = await completeSignupRpc(draft);
        if (!res.ok) return { ok: false, error: res.reason };
        const nowIso = toInstant(new Date());
        // Show the trial grant we know the server just minted (same @tpa/core rule).
        setTrialGrant(buildSignupGrant(res.playerId as Player['id'], nowIso));
        // SEED the player into the cache SYNCHRONOUSLY. This is the fix for the signup
        // bounce: `status` derives from this query, so writing it here flips status to
        // `ready` before profile-setup navigates — the guard then sees a ready user on
        // the trial-grant route (which it exempts) instead of a needs_profile user it
        // would replace back. No refetch round-trip, so there is no window to lose the
        // race in. (createdAt is a placeholder — unused in the UI — and the invalidate
        // below reconciles the whole row to server truth a moment later.)
        const e164 = phone ?? (session?.user.phone ? `+${session.user.phone}` : '');
        queryClient.setQueryData<Player>(queryKeys.player, {
          id: res.playerId as Player['id'],
          phone: e164,
          name: draft.name,
          gender: draft.gender,
          level: draft.level,
          createdAt: nowIso,
        });
        // Reconcile the player to the server row + surface the freshly minted credits.
        await queryClient.invalidateQueries({ queryKey: queryKeys.player });
        await queryClient.invalidateQueries({ queryKey: queryKeys.creditBatches });
        return { ok: true };
      } catch (e) {
        // e.g. the deleted-auth-user 23502 (a valid JWT whose auth.users row is gone).
        // The screen shows a friendly error + the sign-out escape rather than a crash.
        return { ok: false, error: asMessage(e, 'We couldn’t create your profile. Please try again.') };
      }
    },
    [phone, session],
  );

  const signOut = useCallback(async () => {
    try {
      // `local` scope clears the stored session without a server round-trip, so a
      // user holding a JWT for a deleted auth user can still get out (a server-side
      // logout could reject). This is the escape hatch for a stuck profile-setup.
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // Ignore — we force the local signed-out state below regardless.
    }
    setSession(null);
    setPhone(null);
    setTrialGrant(null);
    // Drop every cached read + the mock-purchase overlay so the next player starts clean.
    resetMockOverlay();
    queryClient.clear();
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      isAuthed: status === 'ready',
      now,
      phone,
      player,
      trialGrant,
      sendOtp,
      verifyOtp,
      completeProfile,
      signOut,
    }),
    [status, now, phone, player, trialGrant, sendOtp, verifyOtp, completeProfile, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}
