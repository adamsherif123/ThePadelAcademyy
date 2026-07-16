import Ionicons from '@expo/vector-icons/Ionicons';
import { color, radius, space } from '@tpa/theme';
import type { TrainingType } from '@tpa/types';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from './Text';
import { TRAINING_META } from './trainingMeta';

/**
 * A training-type card for the Book selector grid. Shows the type, a subtitle
 * (player count / description) and the player's usable credit count — "N credits",
 * or a greyed "No credits" at zero. Selected = royal border + tinted background.
 * Credit count is passed in (from wallet selectors); never hardcoded here.
 * RTL-safe.
 */
export function TypeCard({
  trainingType,
  subtitle,
  credits,
  selected = false,
  onPress,
}: {
  trainingType: TrainingType;
  subtitle: string;
  credits: number;
  selected?: boolean;
  onPress?: () => void;
}) {
  const meta = TRAINING_META[trainingType];
  const hasCredits = credits > 0;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.base, selected ? styles.selected : styles.unselected]}
    >
      <Ionicons
        name={meta.icon}
        size={22}
        color={selected ? color.accent.default : color.text.primary}
      />
      <View style={styles.text}>
        <Text variant="label" tone={selected ? 'accent' : 'primary'}>
          {meta.label}
        </Text>
        <Text variant="caption" tone="secondary">
          {subtitle}
        </Text>
      </View>
      <Text variant="caption" weight="bold" tone={hasCredits ? 'accent' : 'muted'}>
        {hasCredits ? `${credits} credit${credits === 1 ? '' : 's'}` : 'No credits'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flex: 1,
    minHeight: 128,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: space.lg,
    justifyContent: 'space-between',
    gap: space.sm,
  },
  unselected: { backgroundColor: color.bg.surface, borderColor: color.border.subtle },
  selected: { backgroundColor: color.bg.canvas, borderColor: color.accent.default },
  text: { gap: 2 },
});
