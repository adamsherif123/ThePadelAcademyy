import { radius, space } from '@tpa/theme';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * A day cell in the Book date strip. Open + selected = navy fill; open =
 * white card; closed = dashed, greyed.
 *
 * The status line has THREE states, because "the academy is shut" and "we're open
 * but there is nothing left to book" are different answers and only one of them is
 * worth coming back later for:
 *
 *   Closed    — the academy isn't running that day.
 *   Open      — there is room to book, in accent so the strip reads at a glance.
 *   No slots  — the day is running, but nothing on it is bookable: every session
 *               is full, or none is scheduled yet.
 *
 * Still no seat COUNT: the strip answers "can I come that day", and the exact room
 * is a per-session matter the feed below states properly. `spots` (booking.ts's
 * `dateStrip`/`daySpots`) is what separates the middle two. A day with no room is
 * still pressable — the feed explains why. Closed days are not. RTL-safe.
 */
export function DateChip({
  weekday,
  dayNumber,
  spots,
  selected = false,
  closed = false,
  onPress,
}: {
  weekday: number;
  dayNumber: number;
  /** Never displayed as a number — it chooses between "Open" and "No slots", and
   * tints the former. Ignored when `closed`; pass 0 for a closed day. */
  spots: number;
  selected?: boolean;
  closed?: boolean;
  onPress?: () => void;
}) {
  const { color } = useTheme();
  const styles = useMemo(
    () => StyleSheet.create({
      base: {
        // 72, not 64: "No slots" is the longest status the chip carries and needs
        // ~59px at micro's size and tracking, which 64 left no headroom for — it
        // wrapped, making those days taller than their neighbours and breaking the
        // strip's baseline. The width gives it room; `numberOfLines` on each status
        // below guarantees a single line whatever a device's font metrics do.
        width: 72,
        borderRadius: radius.md,
        borderWidth: 1,
        paddingVertical: space.md,
        alignItems: 'center',
        gap: 2,
      },
      open: { backgroundColor: color.bg.surface, borderColor: color.border.subtle },
      selected: { backgroundColor: color.bg.inverse, borderColor: color.bg.inverse },
      closed: { backgroundColor: color.bg.canvas, borderColor: color.border.subtle, borderStyle: 'dashed' },
    }),
    [color],
  );
  const abbr = WEEKDAY_ABBR[weekday] ?? '';

  const content = (
    <View
      style={[
        styles.base,
        closed ? styles.closed : selected ? styles.selected : styles.open,
      ]}
    >
      <Text variant="micro" tone={selected ? 'inverse' : 'muted'}>
        {abbr}
      </Text>
      <Text variant="h2" tone={selected ? 'inverse' : closed ? 'muted' : 'primary'}>
        {String(dayNumber)}
      </Text>
      {closed ? (
        <Text variant="micro" tone="muted" numberOfLines={1}>
          Closed
        </Text>
      ) : spots > 0 ? (
        <Text variant="micro" tone={selected ? 'inverse' : 'accent'} numberOfLines={1}>
          Open
        </Text>
      ) : (
        <Text variant="micro" tone={selected ? 'inverse' : 'muted'} numberOfLines={1}>
          No slots
        </Text>
      )}
    </View>
  );

  if (closed || !onPress) return content;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }}>
      {content}
    </Pressable>
  );
}
