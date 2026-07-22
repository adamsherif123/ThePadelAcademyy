import {
  cancellationDeadline,
  formatInstantDate,
  formatInstantTime,
  isSessionConfirmed,
  spotsUntilConfirmed,
} from '@tpa/core';
import { space } from '@tpa/theme';
import type { BookingId } from '@tpa/types';
import { useLocalSearchParams } from 'expo-router';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { coachById, slotById } from '../data/booking';
import { useBatches, useBookings, useCoaches, useSlots, combine } from '../data/queries';
import { balanceByType } from '../data/wallet';
import { resetToTab } from '../lib/nav';
import { useSession } from '../session/SessionProvider';
import {
  ACADEMY,
  Avatar,
  Badge,
  Card,
  IconRow,
  InfoCard,
  LoadingView,
  Screen,
  SuccessView,
  Text,
  TRAINING_META,
} from '../ui';

/** 13 — Booked success. Shared SuccessView; every number computed from live data. */
export default function BookedSuccessScreen() {
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

  // The SEAT is always booked; what may still be pending is whether the SESSION
  // runs. Confirmed → confident copy; pending → honest "runs once it fills" (no
  // promise of any notification — the app can't send one). An individual
  // auto-confirms on the first booking, so a 1-on-1 lands here as confirmed.
  const confirmed = isSessionConfirmed(slot);
  const toFill = spotsUntilConfirmed(slot);

  return (
    <Screen>
      <SuccessView
        tone="success"
        eyebrow={confirmed ? 'See you on court' : 'Your spot is saved'}
        title="You're booked"
        primary={{ label: 'View my sessions', onPress: () => resetToTab('/(tabs)/sessions') }}
        secondary={{ label: 'Done', onPress: () => resetToTab('/(tabs)') }}
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
            {/* Location taps through to Maps — the one thing a player needs at 6pm. */}
            <Pressable onPress={() => Linking.openURL(ACADEMY.mapsUrl)}>
              <IconRow icon="location-outline" title={ACADEMY.locationLine} subtitle="Tap for directions" />
            </Pressable>
            <IconRow
              icon="time-outline"
              title={`Free cancellation until ${formatInstantTime(cancellationDeadline(slot))}`}
            />
          </View>
        </Card>

        {/* Cap-1 sessions (individual/trial) confirm on the first booking, so a
            "runs once N more join" note is nonsense there — gate on capacity > 1.
            While pending, toFill is always >= 1 (a confirmed session returns 0),
            so this can never render "0 to fill". */}
        {confirmed || slot.capacity <= 1 ? null : (
          <InfoCard
            variant="neutral"
            icon="people-outline"
            style={styles.pendingNote}
            text={`Your spot and credit are saved. This session runs once ${toFill} more ${
              toFill === 1 ? 'player joins' : 'players join'
            }.`}
          />
        )}

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
  pendingNote: { marginTop: space.md },
  usedLine: { textAlign: 'center', marginTop: space.md },
});
