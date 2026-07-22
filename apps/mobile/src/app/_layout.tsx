// Polyfill Web Crypto (crypto.getRandomValues) for Hermes, which ships none.
// Must run before any code that calls @tpa/core's newId. Kept at the entry so
// @tpa/core itself stays pure/runtime-agnostic.
import 'react-native-get-random-values';

import { space } from '@tpa/theme';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { queryClient } from '../lib/queryClient';
import { captureException, initReporting } from '../lib/reporting';
import { NotificationsBridge } from '../notifications/NotificationsBridge';
import { nextRoute } from '../session/authMachine';
import { SessionProvider, useSession } from '../session/SessionProvider';
import { interFonts } from '../theme/fonts';
import { Button, Screen, Text } from '../ui';

SplashScreen.preventAutoHideAsync();

/**
 * Root render-error screen (Expo Router picks up this named export). A rendering error
 * anywhere in the tree shows this recoverable screen instead of a dead white app, and
 * reports to Sentry. (It cannot catch a module-eval throw — that class is fixed
 * structurally — but it catches every render error below it.)
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    captureException(error, { boundary: 'root' });
  }, [error]);
  return (
    <Screen style={styles.errorScreen}>
      <View style={styles.errorBody}>
        <Text variant="h2">Something went wrong</Text>
        <Text variant="body" tone="secondary">
          The app hit an unexpected error. Please try again.
        </Text>
      </View>
      <Button label="Try again" onPress={() => void retry()} />
    </Screen>
  );
}

/**
 * Route guard — a thin shell over the pure `nextRoute` state machine (unit-tested in
 * session/authMachine.test.ts). It maps (status, current route) to a redirect: an
 * expression the guard just executes, so the routing rules can be tested without a
 * device.
 */
function useAuthGuard() {
  const { status } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    const target = nextRoute(status, segments[0], segments[1]);
    if (target) router.replace(target as never);
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
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="wallet" />
        <Stack.Screen name="buy-credits" />
        <Stack.Screen name="package/[id]" />
        <Stack.Screen name="request-credits" />
        <Stack.Screen name="checkout" />
        <Stack.Screen name="purchase-success" />
        <Stack.Screen name="confirm-booking" />
        <Stack.Screen name="booked-success" />
        <Stack.Screen name="cancel-booking" options={{ presentation: 'modal' }} />
        <Stack.Screen name="coaches" />
        <Stack.Screen name="purchase-history" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="delete-account" />
        <Stack.Screen name="gallery" options={{ headerShown: true, title: 'Gallery (dev)', presentation: 'modal' }} />
      </Stack>
      {/* Registers the push token, keeps the feed live, and routes tapped pushes
          (incl. cold start). No-ops until a player is ready; renders nothing. */}
      <NotificationsBridge />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(interFonts);

  // Start crash reporting once, early. No-op without a DSN / in dev; never throws.
  useEffect(() => {
    void initReporting();
  }, []);

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

const styles = StyleSheet.create({
  errorScreen: { flexGrow: 1, justifyContent: 'center', gap: space.xl, padding: space.xl },
  errorBody: { gap: space.sm, alignItems: 'center' },
});
