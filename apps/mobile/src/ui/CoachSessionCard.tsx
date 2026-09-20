import { formatSessionTimeRange, isSessionConfirmed } from '@tpa/core';
import { radius, space } from '@tpa/theme';
import type { IsoInstant, SessionSlot } from '@tpa/types';
import { Pressable, StyleSheet, View } from 'react-native';
import { useMemo } from 'react';

import { useTheme } from '../theme/ThemeProvider';
import { Badge } from './Badge';
import { CapacityMeter } from './CapacityMeter';
import { Text } from './Text';
import { LEVEL_LABEL, trainingMetaFor } from './trainingMeta';

/**
 * One of the coach's own sessions, as it appears on their Schedule.
 *
 * Deliberately NOT `SlotCard`: that card is built for a player deciding whether to
 * book — bookable states, credit notes, the coach's name. A coach needs the
 * opposite facts (how many are coming, is it going ahead) and already knows who is
 * teaching it. Everything below it is shared — Card surface, CapacityMeter, Badge,
 * the training meta and the theme — so it is the same app, not a second design.
 *
 * `variant="hero"` is the next/current session at the top of the Schedule: bigger
 * type and an accent border, because it is the one thing a coach opens the app for.
 */
export function CoachSessionCard({
  slot,
  variant = 'row',
  eyebrow,
  onPress,
}: {
  slot: SessionSlot;
  variant?: 'hero' | 'row';
  /** "On court now" / "in 25 minutes" — supplied by the screen. */
  eyebrow?: string;
  onPress?: () => void;
}) {
  const { color } = useTheme();
  const hero = variant === 'hero';
  const meta = trainingMetaFor(slot.trainingType);
  const confirmed = isSessionConfirmed(slot);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          gap: space.sm,
          padding: hero ? space.lg : space.md,
          borderRadius: hero ? radius.xl : radius.lg,
          backgroundColor: color.bg.surface,
          borderWidth: 1,
          borderColor: hero ? color.accent.default : color.border.subtle,
        },
        pressed: { opacity: 0.85 },
        topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
        badges: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexWrap: 'wrap' },
        bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
      }),
    [color, hero],
  );

  const body = (
    <View style={styles.card}>
      {eyebrow ? (
        <Text variant="label" tone={hero ? 'accent' : 'label'}>
          {eyebrow}
        </Text>
      ) : null}

      <View style={styles.topRow}>
        <Text variant={hero ? 'h1' : 'h2'}>{formatSessionTimeRange(slot.startsAt, slot.endsAt)}</Text>
        <Badge
          label={confirmed ? 'Confirmed' : 'Pending'}
          tone={confirmed ? 'success' : 'warning'}
        />
      </View>

      <View style={styles.badges}>
        <Badge label={meta.label} tone="neutral" icon={meta.icon} />
        {slot.level ? <Badge label={LEVEL_LABEL[slot.level]} tone="neutral" /> : null}
      </View>

      <View style={styles.bottomRow}>
        <Text variant="bodySecondary">
          {slot.bookedCount} of {slot.capacity} booked
        </Text>
        <CapacityMeter booked={slot.bookedCount} capacity={slot.capacity} />
      </View>
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Session at ${formatSessionTimeRange(slot.startsAt, slot.endsAt)}, ${slot.bookedCount} of ${slot.capacity} booked`}
      style={({ pressed }) => (pressed ? styles.pressed : null)}
    >
      {body}
    </Pressable>
  );
}
