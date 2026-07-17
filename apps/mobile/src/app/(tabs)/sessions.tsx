import { cancellationDeadline, isCancellableWithoutForfeit } from '@tpa/core';
import { space } from '@tpa/theme';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

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

/** 14 — Sessions. The player's booked court time: upcoming (cancellable) and past. */
export default function SessionsScreen() {
  const router = useRouter();
  const { player, now } = useSession();
  const bookings = useBookings();
  const slots = useSlots();
  const coaches = useCoaches();
  const gate = combine(bookings, slots, coaches);
  const [tab, setTab] = useState<Tab>('upcoming');
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

  return (
    <Screen scroll tabBar contentContainerStyle={styles.content}>
      <ScreenHeader eyebrow="Your court time" title="Sessions" />
      <SegmentedControl options={TABS} value={tab} onChange={setTab} />

      {tab === 'upcoming' ? (
        upcoming.length === 0 ? (
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
        )
      ) : past.length === 0 ? (
        <EmptyState
          icon="time-outline"
          title="No past sessions"
          message="Your session history will appear here after you've played."
        />
      ) : (
        <View style={styles.list}>
          {past.map(({ booking, slot, coach }) => (
            <BookingCard
              key={booking.id}
              variant="past"
              slot={slot}
              coach={coach}
              status={booking.status}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg },
  list: { gap: space.lg },
});
