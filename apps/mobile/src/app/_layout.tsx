// Polyfill Web Crypto (crypto.getRandomValues) for Hermes, which ships none.
// Must run before any code that calls @tpa/core's newId. Kept at the entry so
// @tpa/core itself stays pure/runtime-agnostic.
import 'react-native-get-random-values';

import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}
