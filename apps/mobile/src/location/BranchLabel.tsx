import Ionicons from '@expo/vector-icons/Ionicons';
import { space } from '@tpa/theme';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui';
import { useLocation } from './LocationProvider';

/**
 * A quiet "which branch" line for a row that could be at any of them — session
 * cards, purchase history.
 *
 * ── it hides itself with one branch ──
 * Same rule as the toggle. An academy with a single location would otherwise get
 * the same place name stamped on every row, which is clutter that says nothing.
 * The moment a second branch opens, every one of these rows starts answering a
 * question that has just become real.
 */
export function BranchLabel({ name }: { name: string | null | undefined }) {
  const { color } = useTheme();
  const { showToggle } = useLocation();
  if (!showToggle || !name) return null;
  return (
    <View style={styles.row}>
      <Ionicons name="location-outline" size={12} color={color.text.muted} />
      <Text variant="caption" tone="muted">
        {name}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
});
