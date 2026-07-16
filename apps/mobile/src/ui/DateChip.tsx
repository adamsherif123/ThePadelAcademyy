import { color, radius, space } from '@tpa/theme';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from './Text';

const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * A day cell in the Book date strip. Open + selected = navy fill; open =
 * white card; closed = dashed, greyed, with a CLOSED label. Closed days are not
 * pressable. RTL-safe.
 */
export function DateChip({
  weekday,
  dayNumber,
  selected = false,
  closed = false,
  onPress,
}: {
  weekday: number;
  dayNumber: number;
  selected?: boolean;
  closed?: boolean;
  onPress?: () => void;
}) {
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
      ) : null}
    </View>
  );

  if (closed || !onPress) return content;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
});
