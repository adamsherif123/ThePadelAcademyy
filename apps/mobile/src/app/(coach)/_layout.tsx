import { Stack } from 'expo-router';

/**
 * The coach app shell — the route group a linked coach (players.coach_id != null)
 * lands in instead of (tabs), decided by `nextRoute` in session/authMachine.
 *
 * PHASE 1: a single placeholder screen. The real coach app — schedule, hours
 * coached, session rosters — is phase 3, and the data access it needs (a coach
 * reading their own sessions' rosters) is phase 2. A plain Stack rather than Tabs
 * for exactly that reason: there is one screen to show, and choosing the tab set
 * belongs with the screens that fill it.
 */
export default function CoachLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
