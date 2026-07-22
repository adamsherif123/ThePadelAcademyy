import { toInstant } from '@tpa/core';
import type { Gender, IsoInstant, Level, Player } from '@tpa/types';
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

import {
  completeSignupRpc,
  deleteAccount as deleteAccountApi,
  deleteMyPushToken,
  fetchCurrentPlayer,
  fetchIsAdmin,
} from '../lib/api';
import { getLastPushToken, setLastPushToken } from '../notifications/tokenStore';
import { queryClient, queryKeys } from '../lib/queryClient';
import { supabase } from '../lib/supabase';
import { deriveStatus, type SessionStatus } from './authMachine';

export type { SessionStatus } from './authMachine';

/**
 * Real Supabase auth (S9 → A2). Consumer auth is EMAIL + PASSWORD now (phone OTP and
 * Twilio are gone): `session` comes from `signInWithPassword` / `signUp` (persisted in
 * AsyncStorage, auto-refreshed), and `player` is the signed-in player's row read through
 * RLS. The states are made explicit as `status`, because "verified but no profile yet" and
 * "verified but an ADMIN" are real places a user can land — routes, not errors:
 *
 *   signed_out    — no session          → (auth)/sign-in
 *   not_a_player  — an ADMIN credential  → (auth)/not-a-player (refused — bug #2)
 *   needs_profile — session, no player   → (auth)/profile-setup, run complete_signup
 *   ready         — session + player     → (tabs)
 *
 * `is_admin()` is queried alongside the player so an admin who signs into the players'
 * app is refused instead of bounced to profile-setup (the bug the A1 separation made
 * detectable). The non-auth screens still read only `player` / `now` / `signOut`.
 */
interface ProfileDraft {
  name: string;
  gender: Gender;
  level: Level;
  /** Optional (A2.1). The server normalises to +20 E.164 and rejects a duplicate. */
  phone?: string | null;
  /** Self-reported new-vs-returning (A5), passed through to complete_signup. */
  trainedBefore?: boolean | null;
}

interface SessionValue {
  status: SessionStatus;
  isAuthed: boolean;
  now: IsoInstant;
  /** The signed-in email (for the profile screen + the refusal message). null if none. */
  email: string | null;
  player: Player | null;
  /** Sign in a RETURNING user. Returns {ok:false,error} on bad credentials — never throws. */
  signInWithEmail: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  /** Create the auth user (GoTrue owns the password). `taken` when the email already exists. */
  signUpWithEmail: (
    email: string,
    password: string,
  ) => Promise<{ ok: boolean; error?: string; taken?: boolean }>;
  /** Create the player via complete_signup (A5: no credits at signup). */
  completeProfile: (draft: ProfileDraft) => Promise<{ ok: boolean; error?: string }>;
  /** Permanently delete the account (anonymise + drop the auth identity), then sign out. */
  deleteAccount: () => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  // `undefined` = still restoring from storage; `null` = restored, signed out.
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [now, setNow] = useState<IsoInstant>(() => toInstant(new Date()));

  // Restore the persisted session, then track every auth change (sign-in, sign-up,
  // refresh, sign-out) for the life of the app.
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      // A null session lands clean whatever the cause. supabase-js emits a signed-out
      // state not only on our signOut() but when a background token refresh is REJECTED
      // — a deleted/revoked auth user (the S9.2 class). deriveStatus then returns
      // signed_out (the guard routes to sign-in); clearing the cache here means an
      // auto-sign-out never leaves a previous player's reads behind for the next login.
      if (!next) queryClient.clear();
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Keep `now` current so expiry / cancel-window UI doesn't drift during a session.
  useEffect(() => {
    const id = setInterval(() => setNow(toInstant(new Date())), 30_000);
    return () => clearInterval(id);
  }, []);

  // The player row (RLS returns exactly the caller's own, or none) AND whether this auth
  // user is an admin. Both are gated on a session; on sign-out React Query drops them.
  const hasSession = Boolean(session);
  const playerQuery = useQuery({
    queryKey: queryKeys.player,
    queryFn: fetchCurrentPlayer,
    enabled: hasSession,
  });
  const adminQuery = useQuery({ queryKey: ['isAdmin'], queryFn: fetchIsAdmin, enabled: hasSession });
  const player = hasSession ? (playerQuery.data ?? null) : null;
  const isAdmin = hasSession ? Boolean(adminQuery.data) : false;

  const status: SessionStatus = deriveStatus({
    sessionRestored: session !== undefined,
    hasSession,
    gateLoading: playerQuery.isLoading || adminQuery.isLoading,
    isAdmin,
    player,
  });

  // Every seam below returns a result and NEVER throws — the same contract the SQL
  // RPCs honour ({ok, reason} as data). A transport/DB failure (offline, a raised
  // exception like the deleted-auth-user 23502) becomes {ok:false, error}, so a
  // screen's `if (res.ok)` handles it — it can't escape as an unhandled rejection
  // that freezes a submit button.
  const asMessage = (e: unknown, fallback: string): string =>
    e instanceof Error && e.message ? e.message : fallback;

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) return { ok: false, error: error.message };
      // onAuthStateChange flips `session`; the player + is_admin queries then decide
      // ready vs not_a_player. No navigation here — the guard routes on the status flip.
      return { ok: true };
    } catch (e) {
      return { ok: false, error: asMessage(e, 'Could not sign in. Please try again.') };
    }
  }, []);

  const signUpWithEmail = useCallback(async (email: string, password: string) => {
    try {
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
      if (error) return { ok: false, error: error.message };
      // With email confirmation OFF, signing up an EXISTING email returns an obfuscated
      // user with an empty identities array (GoTrue's anti-enumeration shape) and no
      // error. Treat that as "already registered" so the screen can send them to sign in.
      if (data.user && (data.user.identities?.length ?? 0) === 0) {
        return { ok: false, taken: true, error: 'That email already has an account.' };
      }
      // A session now exists (no confirmation step); the caller runs complete_signup next.
      return { ok: true };
    } catch (e) {
      return { ok: false, error: asMessage(e, 'Could not create your account. Please try again.') };
    }
  }, []);

  const completeProfile = useCallback(
    async (draft: ProfileDraft) => {
      try {
        const res = await completeSignupRpc(draft);
        if (!res.ok) return { ok: false, error: res.reason };
        const nowIso = toInstant(new Date());
        // SEED the player into the cache SYNCHRONOUSLY. This is the fix for the signup
        // bounce: `status` derives from this query, so writing it here flips status to
        // `ready` before the screen navigates — the guard then sees a ready user on the
        // exempt onboarding route instead of a needs_profile user it would replace back.
        // (createdAt/phone are placeholders reconciled by the invalidate below. A5: no
        // credits are minted at signup — a new player starts empty and buys a trial.)
        queryClient.setQueryData<Player>(queryKeys.player, {
          id: res.playerId as Player['id'],
          phone: null,
          email: session?.user.email ?? null,
          trainedBefore: draft.trainedBefore ?? null,
          name: draft.name,
          gender: draft.gender,
          level: draft.level,
          createdAt: nowIso,
        });
        // Reconcile the player to the server row.
        await queryClient.invalidateQueries({ queryKey: queryKeys.player });
        return { ok: true };
      } catch (e) {
        // e.g. the deleted-auth-user 23502 (a valid JWT whose auth.users row is gone).
        // The screen shows a friendly error + the sign-out escape rather than a crash.
        return { ok: false, error: asMessage(e, 'We couldn’t create your profile. Please try again.') };
      }
    },
    [session],
  );

  // Drop THIS device's push token while the session is still valid (own-only RLS
  // delete), so a signed-out phone stops getting this player's pushes and a deleted
  // account stops getting any — without touching another device's token.
  const dropThisDeviceToken = useCallback(async () => {
    const token = getLastPushToken();
    if (!token) return;
    setLastPushToken(null);
    await deleteMyPushToken(token).catch(() => undefined);
  }, []);

  const signOut = useCallback(async () => {
    // Before clearing the session (RLS still sees this player), unregister the token.
    await dropThisDeviceToken();
    try {
      // `local` scope clears the stored session without a server round-trip, so a
      // user holding a JWT for a deleted auth user can still get out (a server-side
      // logout could reject). This is the escape hatch for a stuck profile-setup.
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // Ignore — we force the local signed-out state below regardless.
    }
    setSession(null);
    // Drop every cached read so the next player starts clean.
    queryClient.clear();
  }, [dropThisDeviceToken]);

  const deleteAccount = useCallback(async () => {
    try {
      // Unregister this device's token FIRST, while the JWT is still valid — after the
      // account is deleted the token delete (RLS) would have no session to authorise.
      await dropThisDeviceToken();
      // DB anonymise-and-detach + auth-user delete, both server-side. Only on success
      // do we tear down the local session — so a failure leaves the user signed in to
      // retry, never stranded. The auth identity is gone now, but signOut uses
      // scope:'local' (S9.2), so it never calls the server with the dead token.
      await deleteAccountApi();
      await signOut();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: asMessage(e, 'We couldn’t delete your account. Please try again.') };
    }
  }, [signOut, dropThisDeviceToken]);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      isAuthed: status === 'ready',
      now,
      email: session?.user.email ?? null,
      player,
      signInWithEmail,
      signUpWithEmail,
      completeProfile,
      deleteAccount,
      signOut,
    }),
    [status, now, session, player, signInWithEmail, signUpWithEmail, completeProfile, deleteAccount, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}
