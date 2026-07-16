import { MOCK_NOW } from '@tpa/mocks';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Mock admin session. A tiny React context, right-sized for one small object (the
 * signed-in admin) read in a few places — same posture as the mobile app. `now` is
 * pinned to MOCK_NOW so the admin and client render the same coherent world.
 *
 * S8 replaces `signIn`'s body with real admin auth (Supabase); the provider's
 * SHAPE is the seam, so nothing above this hook changes.
 */
export interface AdminUser {
  name: string;
  role: string;
  email: string;
}

const MOCK_ADMIN: AdminUser = {
  name: 'Rania Adham',
  role: 'Academy Owner',
  email: 'rania@thepadelacademy.eg',
};

interface SessionValue {
  isAuthed: boolean;
  admin: AdminUser | null;
  now: typeof MOCK_NOW;
  /** Mock gate: any non-empty email + password signs in. Returns ok. */
  signIn: (email: string, password: string) => boolean;
  signOut: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminUser | null>(null);

  const value = useMemo<SessionValue>(
    () => ({
      isAuthed: admin !== null,
      admin,
      now: MOCK_NOW,
      signIn: (email, password) => {
        if (email.trim() === '' || password.trim() === '') return false;
        setAdmin(MOCK_ADMIN);
        return true;
      },
      signOut: () => setAdmin(null),
    }),
    [admin],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- provider module: the hook ships beside its provider, standard for a small context.
export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}
