import { radius, space } from '@tpa/theme';
import { StyleSheet, View } from 'react-native';
import { useMemo } from 'react';

import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

/**
 * The coach Dashboard's small display pieces.
 *
 * All of them draw with plain Views — no SVG dependency. The design's charts are a
 * column of vertical bars and a set of horizontal meters, both of which are a box
 * with a height or a width, so pulling in a native drawing library before a release
 * build would have bought nothing.
 *
 * Every colour resolves through useTheme(), so these are light by default and
 * correct in dark without a second palette — the coach app is the same app, not a
 * dark island.
 */

/** One cell of the 2×2 grid: a big number, a label, and optionally a fill meter. */
export function StatTile({
  value,
  label,
  /** 0–1. Draws a thin meter under the value (the fill-rate tile). */
  meter,
}: {
  value: string;
  label: string;
  meter?: number;
}) {
  const { color } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        tile: {
          flex: 1,
          gap: space.xs,
          padding: space.md,
          borderRadius: radius.lg,
          backgroundColor: color.bg.surface,
          borderWidth: 1,
          borderColor: color.border.subtle,
        },
        track: { height: 4, borderRadius: radius.pill, backgroundColor: color.bg.canvas, overflow: 'hidden' },
        fill: { height: 4, borderRadius: radius.pill, backgroundColor: color.accent.default },
      }),
    [color],
  );
  return (
    <View style={styles.tile}>
      <Text variant="h1">{value}</Text>
      {meter !== undefined ? (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round(Math.min(1, Math.max(0, meter)) * 100)}%` }]} />
        </View>
      ) : null}
      <Text variant="micro" tone="muted">
        {label}
      </Text>
    </View>
  );
}

/** A row of vertical bars — the last four weeks of hours. */
export function BarColumns({
  bars,
}: {
  bars: { value: number; caption: string; label: string; highlight?: boolean }[];
}) {
  const { color } = useTheme();
  const peak = Math.max(...bars.map((b) => b.value), 0.0001);
  const styles = useMemo(
    () =>
      StyleSheet.create({
        row: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
        col: { flex: 1, alignItems: 'center', gap: space.xs },
        // A fixed plot height so bars are comparable between renders, and a minimum
        // so a genuine zero still reads as a bar rather than vanishing.
        plot: { height: 88, justifyContent: 'flex-end' },
        bar: { width: 26, borderRadius: radius.sm, minHeight: 4 },
      }),
    [],
  );
  return (
    <View style={styles.row}>
      {bars.map((b, i) => (
        <View key={`${b.label}-${i}`} style={styles.col}>
          <Text variant="caption" weight="bold" tone={b.highlight ? 'accent' : 'secondary'}>
            {b.caption}
          </Text>
          <View style={styles.plot}>
            <View
              style={[
                styles.bar,
                {
                  height: Math.max(4, Math.round((b.value / peak) * 88)),
                  backgroundColor: b.highlight ? color.accent.default : color.border.strong,
                },
              ]}
            />
          </View>
          <Text variant="micro" tone={b.highlight ? 'accent' : 'muted'}>
            {b.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** A labelled horizontal meter — one per session type. */
export function MeterRow({ label, value, fraction }: { label: string; value: string; fraction: number }) {
  const { color } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: { gap: space.xs },
        top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
        track: { height: 6, borderRadius: radius.pill, backgroundColor: color.bg.canvas, overflow: 'hidden' },
        fill: { height: 6, borderRadius: radius.pill, backgroundColor: color.accent.default },
      }),
    [color],
  );
  return (
    <View style={styles.wrap}>
      <View style={styles.top}>
        <Text variant="body">{label}</Text>
        <Text variant="body" weight="bold">
          {value}
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%` }]} />
      </View>
    </View>
  );
}

/** Sessions per day across the current week — seven dots-and-counts. */
export function WeekStrip({ days }: { days: { initial: string; count: number; isToday: boolean }[] }) {
  const { color } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        row: { flexDirection: 'row', gap: space.xs },
        day: { flex: 1, alignItems: 'center', gap: space.xs, paddingVertical: space.xs, borderRadius: radius.sm },
        today: { backgroundColor: color.accent.soft },
      }),
    [color],
  );
  return (
    <View style={styles.row}>
      {days.map((d, i) => (
        <View key={`${d.initial}-${i}`} style={[styles.day, d.isToday ? styles.today : null]}>
          <Text variant="body" weight="bold" tone={d.count > 0 ? 'primary' : 'muted'}>
            {d.count}
          </Text>
          <Text variant="micro" tone={d.isToday ? 'accent' : 'muted'}>
            {d.initial}
          </Text>
        </View>
      ))}
    </View>
  );
}
