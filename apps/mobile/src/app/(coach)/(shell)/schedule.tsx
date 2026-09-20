import { formatInstantDate } from '@tpa/core';
import { space } from '@tpa/theme';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { coachDays, sessionState } from '../../../data/coachSchedule';
import { useCoachSlots } from '../../../data/queries';
import { queryKeys } from '../../../lib/queryClient';
import { useSession } from '../../../session/SessionProvider';
import {
  CoachNotLinked,
  CoachSessionCard,
  EmptyState,
  ErrorView,
  LoadingView,
  Screen,
  ScreenHeader,
  Text,
  useRefreshControl,
} from '../../../ui';

/**
 * Every session the coach has, grouped by Cairo day.
 *
 * Unlike the Dashboard's single next-session card, this is the full picture — and
 * it deliberately keeps sessions that have already FINISHED today, because a coach
 * reading their schedule mid-evening wants the whole day's work, not just what is
 * left of it. Each row states which it is (done / live / upcoming).
 *
 * Tapping a session pushes its roster over the tab bar, with the back gesture.
 */
export default function CoachScheduleScreen() {
  const router = useRouter();
  const { now, coachId } = useSession();
  const slotsQ = useCoachSlots(coachId, now);
  const refreshControl = useRefreshControl([queryKeys.coachSlots]);

  const header = <ScreenHeader eyebrow="Your week on court" title="Schedule" />;

  if (coachId == null) {
    return (
      <Screen scroll tabBar contentContainerStyle={styles.content}>
        {header}
        <CoachNotLinked />
      </Screen>
    );
  }

  if (slotsQ.isPending || slotsQ.isError) {
    return (
      <Screen scroll tabBar contentContainerStyle={styles.content} refreshControl={refreshControl}>
        {header}
        {slotsQ.isPending ? <LoadingView /> : <ErrorView onRetry={slotsQ.refetch} />}
      </Screen>
    );
  }

  const days = coachDays(slotsQ.data ?? [], now);
  const open = (slotId: string) =>
    router.push({ pathname: '/(coach)/session/[id]', params: { id: slotId } });

  return (
    <Screen scroll tabBar contentContainerStyle={styles.content} refreshControl={refreshControl}>
      {header}

      {days.length === 0 ? (
        <EmptyState
          icon="calendar-outline"
          title="No sessions scheduled"
          message="When the academy puts you on a session, it'll show up here with everyone who's booked in."
        />
      ) : (
        days.map((day) => (
          <View key={day.key} style={styles.day}>
            <View style={styles.dayHead}>
              <Text variant="label">{day.label || formatInstantDate(day.date)}</Text>
              <Text variant="caption" tone="muted">
                {day.label ? `${formatInstantDate(day.date)} · ` : ''}
                {day.sessions.length} session{day.sessions.length === 1 ? '' : 's'}
              </Text>
            </View>
            {day.sessions.map((s) => {
              const state = sessionState(s, now);
              return (
                <CoachSessionCard
                  key={s.id}
                  slot={s}
                  showDate={false}
                  eyebrow={state === 'live' ? 'On court now' : state === 'done' ? 'Completed' : undefined}
                  dimmed={state === 'done'}
                  onPress={() => open(s.id)}
                />
              );
            })}
          </View>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg },
  day: { gap: space.sm },
  dayHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm },
});
