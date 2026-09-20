import { formatDayMonth } from '@tpa/core';
import { space } from '@tpa/theme';
import type { IsoInstant } from '@tpa/types';
import { StyleSheet, View } from 'react-native';

import { typeSlices } from '../../../data/coachSchedule';
import { useCoachDashboard } from '../../../data/queries';
import { queryKeys } from '../../../lib/queryClient';
import { useSession } from '../../../session/SessionProvider';
import {
  BarColumns,
  Card,
  CoachNotLinked,
  ErrorView,
  LoadingView,
  MeterRow,
  Screen,
  ScreenHeader,
  Text,
  useRefreshControl,
} from '../../../ui';

const fmt = (h: number): string => {
  const r = Math.round(h * 2) / 2;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

/**
 * What the coach has EARNED — not what they are scheduled for.
 *
 * The distinction is the whole screen, and the note at the bottom says so, because
 * the two genuinely differ: an hour counts only once its session has FINISHED and
 * an admin has marked at least one player attended. A session taught this morning
 * contributes nothing until that happens.
 *
 * Everything here comes from the one dashboard aggregate, whose hours are computed
 * by the same predicate coach_hours_coached uses — so this screen can never
 * disagree with the payroll figure the admin sees.
 */
export default function CoachHoursScreen() {
  const { coachId } = useSession();
  const dash = useCoachDashboard(coachId != null);
  const refreshControl = useRefreshControl([queryKeys.coachDashboard]);

  const header = <ScreenHeader eyebrow="Your work" title="Hours coached" />;

  if (coachId == null) {
    return (
      <Screen scroll tabBar contentContainerStyle={styles.content}>
        {header}
        <CoachNotLinked />
      </Screen>
    );
  }

  if (dash.isPending || dash.isError) {
    return (
      <Screen scroll tabBar contentContainerStyle={styles.content} refreshControl={refreshControl}>
        {header}
        {dash.isPending ? <LoadingView /> : <ErrorView onRetry={dash.refetch} />}
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

  const diff = Math.round((d.hoursThisMonth - d.hoursLastMonth) * 2) / 2;
  const fourWeekTotal = d.weeklyHours.reduce((sum, w) => sum + w.hours, 0);
  const slices = typeSlices(d.breakdown, d.sessionsThisMonth);

  return (
    <Screen scroll tabBar contentContainerStyle={styles.content} refreshControl={refreshControl}>
      {header}

      <Card variant="inverse">
        <View style={styles.hero}>
          <Text variant="label" tone="inverse">
            This month
          </Text>
          <View style={styles.heroNumber}>
            <Text variant="display" tone="inverse">
              {fmt(d.hoursThisMonth)}
            </Text>
            <Text variant="h2" tone="inverse">
              h
            </Text>
          </View>
          <Text variant="caption" tone="inverse">
            {diff === 0
              ? 'Same as last month'
              : `${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff))}h vs last month (${fmt(d.hoursLastMonth)}h)`}
          </Text>
        </View>
      </Card>

      {/* The four weekly bars. Oldest first, exactly as the RPC returns them, so
          they render left to right with no reversing. The header total is labelled
          "last 4 weeks" and NOT the month — weeks do not tile a calendar month, so
          calling it the monthly figure would be wrong on most days of the year. */}
      <Card>
        <View style={styles.group}>
          <View style={styles.cardHead}>
            <Text variant="label">Last 4 weeks</Text>
            <Text variant="caption" tone="muted">
              {fmt(fourWeekTotal)}h total
            </Text>
          </View>
          <BarColumns
            bars={d.weeklyHours.map((w, i) => ({
              value: w.hours,
              caption: `${fmt(w.hours)}h`,
              label: i === d.weeklyHours.length - 1 ? 'This wk' : formatDayMonth(`${w.weekStart}T12:00:00.000Z` as IsoInstant),
              highlight: i === d.weeklyHours.length - 1,
            }))}
          />
        </View>
      </Card>

      {/* The design shows hours by type. The aggregate only knows SESSIONS by type —
          hours-by-type would need attendance joined per type, which is a backend
          change — so this is labelled for what it actually is rather than dressed
          up as hours. */}
      {slices.length > 0 ? (
        <Card>
          <View style={styles.group}>
            <View style={styles.cardHead}>
              <Text variant="label">Sessions by type</Text>
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

      <Text variant="caption" tone="muted" style={styles.note}>
        These are hours you&apos;ve been credited for, not hours on your schedule. A session counts
        once it has finished and the academy has marked at least one player attended — so a session
        you taught today may take a little while to appear here. If something looks missing, ask the
        academy to check attendance.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg },
  hero: { gap: space.xs },
  heroNumber: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs },
  group: { gap: space.md },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  note: { lineHeight: 18 },
});
