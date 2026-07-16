import Ionicons from '@expo/vector-icons/Ionicons';
import { color, radius, space } from '@tpa/theme';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from './Text';
import type { IoniconName } from './trainingMeta';

/**
 * A navigation row card: icon chip + title + subtitle + trailing chevron (the
 * Profile links — Wallet / Purchase history / Meet the coaches). RTL-safe: the
 * chevron uses a logical forward icon, leading icon via row + gap.
 */
export function LinkRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: IoniconName;
  title: string;
  subtitle?: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.iconChip}>
        <Ionicons name={icon} size={20} color={color.accent.default} />
      </View>
      <View style={styles.text}>
        <Text variant="body" weight="bold">
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="secondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={20} color={color.text.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: color.bg.surface,
    borderColor: color.border.subtle,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.lg,
  },
  pressed: { opacity: 0.7 },
  iconChip: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: color.bg.canvas,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
});
