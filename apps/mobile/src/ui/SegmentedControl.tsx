import { color, radius, space } from '@tpa/theme';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from './Text';

/**
 * Two-plus segment control with a navy selected pill on a light track
 * (Upcoming / Past). Generic over the option value. RTL-safe: a flex row.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.track}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={[styles.segment, selected && styles.segmentSelected]}
          >
            <Text
              variant="caption"
              weight="bold"
              tone={selected ? 'inverse' : 'secondary'}
              style={styles.label}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: color.bg.canvas,
    borderColor: color.border.subtle,
    borderWidth: 1,
    borderRadius: radius.pill,
    padding: space.xs,
    gap: space.xs,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.sm,
    borderRadius: radius.pill,
  },
  segmentSelected: { backgroundColor: color.bg.inverse },
  label: { textTransform: 'uppercase', letterSpacing: 0.4 },
});
