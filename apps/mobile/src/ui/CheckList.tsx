import Ionicons from '@expo/vector-icons/Ionicons';
import { color, space } from '@tpa/theme';
import { StyleSheet, View } from 'react-native';

import { Text } from './Text';

/**
 * A "what's included" checklist — royal check-circles + text. RTL-safe: leading
 * icon via row + gap.
 */
export function CheckList({ items }: { items: string[] }) {
  return (
    <View style={styles.list}>
      {items.map((item) => (
        <View key={item} style={styles.row}>
          <Ionicons name="checkmark-circle" size={20} color={color.accent.default} />
          <Text variant="body" style={styles.text}>
            {item}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  text: { flex: 1 },
});
