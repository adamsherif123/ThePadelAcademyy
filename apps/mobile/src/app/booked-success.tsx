import { cancellationDeadline, formatInstantDate, formatInstantTime } from '@tpa/core';
import { space } from '@tpa/theme';
import type { BookingId } from '@tpa/types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { coachById, slotById } from '../data/booking';
import { getBookings, useDataStore } from '../data/store';
import { balanceByType } from '../data/wallet';
import { useSession } from '../session/SessionProvider';
import {
  ACADEMY,
  Avatar,
  Badge,
  Card,
  IconRow,
  Screen,
  SuccessView,
  Text,
  TRAINING_META,
} from '../ui';

/** 13 — Booked success. Shared SuccessView; every number computed from the store. */
export default function BookedSuccessScreen() {
  const router = useRouter();
  const { player, now } = useSession();
  useDataStore();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();

  const booking = getBookings().find((b) => b.id === (bookingId as BookingId));
  const slot = booking ? slotById(booking.slotId) : undefined;
  if (!player || !booking || !slot) return <Screen />;

  const coach = coachById(slot.coachId);
  const meta = TRAINING_META[slot.trainingType];
  const left = balanceByType(player.id, now)[slot.trainingType];

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
