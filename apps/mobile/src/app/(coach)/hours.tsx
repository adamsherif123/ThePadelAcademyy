import { space } from '@tpa/theme';
import { StyleSheet, View } from 'react-native';

import { useMyCoachHours } from '../../data/queries';
import { queryKeys } from '../../lib/queryClient';
import { useSession } from '../../session/SessionProvider';
import {
  Card,
  ErrorView,
  LoadingView,
  Screen,
  ScreenHeader,
  Text,
  useRefreshControl,
} from '../../ui';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Cairo is the academy's wall clock everywhere else, so the month names match it. */
function monthName(offset: number): string {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return MONTHS[d.getMonth()] ?? '';
}

/** "6" / "6.5" — never "6.50", and never a float artefact like 6.499999. */
function formatHours(hours: number): string {
  const rounded = Math.round(hours * 2) / 2;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * What the coach has EARNED — not what they are scheduled for.
 *
 * The distinction is the whole screen, and the copy is explicit about it, because
 * the two numbers genuinely differ: coach_hours_coached counts a session only once
 * it has FINISHED and at least one player on it has been marked attended by an
 * admin. A session taught this morning contributes nothing until attendance is
 * marked, and a session nobody attended never contributes at all. A coach who does
 * not know that would read a low number as the app being wrong.
 *
 * There is no per-session breakdown, and deliberately no invented one: attendance
 * lives on `bookings`, which a coach cannot read, so the app cannot honestly say
 * WHICH sessions counted. Showing a guess would be worse than showing the total.
 */
export default function CoachHoursScreen() {
  const { coachId } = useSession();
  const enabled = coachId != null;
  const thisMonth = useMyCoachHours(enabled, 0);
  const lastMonth = useMyCoachHours(enabled, -1);
  const refreshControl = useRefreshControl([queryKeys.coachHours]);

  const isPending = thisMonth.isPending || lastMonth.isPending;
  const isError = thisMonth.isError || lastMonth.isError;

  return (
    <Screen scroll tabBar contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <ScreenHeader eyebrow="Your work" title="Hours coached" />

      {isPending || isError ? (
        isError ? (
          <ErrorView
            onRetry={() => {
              thisMonth.refetch();
              lastMonth.refetch();
            }}
          />
        ) : (
          <LoadingView />
        )
      ) : (
        <>
          <Card>
            <View style={styles.hero}>
              <Text variant="label">{monthName(0)}</Text>
              <View style={styles.heroNumber}>
                <Text variant="display">{formatHours(thisMonth.data ?? 0)}</Text>
                <Text variant="h2" tone="secondary">
                  {(thisMonth.data ?? 0) === 1 ? 'hour' : 'hours'}
                </Text>
              </View>
              <Text variant="bodySecondary">Counted so far this month</Text>
            </View>
          </Card>

          <Card>
            <View style={styles.compareRow}>
              <View style={styles.compareText}>
                <Text variant="label">{monthName(-1)}</Text>
                <Text variant="bodySecondary">Last month&apos;s total</Text>
              </View>
              <Text variant="h1">{formatHours(lastMonth.data ?? 0)}</Text>
            </View>
          </Card>

          <Text variant="caption" tone="muted" style={styles.note}>
            These are hours you&apos;ve been credited for, not hours on your schedule. A session
            counts once it has finished and the academy has marked at least one player attended —
            so a session you taught today may take a little while to appear here. If something
            looks missing, ask the academy to check attendance.
          </Text>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg },
  hero: { gap: space.xs, alignItems: 'center', paddingVertical: space.md },
  heroNumber: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  compareRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md },
  compareText: { gap: 2 },
  note: { lineHeight: 18 },
});
