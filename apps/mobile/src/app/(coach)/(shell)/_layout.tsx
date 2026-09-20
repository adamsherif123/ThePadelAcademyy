import Ionicons from '@expo/vector-icons/Ionicons';
import { fontSize } from '@tpa/theme';
import { Tabs } from 'expo-router';

import { fontFamilyForWeight } from '../../../theme/fonts';
import { useTheme } from '../../../theme/ThemeProvider';

/**
 * The coach app shell — the route group a linked coach (players.coach_id != null)
 * lands in instead of (tabs), decided by `nextRoute` in session/authMachine.
 *
 * Four tabs, and deliberately the SAME tab bar as the player app:
 * identical screenOptions to (tabs)/_layout, so a coach is in the academy's app
 * rather than a different-looking one. What is missing is the point — there is no
 * Book tab, because a coach account cannot book (the server refuses it outright,
 * migration 050).
 */
export default function CoachTabsLayout() {
  const { color } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.accent.default,
        tabBarInactiveTintColor: color.text.muted,
        tabBarStyle: {
          backgroundColor: color.bg.surface,
          borderTopColor: color.border.subtle,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: {
          fontFamily: fontFamilyForWeight.medium,
          fontSize: fontSize.caption,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color: c, size, focused }) => (
            <Ionicons name={focused ? 'grid' : 'grid-outline'} color={c} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: 'Schedule',
          tabBarIcon: ({ color: c, size, focused }) => (
            <Ionicons name={focused ? 'calendar' : 'calendar-outline'} color={c} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="hours"
        options={{
          title: 'Hours',
          tabBarIcon: ({ color: c, size, focused }) => (
            <Ionicons name={focused ? 'time' : 'time-outline'} color={c} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color: c, size, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} color={c} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
