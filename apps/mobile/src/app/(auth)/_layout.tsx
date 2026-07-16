import { color } from '@tpa/theme';
import { Stack } from 'expo-router';

/** Auth / onboarding stack — all on the deep-navy surface. */
export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: color.bg.inverse },
      }}
    />
  );
}
