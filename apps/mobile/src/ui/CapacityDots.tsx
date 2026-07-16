import { color, radius } from '@tpa/theme';
import { StyleSheet, View } from 'react-native';

/**
 * Occupancy dots for a slot: `capacity` dots, the first `booked` filled. Filled =
 * accent (or muted when the slot is unavailable), empty = subtle. RTL-safe (a
 * plain row). Capped so a huge capacity can't overflow the card.
 */
export function CapacityDots({
  booked,
  capacity,
  muted = false,
}: {
  booked: number;
  capacity: number;
  muted?: boolean;
}) {
  const total = Math.min(capacity, 8);
  const filledColor = muted ? color.text.muted : color.accent.default;
  return (
    <View style={styles.row}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[styles.dot, { backgroundColor: i < booked ? filledColor : color.border.subtle }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
});
