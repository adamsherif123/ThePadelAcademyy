import { createClient } from '@supabase/supabase-js';

/**
 * The admin's single Supabase connection. Same client the mobile app uses, minus
 * the React Native plumbing: the browser has localStorage (supabase-js persists the
 * session there by default) and a real URL, so no AsyncStorage adapter or URL
 * polyfill is needed. persistSession + autoRefreshToken keep the admin signed in
 * across reloads and refresh the JWT before it lapses.
 *
 * Both keys are PUBLIC by design — they ship in the bundle and are protected by
 * Row-Level Security, not secrecy. The service_role key is never imported here or
 * anywhere in apps/admin.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy apps/admin/.env.example to apps/admin/.env and fill it in.',
  );
}

export const supabase = createClient(url, anonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
