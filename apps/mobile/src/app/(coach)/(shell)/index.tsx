import { space } from '@tpa/theme';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { coachSchedule, startsInLabel } from '../../../data/coachSchedule';
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
 * The coach's home: what am I teaching, and who is coming.
 *
 * One hero — the session on court now, or the next to start — then the rest of
 * today, then the days after. That ordering is the whole design: a coach opening
 * this mid-shift wants one answer immediately, and the rest only if they scroll.
 *
 * Every card taps through to its roster. Nothing here books, sells or refunds
 * anything; there is no route from this screen into the player app.
 */
export default function CoachScheduleScreen() {
  const router = useRouter();
  const { now, coachId } = useSession();
  const slotsQ = useCoachSlots(coachId, now);
  const refreshControl = useRefreshControl([queryKeys.coachSlots]);

  // Before anything else: an account with no coach link has no schedule to load.
  // Saying so beats a spinner that can never resolve (the query is gated on this id).
  if (coachId == null) {
    return (
      <Screen scroll tabBar contentContainerStyle={styles.content}>
        <ScreenHeader eyebrow="Your court time" title="Schedule" />
        <CoachNotLinked />
      </Screen>
    );
  }

  if (slotsQ.isPending || slotsQ.isError) {
    return (
      <Screen scroll tabBar contentContainerStyle={styles.content} refreshControl={refreshControl}>
        <ScreenHeader eyebrow="Your court time" title="Schedule" />
        {slotsQ.isPending ? <LoadingView /> : <ErrorView onRetry={slotsQ.refetch} />}
      </Screen>
    );
  }

  const { hero, heroInProgress, restOfToday, later } = coachSchedule(slotsQ.data ?? [], now);
  const open = (slotId: string) =>
    router.push({ pathname: '/(coach)/session/[id]', params: { id: slotId } });

  return (
    <Screen scroll tabBar contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <ScreenHeader eyebrow="Your court time" title="Schedule" />

      {hero === null ? (
        <EmptyState
          icon="calendar-outline"
          title="No sessions scheduled"
          message="When the academy puts you on a session, it'll show up here with everyone who's booked in."
        />
      ) : (
        <>
          <CoachSessionCard
            slot={hero}
            variant="hero"
            eyebrow={heroInProgress ? 'On court now' : `Starts ${startsInLabel(hero.startsAt, now)}`}
            onPress={() => open(hero.id)}
          />

          {restOfToday.length > 0 ? (
            <View style={styles.group}>
              <Text variant="label">Later today</Text>
              {restOfToday.map((s) => (
                <CoachSessionCard key={s.id} slot={s} showDate={false} onPress={() => open(s.id)} />
              ))}
            </View>
          ) : null}

          {later.length > 0 ? (
            <View style={styles.group}>
              <Text variant="label">Coming up</Text>
              {later.map((s) => (
                <CoachSessionCard key={s.id} slot={s} onPress={() => open(s.id)} />
              ))}
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg },
  group: { gap: space.sm },
});
