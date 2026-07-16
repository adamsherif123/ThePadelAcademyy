import Ionicons from '@expo/vector-icons/Ionicons';
import { color, fontSize } from '@tpa/theme';
import { Tabs } from 'expo-router';

import { fontFamilyForWeight } from '../../theme/fonts';

/**
 * The four-tab app shell. No native headers — each screen's ScreenHeader (the
 * periwinkle eyebrow + display title) is the heading. The tab bar is branded from
 * tokens: royal active, muted inactive, white surface, a hairline top border,
 * Inter labels. Icons switch to their filled variant when focused.
 */
export default function TabsLayout() {
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
          title: 'Home',
          tabBarIcon: ({ color: c, size, focused }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} color={c} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="book"
        options={{
          title: 'Book',
          tabBarIcon: ({ color: c, size, focused }) => (
            <Ionicons name={focused ? 'calendar' : 'calendar-outline'} color={c} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="sessions"
        options={{
          title: 'Sessions',
          tabBarIcon: ({ color: c, size, focused }) => (
            <Ionicons name={focused ? 'list' : 'list-outline'} color={c} size={size} />
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
