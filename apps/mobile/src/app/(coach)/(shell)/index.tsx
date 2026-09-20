import { formatInstantDate } from '@tpa/core';
import { space } from '@tpa/theme';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { cairoGreeting, coachSchedule, startsInLabel, typeSlices, weekStrip } from '../../../data/coachSchedule';
import { useCoachDashboard, useCoachSlots } from '../../../data/queries';
import { queryKeys } from '../../../lib/queryClient';
import { useSession } from '../../../session/SessionProvider';
import {
  Avatar,
  Card,
  CoachNotLinked,
  CoachSessionCard,
  ErrorView,
  LoadingView,
  MeterRow,
  Screen,
  ScreenHeader,
  StatTile,
  Text,
  WeekStrip,
  useRefreshControl,
} from '../../../ui';

/** "+5.5h vs last month" / "−2h vs last month" / "Same as last month". */
function deltaLabel(now: number, previous: number): { text: string; tone: 'success' | 'secondary' } {
  const diff = Math.round((now - previous) * 2) / 2;
  if (diff === 0) return { text: 'Same as last month', tone: 'secondary' };
  const sign = diff > 0 ? '+' : '−';
  const n = Math.abs(diff);
  return {
    text: `${sign}${Number.isInteger(n) ? n : n.toFixed(1)}h vs last month`,
    tone: diff > 0 ? 'success' : 'secondary',
  };
}

const fmtHours = (h: number): string => {
  const r = Math.round(h * 2) / 2;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

/**
 * The coach's home: what they've earned, how full their sessions are, and what's
 * next — the whole screen from ONE aggregate call plus the schedule they already
 * have for the next-session card.
 */
export default function CoachDashboardScreen() {
  const router = useRouter();
  const { now, coachId, player } = useSession();
  const dash = useCoachDashboard(coachId != null);
  const slotsQ = useCoachSlots(coachId, now);
  const refreshControl = useRefreshControl([queryKeys.coachDashboard, queryKeys.coachSlots]);

  const firstName = player?.name.split(' ')[0] ?? 'Coach';
  const header = (
    <ScreenHeader
      eyebrow={cairoGreeting(now)}
      title={`Coach ${firstName}`}
      trailing={player ? <Avatar name={player.name} size={44} /> : undefined}
    />
  );

  if (coachId == null) {
    return (
      <Screen scroll tabBar contentContainerStyle={styles.content}>
        {header}
        <CoachNotLinked />
      </Screen>
    );
  }

  if (dash.isPending || slotsQ.isPending || dash.isError || slotsQ.isError) {
    return (
      <Screen scroll tabBar contentContainerStyle={styles.content} refreshControl={refreshControl}>
        {header}
        {dash.isError || slotsQ.isError ? (
          <ErrorView
            onRetry={() => {
              dash.refetch();
              slotsQ.refetch();
            }}
          />
        ) : (
          <LoadingView />
        )}
      </Screen>
    );
  }

  const d = dash.data;
  if (!d) {
    return (
      <Screen scroll tabBar contentContainerStyle={styles.content}>
        {header}
        <CoachNotLinked />
      </Screen>
    );
  }

  const slots = slotsQ.data ?? [];
  const { hero, heroInProgress } = coachSchedule(slots, now);
  const delta = deltaLabel(d.hoursThisMonth, d.hoursLastMonth);
  const slices = typeSlices(d.breakdown, d.sessionsThisMonth);

  return (
    <Screen scroll tabBar contentContainerStyle={styles.content} refreshControl={refreshControl}>
      {header}
      <Text variant="caption" tone="muted" style={styles.today}>
        {formatInstantDate(now)}
      </Text>

      {/* Hero — the same inverse card the player's wallet summary uses, so the
          coach app's centrepiece is the app's own navy, not a second palette. */}
      <Card variant="inverse">
        <View style={styles.hero}>
          <Text variant="label" tone="inverse">
            Hours this month
          </Text>
          <View style={styles.heroNumber}>
            <Text variant="display" tone="inverse">
              {fmtHours(d.hoursThisMonth)}
            </Text>
            <Text variant="h2" tone="inverse">
              h
            </Text>
          </View>
          <Text variant="caption" tone="inverse">
            {delta.text}
          </Text>
        </View>
      </Card>

      {/* 2×2 */}
      <View style={styles.grid}>
        <View style={styles.gridRow}>
          <StatTile value={String(d.sessionsThisWeek)} label="Sessions this week" />
          <StatTile value={String(d.studentsThisMonth)} label="Students this month" />
        </View>
        <View style={styles.gridRow}>
          <StatTile value={`${d.fillRate}%`} label="Fill rate" meter={d.fillRate / 100} />
          <StatTile value={String(d.upcomingCount)} label="Upcoming" />
        </View>
      </View>

      {/* Next / current session */}
      {hero ? (
        <View style={styles.group}>
          <Text variant="label">{heroInProgress ? 'On court now' : 'Up next'}</Text>
          <CoachSessionCard
            slot={hero}
            variant="hero"
            eyebrow={heroInProgress ? 'On court now' : `Starts ${startsInLabel(hero.startsAt, now)}`}
            onPress={() => router.push({ pathname: '/(coach)/session/[id]', params: { id: hero.id } })}
          />
        </View>
      ) : null}

      {/* This week, by day */}
      <Card>
        <View style={styles.group}>
          {/* Deliberately NO total beside this heading. `sessions_this_week` is the
              server's count over the whole week, while the strip can only draw what
              the schedule fetch holds — twelve hours back — so earlier days read 0.
              Putting the two side by side would look like arithmetic that fails.
              The real weekly total has its own stat tile above. */}
          <Text variant="label">This week</Text>
          <WeekStrip days={weekStrip(slots, now)} />
          <Text variant="micro" tone="muted">
            Earlier days show only what is still on your schedule
          </Text>
        </View>
      </Card>

      {/* Type mix. Not a donut with a total in the middle: an open block or a trial
          counts in the month but sits in none of the three types, so the segments
          need not add up. An "Other" row carries any remainder (see typeSlices). */}
      {slices.length > 0 ? (
        <Card>
          <View style={styles.group}>
            <View style={styles.cardHead}>
              <Text variant="label">Session mix</Text>
              <Text variant="caption" tone="muted">
                {d.sessionsThisMonth} this month
              </Text>
            </View>
            {slices.map((s) => (
              <MeterRow key={s.label} label={s.label} value={String(s.count)} fraction={s.fraction} />
            ))}
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg },
  today: { marginTop: -space.md },
  hero: { gap: space.xs },
  heroNumber: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs },
  grid: { gap: space.sm },
  gridRow: { flexDirection: 'row', gap: space.sm },
  group: { gap: space.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
});
