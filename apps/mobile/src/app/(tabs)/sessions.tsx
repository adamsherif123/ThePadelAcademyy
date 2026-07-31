import { cancellationDeadline, isCancellableWithoutForfeit } from '@tpa/core';
import { space } from '@tpa/theme';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { TabView } from 'react-native-tab-view';

import { pastSessions, upcomingSessions } from '../../data/booking';
import { useBookings, useCoaches, useSlots, combine } from '../../data/queries';
import { useSession } from '../../session/SessionProvider';
import {
  BookingCard,
  EmptyState,
  ErrorView,
  LoadingView,
  Screen,
  ScreenHeader,
  SegmentedControl,
} from '../../ui';

type Tab = 'upcoming' | 'past';
const TABS: readonly { value: Tab; label: string }[] = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
];

/** A react-native-tab-view Route is just { key, title }; Tab IS the key. */
type TabRoute = { key: Tab; title: string };
const ROUTES: TabRoute[] = TABS.map((t) => ({ key: t.value, title: t.label }));

/**
 * 14 — Sessions. The player's booked court time: upcoming (cancellable) and past.
 *
 * Swipeable via react-native-tab-view (already a peer of the reanimated +
 * gesture-handler this app already ships) instead of a hand-rolled gesture —
 * it owns the horizontal pan, each page below owns its own vertical scroll, so
 * the two never fight. The existing <SegmentedControl> becomes the tab view's
 * OWN tab bar via `renderTabBar` (same visual design, zero redesign): tapping
 * it calls `jumpTo`, swiping calls `onIndexChange` — both paths update the
 * SAME `index` state, so there is no separate sync logic to keep straight,
 * only one shared source of truth. Neither page is unmounted when you swipe
 * away, so each ScrollView's scroll position survives a round trip.
 *
 * The upcoming/past split, the data hooks, and BookingCard are byte-identical
 * to before — only the container around the two lists changed.
 */
export default function SessionsScreen() {
  const router = useRouter();
  const { player, now } = useSession();
  const bookings = useBookings();
  const slots = useSlots();
  const coaches = useCoaches();
  const gate = combine(bookings, slots, coaches);
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  if (!player) return null;

  if (gate.isPending || gate.isError) {
    return (
      <Screen scroll tabBar contentContainerStyle={styles.content}>
        <ScreenHeader eyebrow="Your court time" title="Sessions" />
        {gate.isPending ? <LoadingView /> : <ErrorView onRetry={gate.refetch} />}
      </Screen>
    );
  }

  const upcoming = upcomingSessions(bookings.data ?? [], slots.data ?? [], coaches.data ?? [], now);
  const past = pastSessions(bookings.data ?? [], slots.data ?? [], coaches.data ?? [], now);

  const renderScene = ({ route }: { route: TabRoute }) => {
    if (route.key === 'upcoming') {
      return (
        <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
          {upcoming.length === 0 ? (
            <EmptyState
              icon="tennisball-outline"
              title="No upcoming sessions"
              message="Book a session and it'll show up here, ready to manage."
              cta={{ label: 'Book a session', onPress: () => router.push('/(tabs)/book') }}
            />
          ) : (
            <View style={styles.list}>
              {upcoming.map(({ booking, slot, coach }) => (
                <BookingCard
                  key={booking.id}
                  variant="upcoming"
                  slot={slot}
                  coach={coach}
                  refundable={isCancellableWithoutForfeit(slot, now)}
                  deadline={cancellationDeadline(slot)}
                  onCancel={() =>
                    router.push({ pathname: '/cancel-booking', params: { bookingId: booking.id } })
                  }
                />
              ))}
            </View>
          )}
        </ScrollView>
      );
    }
    return (
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        {past.length === 0 ? (
          <EmptyState
            icon="time-outline"
            title="No past sessions"
            message="Your session history will appear here after you've played."
          />
        ) : (
          <View style={styles.list}>
            {past.map(({ booking, slot, coach }) => (
              <BookingCard key={booking.id} variant="past" slot={slot} coach={coach} status={booking.status} />
            ))}
          </View>
        )}
      </ScrollView>
    );
  };

  return (
    <Screen tabBar style={styles.screenBody}>
      <ScreenHeader eyebrow="Your court time" title="Sessions" />
      <TabView
        navigationState={{ index, routes: ROUTES }}
        onIndexChange={setIndex}
        renderScene={renderScene}
        renderTabBar={(props) => (
          <SegmentedControl
            options={TABS}
            value={ROUTES[props.navigationState.index]!.key}
            onChange={(value) => props.jumpTo(value)}
          />
        )}
        initialLayout={{ width }}
        style={styles.tabView}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg },
  screenBody: { gap: space.lg },
  tabView: { flex: 1 },
  page: { gap: space.lg, paddingBottom: space.xl },
  list: { gap: space.lg },
});
