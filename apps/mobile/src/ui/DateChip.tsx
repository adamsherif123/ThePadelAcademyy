import { radius, space } from '@tpa/theme';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * A day cell in the Book date strip. Open + selected = navy fill; open =
 * white card; closed = dashed, greyed, with a CLOSED label. The status line
 * reads simply "Open" or "Closed" — no seat count: the strip answers "can I
 * come that day", and the exact room is a per-session matter the feed below
 * states properly. `spots` (booking.ts's `dateStrip`/`daySpots`) still tints
 * that label — accent when the day has room, muted when it has none — so the
 * strip keeps its at-a-glance hint without putting a number on it. Closed days
 * are not pressable. RTL-safe.
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
  /** Not displayed as a number — only tints the "Open" label. Ignored when
   * `closed`; pass 0 for a closed day. */
  spots: number;
  selected?: boolean;
  closed?: boolean;
  onPress?: () => void;
}) {
  const { color } = useTheme();
  const styles = useMemo(
    () => StyleSheet.create({
      base: {
        width: 64,
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
        <Text variant="micro" tone="muted">
          Closed
        </Text>
      ) : (
        <Text variant="micro" tone={selected ? 'inverse' : spots > 0 ? 'accent' : 'muted'}>
          Open
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
