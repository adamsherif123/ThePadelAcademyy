import { cancellationDeadline, isCancellableWithoutForfeit } from '@tpa/core';
import { space } from '@tpa/theme';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { TabView } from 'react-native-tab-view';

import { hasOlderSessions, pastSessions, upcomingSessions, withOlderSessions } from '../../data/booking';
import { useBookings, useCoaches, usePastSessionsOlder, useSlots, combine } from '../../data/queries';
import { useSession } from '../../session/SessionProvider';
import {
  BookingCard,
  EmptyState,
  ErrorView,
  LoadingView,
  LoadMore,
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
  const slots = useSlots(now);
  const coaches = useCoaches();
  // Sessions older than the slot window — nothing is fetched until "Load older" is
  // tapped, so the common case (recent history) costs no extra round trip.
  const older = usePastSessionsOlder(now);
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
  // Recent past comes free from the slots already in hand; older pages are appended
  // as the player asks for them (see `withOlderSessions` for the disjointness rule).
  const coachList = coaches.data ?? [];
  const past = withOlderSessions(
    pastSessions(bookings.data ?? [], slots.data ?? [], coachList, now),
    older.items,
    coachList,
  );
  // Exact, and free: the player's whole booking list is already in hand, so a booking
  // with no slot in the window IS an older session. No button for someone who has
  // never played; no hidden history for someone who has.
  const canLoadOlder = older.hasMore && hasOlderSessions(bookings.data ?? [], slots.data ?? []);

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
        {past.length === 0 && !canLoadOlder ? (
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
            {canLoadOlder ? (
              <LoadMore loading={older.isLoadingMore} onPress={older.loadMore} />
            ) : null}
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
          <View style={styles.tabBar}>
            <SegmentedControl
              options={TABS}
              value={ROUTES[props.navigationState.index]!.key}
              onChange={(value) => props.jumpTo(value)}
            />
          </View>
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
  tabBar: { paddingBottom: space.lg },
  page: { gap: space.lg, paddingBottom: space.xl },
  list: { gap: space.lg },
});
