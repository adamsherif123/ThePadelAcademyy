import { THEME_PACKAGE_NAME } from '@tpa/theme';
import { TYPES_PACKAGE_NAME, type PlaceholderId } from '@tpa/types';
import { Stack } from 'expo-router';

// S0 shared-code proof: if Metro could not resolve the workspace packages,
// this bundle would fail outright. Logged so it is visible in the Expo terminal.
const proofId: PlaceholderId = 'shared-code-proof';
console.log(`[${proofId}] mobile can import ${TYPES_PACKAGE_NAME} and ${THEME_PACKAGE_NAME}`);

export default function RootLayout() {
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}
