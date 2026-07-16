// Polyfill Web Crypto (crypto.getRandomValues) for Hermes, which ships none.
// Must run before any code that calls @tpa/core's newId. Kept at the entry so
// @tpa/core itself stays pure/runtime-agnostic.
import 'react-native-get-random-values';

import { useFonts } from '@expo-google-fonts/inter';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { SessionProvider, useSession } from '../session/SessionProvider';
import { interFonts } from '../theme/fonts';

SplashScreen.preventAutoHideAsync();

/**
 * Route guard on the mock session: signed-out users are held in the (auth) group;
 * authed users are sent into the (tabs) app. Onboarding sub-steps navigate within
 * (auth) themselves. S8 swaps the session source; this guard is unchanged.
 */
function useAuthGuard() {
  const { isAuthed } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    const inAuth = segments[0] === '(auth)';
    if (!isAuthed && !inAuth) {
      router.replace('/(auth)/sign-in');
    } else if (isAuthed && inAuth) {
      router.replace('/(tabs)');
    }
  }, [isAuthed, segments, router]);
}

function RootNavigator() {
  useAuthGuard();
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

  useEffect(() => {
    if (fontsLoaded || fontError) {
      void SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <SessionProvider>
      <RootNavigator />
    </SessionProvider>
  );
}
