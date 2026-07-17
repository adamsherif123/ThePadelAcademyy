import { cancellationDeadline, formatInstantDate, formatInstantTime } from '@tpa/core';
import { space } from '@tpa/theme';
import type { BookingId } from '@tpa/types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { coachById, slotById } from '../data/booking';
import { useBatches, useBookings, useCoaches, useSlots, combine } from '../data/queries';
import { balanceByType } from '../data/wallet';
import { useSession } from '../session/SessionProvider';
import {
  ACADEMY,
  Avatar,
  Badge,
  Card,
  IconRow,
  LoadingView,
  Screen,
  SuccessView,
  Text,
  TRAINING_META,
} from '../ui';

/** 13 — Booked success. Shared SuccessView; every number computed from live data. */
export default function BookedSuccessScreen() {
  const router = useRouter();
  const { player, now } = useSession();
  const slotsQ = useSlots();
  const batchesQ = useBatches();
  const bookingsQ = useBookings();
  const coachesQ = useCoaches();
  const gate = combine(slotsQ, batchesQ, bookingsQ, coachesQ);
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();

  if (gate.isPending) {
    return (
      <Screen>
        <LoadingView />
      </Screen>
    );
  }

  const booking = (bookingsQ.data ?? []).find((b) => b.id === (bookingId as BookingId));
  const slot = booking ? slotById(slotsQ.data ?? [], booking.slotId) : undefined;
  if (!player || !booking || !slot) return <Screen />;

  const coach = coachById(coachesQ.data ?? [], slot.coachId);
  const meta = TRAINING_META[slot.trainingType];
  const left = balanceByType(batchesQ.data ?? [], now)[slot.trainingType];

  return (
    <Screen>
      <SuccessView
        tone="success"
        eyebrow="See you on court"
        title="You're booked"
        primary={{ label: 'View my sessions', onPress: () => router.replace('/(tabs)/sessions') }}
        secondary={{ label: 'Done', onPress: () => router.replace('/(tabs)') }}
      >
        <Card>
          <View style={styles.top}>
            <Avatar name={coach?.name ?? 'Coach'} imageUrl={coach?.photoUrl} size={44} />
            <View style={styles.info}>
              <Text variant="body" weight="bold">
                {`${formatInstantDate(slot.startsAt)} · ${formatInstantTime(slot.startsAt)}`}
              </Text>
              <Text variant="caption" tone="secondary">
                {coach ? `with ${coach.name}` : ''}
              </Text>
            </View>
            <Badge label={meta.label} icon={meta.icon} />
          </View>
          <View style={styles.rows}>
            <IconRow icon="location-outline" title={ACADEMY.locationLine} />
            <IconRow
              icon="time-outline"
              title={`Free cancellation until ${formatInstantTime(cancellationDeadline(slot))}`}
            />
          </View>
        </Card>

        <Text variant="caption" tone="secondary" style={styles.usedLine}>
          {`1 ${meta.label} credit used · ${left} left`}
        </Text>
      </SuccessView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  info: { flex: 1, gap: 2 },
  rows: { gap: space.sm, marginTop: space.md },
  usedLine: { textAlign: 'center', marginTop: space.md },
});
