import { color, radius } from '@tpa/theme';
import { StyleSheet, View } from 'react-native';

/**
 * Royal fill on a light track (wallet batch progress). `tone='muted'` renders the
 * greyed bar used for expired batches. `value` is a 0–1 fraction (clamped).
 * RTL-safe: the fill grows from the inline-start via flex, not a physical edge.
 */
export function ProgressBar({
  value,
  tone = 'accent',
}: {
  value: number;
  tone?: 'accent' | 'muted';
}) {
  const clamped = Math.max(0, Math.min(1, value));
  const fillColor = tone === 'muted' ? color.text.muted : color.accent.default;
  return (
    <View style={styles.track}>
      <View style={{ flex: clamped }}>
        <View style={[styles.fill, { backgroundColor: fillColor }]} />
      </View>
      <View style={{ flex: 1 - clamped }} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: color.border.subtle,
    overflow: 'hidden',
  },
  fill: { flex: 1, borderRadius: radius.pill },
});
