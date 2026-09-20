import { formatInstantDate, formatSessionTimeRange, isSessionConfirmed } from '@tpa/core';
import { space } from '@tpa/theme';
import type { SlotId } from '@tpa/types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useCoachRoster, useCoachSlots } from '../../../data/queries';
import { useSession } from '../../../session/SessionProvider';
import {
  Badge,
  Card,
  CapacityMeter,
  EmptyState,
  ErrorView,
  LEVEL_LABEL,
  LoadingView,
  Screen,
  ScreenHeader,
  Text,
  trainingMetaFor,
} from '../../../ui';

/**
 * One of the coach's sessions, and who is coming to it.
 *
 * The roster is `coach_session_roster` — name and level, and nothing else. That is
 * a deliberate limit, not an omission: a coach plans a session from names and
 * levels, and has no business with a player's phone or email, so the RPC never
 * returns them (migration 050). Another coach's slot comes back empty rather than
 * as an error, which this screen renders as "nobody booked yet".
 */
export default function CoachSessionDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { now, coachId } = useSession();
  const slotId = (id ?? null) as SlotId | null;

  // The slot itself comes from the schedule the Schedule tab already loaded, so
  // opening a session is one request (the roster), not two.
  const slotsQ = useCoachSlots(coachId, now);
  const rosterQ = useCoachRoster(slotId);
  const slot = (slotsQ.data ?? []).find((s) => s.id === slotId);

  const header = <ScreenHeader eyebrow="Session" title="Who's coming" onBack={() => router.back()} />;

  if (slotsQ.isPending || rosterQ.isPending || slotsQ.isError || rosterQ.isError) {
    return (
      <Screen scroll contentContainerStyle={styles.content}>
        {header}
        {slotsQ.isError || rosterQ.isError ? (
          <ErrorView
            onRetry={() => {
              slotsQ.refetch();
              rosterQ.refetch();
            }}
          />
        ) : (
          <LoadingView />
        )}
      </Screen>
    );
  }

  if (!slot) {
    return (
      <Screen scroll contentContainerStyle={styles.content}>
        {header}
        <EmptyState
          icon="calendar-outline"
          title="Session not found"
          message="It may have been cancelled or rescheduled. Pull the Schedule to refresh."
        />
      </Screen>
    );
  }

  const meta = trainingMetaFor(slot.trainingType);
  const confirmed = isSessionConfirmed(slot);
  const roster = rosterQ.data ?? [];

  return (
    <Screen scroll contentContainerStyle={styles.content}>
      {header}

      <Card>
        <View style={styles.summary}>
          <Text variant="h1">{formatSessionTimeRange(slot.startsAt, slot.endsAt)}</Text>
          <Text variant="bodySecondary">{formatInstantDate(slot.startsAt)}</Text>
          <View style={styles.badges}>
            <Badge label={meta.label} tone="neutral" icon={meta.icon} />
            {slot.level ? <Badge label={LEVEL_LABEL[slot.level]} tone="neutral" /> : null}
            <Badge label={confirmed ? 'Confirmed' : 'Pending'} tone={confirmed ? 'success' : 'warning'} />
          </View>
          <View style={styles.capacity}>
            <Text variant="bodySecondary">
              {slot.bookedCount} of {slot.capacity} booked
            </Text>
            <CapacityMeter booked={slot.bookedCount} capacity={slot.capacity} />
          </View>
        </View>
      </Card>

      {roster.length === 0 ? (
        <EmptyState
          icon="people-outline"
          title="Nobody booked yet"
          message="Players who book this session will appear here with their level."
        />
      ) : (
        <View style={styles.group}>
          <Text variant="label">{`On court (${roster.length})`}</Text>
          {roster.map((entry, i) => (
            <Card key={`${entry.name}-${i}`}>
              <View style={styles.playerRow}>
                <Text variant="body" weight="semibold">
                  {entry.name}
                </Text>
                <Badge label={LEVEL_LABEL[entry.level]} tone="neutral" />
              </View>
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg },
  summary: { gap: space.sm },
  badges: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexWrap: 'wrap' },
  capacity: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  group: { gap: space.sm },
  playerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
});
