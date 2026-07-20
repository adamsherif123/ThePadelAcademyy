import { toInstant } from '@tpa/core';
import type { IsoInstant, Player } from '@tpa/types';
import type { Session } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { fetchCurrentPlayer, fetchIsAdmin } from '../lib/api';
import { queryClient, queryKeys } from '../lib/queryClient';
import { supabase } from '../lib/supabase';
import { deriveStatus, type AdminStatus } from './authMachine';

export type { AdminStatus } from './authMachine';

/**
 * Real admin auth (S10b.1) — EMAIL + PASSWORD (`signInWithPassword`). The client uses
 * phone OTP; the admin does not want it. Crucially this is still ONE auth user, two
 * sign-in methods: the academy attaches an email+password credential to the admin's
 * existing phone auth user out-of-band (see the handoff), so `auth.uid()` is the same
 * identity that owns the player row — is_admin(), every RLS policy, and every RPC are
 * untouched, zero schema change. A signed-in user who isn't an admin is REFUSED
 * (status 'not_admin'), never trapped — App shows them why and offers sign-out. No
 * password reset in-app: for a single admin, "reset it in the dashboard" is the
 * honest answer (S8 rejected email because reset needs SMTP; that holds for a
 * hundred users, not one).
 */
export interface AdminUser {
  name: string;
  role: string;
}

interface SessionValue {
  status: AdminStatus;
  isAuthed: boolean;
  admin: AdminUser | null;
  /** The signed-in player, whether or not they're an admin (for the refusal message). */
  player: Player | null;
  /** The signed-in email, if any (for the refusal message). */
  email: string | null;
  now: IsoInstant;
  signInWithEmail: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [now, setNow] = useState<IsoInstant>(() => toInstant(new Date()));

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      // A rejected token refresh (deleted/revoked admin auth user) surfaces as a null
      // session here too — drop to signed_out cleanly and clear cached reads, so it
      // self-heals to the login screen rather than trapping on an errored view.
      if (!next) queryClient.clear();
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // The dashboard buckets by Cairo month/week, so keep `now` fresh across a long session.
  useEffect(() => {
    const id = setInterval(() => setNow(toInstant(new Date())), 60_000);
    return () => clearInterval(id);
  }, []);

  const hasSession = Boolean(session);
  const playerQuery = useQuery({ queryKey: queryKeys.player, queryFn: fetchCurrentPlayer, enabled: hasSession });
  const adminQuery = useQuery({ queryKey: ['isAdmin'], queryFn: fetchIsAdmin, enabled: hasSession });
  const player = hasSession ? (playerQuery.data ?? null) : null;
  const isAdmin = hasSession ? Boolean(adminQuery.data) : false;

  const status = deriveStatus({
    sessionRestored: session !== undefined,
    hasSession,
    gateLoading: playerQuery.isLoading || adminQuery.isLoading,
    isAdmin,
    player,
  });

  const asMessage = (e: unknown, fallback: string): string =>
    e instanceof Error && e.message ? e.message : fallback;

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) return { ok: false, error: error.message };
      // onAuthStateChange flips `session`; the player + is_admin queries then decide
      // ready vs not_admin. No navigation here — App renders on the status flip.
      return { ok: true };
    } catch (e) {
      return { ok: false, error: asMessage(e, 'Could not sign in. Please try again.') };
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // Ignore — force the local signed-out state below so no one is trapped.
    }
    setSession(null);
    queryClient.clear();
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      isAuthed: status === 'ready',
      admin: player ? { name: player.name, role: 'Academy Admin' } : null,
      player,
      email: session?.user.email ?? null,
      now,
      signInWithEmail,
      signOut,
    }),
    [status, player, session, now, signInWithEmail, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- provider module: the hook ships beside its provider, standard for a small context.
export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}
