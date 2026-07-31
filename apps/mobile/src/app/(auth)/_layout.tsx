import { Stack } from 'expo-router';

import { useTheme } from '../../theme/ThemeProvider';

/** Auth / onboarding stack — all on the deep-navy surface. */
export default function AuthLayout() {
  const { color } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: color.bg.inverse },
      }}
    />
  );
}
