// Polyfill Web Crypto (crypto.getRandomValues) for Hermes, which ships none.
// Must run before any code that calls @tpa/core's newId. Kept at the entry so
// @tpa/core itself stays pure/runtime-agnostic.
import 'react-native-get-random-values';

import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { queryClient } from '../lib/queryClient';
import { SessionProvider, useSession } from '../session/SessionProvider';
import { interFonts } from '../theme/fonts';

SplashScreen.preventAutoHideAsync();

/**
 * Route guard over the real auth state machine. Three destinations, one per status:
 * signed-out → sign-in; a verified user without a profile → profile-setup; a fully
 * onboarded user → the tabs. The onboarding sub-steps (otp, profile-setup, then the
 * trial-grant celebration) all live in (auth) yet run AFTER a session exists, so a
 * `ready` user is only bounced out of (auth) once they've left those steps behind.
 */
function useAuthGuard() {
  const { status } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;
    const inAuth = segments[0] === '(auth)';
    const step = segments[1];

    if (status === 'signed_out') {
      if (!inAuth) router.replace('/(auth)/sign-in');
    } else if (status === 'needs_profile') {
      // Verified but no player yet — always land on profile-setup (this is what
      // carries a new user off the OTP screen once the session appears).
      if (step !== 'profile-setup') router.replace('/(auth)/profile-setup');
    } else if (status === 'ready') {
      // Onboarding just finished — allow the celebration + the setup screen it
      // was pushed from; everything else in (auth) means "you're already in".
      if (inAuth && step !== 'trial-grant' && step !== 'profile-setup') {
        router.replace('/(tabs)');
      }
    }
  }, [status, segments, router]);
}

function RootNavigator() {
  const { status } = useSession();
  useAuthGuard();

  // Hold the splash until the persisted session is restored, so no signed-in user
  // ever flashes the sign-in screen on a cold start.
  useEffect(() => {
    if (status !== 'loading') void SplashScreen.hideAsync();
  }, [status]);

  if (status === 'loading') return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="wallet" />
      <Stack.Screen name="buy-credits" />
      <Stack.Screen name="package/[id]" />
      <Stack.Screen name="checkout" />
      <Stack.Screen name="purchase-success" />
      <Stack.Screen name="confirm-booking" />
      <Stack.Screen name="booked-success" />
      <Stack.Screen name="cancel-booking" options={{ presentation: 'modal' }} />
      <Stack.Screen name="coaches" />
      <Stack.Screen name="purchase-history" />
      <Stack.Screen name="gallery" options={{ headerShown: true, title: 'Gallery (dev)', presentation: 'modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(interFonts);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <RootNavigator />
      </SessionProvider>
    </QueryClientProvider>
  );
}
