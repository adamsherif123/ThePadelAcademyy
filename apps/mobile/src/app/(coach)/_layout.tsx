import { Stack } from 'expo-router';

/**
 * The coach group's navigator — a STACK, with the tab bar as its first screen.
 *
 * This mirrors the player app exactly: app/_layout.tsx is a Stack whose first
 * screen is `(tabs)`, and every pushed detail (wallet, confirm-booking, coaches,
 * notifications) is a SIBLING of it. Sitting above the tab navigator rather than
 * inside it is what gives those screens the native push — slide in from the right,
 * swipe from the left edge to go back, and the tab bar covered while they're open.
 *
 * Session detail was previously registered inside the Tabs navigator and merely
 * hidden from the bar with `href: null`. That made opening it a TAB SWITCH: no
 * slide, no edge-swipe, and the tab bar stayed put underneath, because a tab
 * screen can never be above the bar that owns it.
 *
 * Nested one level down rather than hoisted to the root stack so the coach app
 * stays entirely inside `(coach)` — the routing fork in session/authMachine keys
 * on that first segment, and a coach never having a route out of their own group
 * is a property worth keeping.
 */
export default function CoachLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      {/* Default stack presentation: the native slide, with the back gesture on
          (React Navigation enables it for a card-presented stack screen on iOS —
          deliberately not overridden). Its own ScreenHeader carries the visible
          back affordance, and router.back() and the swipe pop the same screen. */}
      <Stack.Screen name="session/[id]" />
    </Stack>
  );
}
