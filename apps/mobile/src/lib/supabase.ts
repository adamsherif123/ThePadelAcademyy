// The Supabase client — the app's single connection to the backend.
//
// React Native has no `localStorage` and no WHATWG URL, so two things must be in
// place before createClient: the URL polyfill (imported for its side effect) and
// an AsyncStorage-backed session store. With persistSession + autoRefreshToken the
// JWT survives app restarts and is refreshed before it expires; AppState gates the
// refresh loop so we only poll while the app is foregrounded (Supabase RN guide).
//
// Both keys are PUBLIC by design: they ship in the binary and are protected by
// Row-Level Security, not secrecy. The service_role key is a server secret and is
// never imported here or anywhere in the app.
import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import { CLIENT_HEADER } from './clientVersion';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // A misconfigured .env is a build-time mistake, not a runtime state to render —
  // fail loudly at startup rather than sending requests to `undefined`.
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. Copy apps/mobile/.env.example to apps/mobile/.env and fill it in.',
  );
}

// Sent on EVERY request, including anon ones: the HardUpdateGate reads app_config
// before sign-in, and the location-aware RLS policies key off this header for
// anon reads of session_slots and packages too. Set at the client so no call site
// can forget it — a forgotten header is silently "show me only Oro Plaza", which
// is the kind of bug that looks like missing data rather than a missing header.
const clientHeader = CLIENT_HEADER;

export const supabase = createClient(url, anonKey, {
  ...(clientHeader ? { global: { headers: { 'x-tpa-client': clientHeader } } } : {}),
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // No deep-link callback in this app — sessions come from OTP verify, not a URL.
    detectSessionInUrl: false,
  },
});

// Only refresh tokens while the app is in the foreground; stop when backgrounded.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    void supabase.auth.startAutoRefresh();
  } else {
    void supabase.auth.stopAutoRefresh();
  }
});
