import { spotsUntilConfirmed } from '@tpa/core';
import { space } from '@tpa/theme';
import type { SlotId } from '@tpa/types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { sessionState, startsInLabel } from '../../../data/coachSchedule';
import { useCoachRoster, useCoachSlots } from '../../../data/queries';
import { useSession } from '../../../session/SessionProvider';
import {
  Badge,
  Card,
  CoachNotLinked,
  CoachSessionCard,
  EmptyState,
  ErrorView,
  LEVEL_LABEL,
  LoadingView,
  Screen,
  ScreenHeader,
  Text,
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

  // Compact: this is a pushed screen, and the card directly below already says
  // which session it is. A full display heading here out-shouts the roster it is
  // introducing — especially on a session with one player.
  const header = (
    <ScreenHeader eyebrow="Session" title="Who's coming" size="compact" onBack={() => router.back()} />
  );

  if (coachId == null) {
    return (
      <Screen scroll contentContainerStyle={styles.content}>
        {header}
        <CoachNotLinked />
      </Screen>
    );
  }

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

  const roster = rosterQ.data ?? [];
  const state = sessionState(slot, now);
  const needed = spotsUntilConfirmed(slot);

  return (
    <Screen scroll contentContainerStyle={styles.content}>
      {header}

      {/* The SAME card the Schedule and Dashboard draw, so a session looks like
          itself wherever a coach meets it. It also fixes what this screen used to
          do by hand: the date was printed twice (once inside the full time range,
          once beneath it) and the range ran at display size, wrapping to two lines.
          The card states the date once and adds the countdown, which is the one
          thing a coach opening a session actually wants to know. */}
      <CoachSessionCard
        slot={slot}
        variant="hero"
        dimmed={state === 'done'}
        eyebrow={
          state === 'done' ? 'Completed' : state === 'live' ? 'On court now' : `Starts ${startsInLabel(slot.startsAt, now)}`
        }
      />

      {/* The one fact this screen can add that the card cannot: what it would take
          for a pending session to go ahead. A statement of what fills it — never a
          promise that anyone will be told. */}
      {needed > 0 ? (
        <Text variant="caption" tone="secondary">
          Runs once {needed} more player{needed === 1 ? '' : 's'} {needed === 1 ? 'joins' : 'join'}.
        </Text>
      ) : null}

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
            <Card key={`${entry.name}-${i}`} style={styles.playerCard}>
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
  group: { gap: space.sm },
  // Card's own padding is sized for a block of content; a one-line name is not
  // that, and at space.xl each player took the height of a paragraph.
  playerCard: { padding: space.md },
  playerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
});
