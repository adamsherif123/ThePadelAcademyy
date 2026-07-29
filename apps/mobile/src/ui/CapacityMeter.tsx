import Ionicons from '@expo/vector-icons/Ionicons';
import { color } from '@tpa/theme';
import { StyleSheet, View } from 'react-native';

import { Text } from './Text';

/**
 * Player-fill occupancy (replaces CapacityDots, Task C): one person glyph per
 * seat — filled for taken, outline for open — plus an explicit "N spots left" /
 * "Full" label, so occupancy is legible as a number, not just a shape to count.
 * Capped at 8 icons like the dots were, so a large capacity can't overflow the
 * card; the label always states the REAL remaining count regardless of the cap.
 * Taken seats read `color.status.success` (each one is progress toward the
 * session running); open seats and the "spots left" label read
 * `color.text.muted` / `color.accent.default`; `muted` (an unavailable card)
 * flattens everything to `color.text.muted`, matching CapacityDots' own
 * muted behaviour. RTL-safe (a plain row).
 */
export function CapacityMeter({
  booked,
  capacity,
  muted = false,
}: {
  booked: number;
  capacity: number;
  muted?: boolean;
}) {
  const total = Math.min(capacity, 8);
  const remaining = Math.max(0, capacity - booked);
  const full = remaining <= 0;
  const filledColor = muted ? color.text.muted : color.status.success;
  const outlineColor = color.text.muted;
  const label = full ? 'Full' : `${remaining} spot${remaining === 1 ? '' : 's'} left`;
  const labelColor = muted ? color.text.muted : full ? color.status.success : color.accent.default;

  return (
    <View style={styles.row}>
      <View style={styles.icons}>
        {Array.from({ length: total }).map((_, i) => (
          <Ionicons
            key={i}
            name={i < booked ? 'person' : 'person-outline'}
            size={14}
            color={i < booked ? filledColor : outlineColor}
          />
        ))}
      </View>
      <Text variant="micro" style={{ color: labelColor }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  icons: { flexDirection: 'row', gap: 2 },
});
