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
 * Real admin auth (S10b) — phone OTP, mirroring the client (S8/S9). One auth method,
 * one identity model: the admin is a player row with is_admin = true. A verified user
 * who isn't an admin is REFUSED (status 'not_admin'), never signed in and never
 * trapped — App shows them why and offers sign-out. There is no complete_signup here.
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
  now: IsoInstant;
  phone: string | null;
  sendOtp: (phone: string) => Promise<{ ok: boolean; error?: string }>;
  verifyOtp: (code: string) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, '').replace(/^0+/, '');
  const local = digits.startsWith('20') ? digits : `20${digits}`;
  return `+${local}`;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [phone, setPhone] = useState<string | null>(null);
  const [now, setNow] = useState<IsoInstant>(() => toInstant(new Date()));

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
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
        return { ok: true };
      } catch (e) {
        return { ok: false, error: asMessage(e, 'Could not verify the code. Please try again.') };
      }
    },
    [phone],
  );

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // Ignore — force the local signed-out state below so no one is trapped.
    }
    setSession(null);
    setPhone(null);
    queryClient.clear();
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      isAuthed: status === 'ready',
      admin: player ? { name: player.name, role: 'Academy Admin' } : null,
      player,
      now,
      phone,
      sendOtp,
      verifyOtp,
      signOut,
    }),
    [status, player, now, phone, sendOtp, verifyOtp, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- provider module: the hook ships beside its provider, standard for a small context.
export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}
