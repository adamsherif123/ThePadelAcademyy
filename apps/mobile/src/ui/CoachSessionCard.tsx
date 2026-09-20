import { formatInstantDate, formatInstantTime, isSessionConfirmed } from '@tpa/core';
import { radius, space } from '@tpa/theme';
import type { SessionSlot } from '@tpa/types';
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
 * teaching it. Everything below it is shared — the surface, CapacityMeter, Badge,
 * the training meta and the theme — so it is the same app, not a second design.
 *
 * LAYOUT RULE: the status pill NEVER shares a row with the time. The time is the
 * largest text on the card and a long range wraps to two lines, which pushed the
 * pill off the card's edge entirely. So the pill rides the small meta row — beside
 * the eyebrow on the hero, beside the date on a row — and the time gets the full
 * width to itself.
 *
 * `variant="hero"` is the next or current session at the top of the Schedule:
 * bigger time and an accent border, because it is the one thing a coach opens the
 * app for.
 */
export function CoachSessionCard({
  slot,
  variant = 'row',
  eyebrow,
  showDate = true,
  onPress,
}: {
  slot: SessionSlot;
  variant?: 'hero' | 'row';
  /** "On court now" / "Starts in 25 minutes" — supplied by the screen. */
  eyebrow?: string;
  /** False inside a "Later today" group, where repeating the date is noise. */
  showDate?: boolean;
  onPress?: () => void;
}) {
  const { color } = useTheme();
  const hero = variant === 'hero';
  const meta = trainingMetaFor(slot.trainingType);
  const confirmed = isSessionConfirmed(slot);
  const time = `${formatInstantTime(slot.startsAt)} – ${formatInstantTime(slot.endsAt)}`;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          gap: hero ? space.sm : space.xs,
          padding: hero ? space.lg : space.md,
          borderRadius: hero ? radius.xl : radius.lg,
          backgroundColor: color.bg.surface,
          borderWidth: 1,
          borderColor: hero ? color.accent.default : color.border.subtle,
        },
        pressed: { opacity: 0.85 },
        // The pill's row. `flex: 1` on the text and no shrink on the pill is what
        // keeps the pill inside the card when the left side runs long.
        metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
        metaText: { flex: 1 },
        tags: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexWrap: 'wrap' },
        divider: { height: 1, backgroundColor: color.border.subtle, marginTop: space.xs },
        footRow: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space.sm,
          marginTop: space.xs,
        },
      }),
    [color, hero],
  );

  const statusPill = (
    <Badge label={confirmed ? 'Confirmed' : 'Pending'} tone={confirmed ? 'success' : 'warning'} />
  );

  const body = (
    <View style={styles.card}>
      {/* Meta row: eyebrow (hero) or date (row), with the status pill pinned right. */}
      <View style={styles.metaRow}>
        <View style={styles.metaText}>
          {hero ? (
            eyebrow ? (
              <Text variant="label" tone="accent">
                {eyebrow}
              </Text>
            ) : null
          ) : showDate ? (
            <Text variant="caption" tone="secondary">
              {formatInstantDate(slot.startsAt)}
            </Text>
          ) : null}
        </View>
        {statusPill}
      </View>

      {/* The time owns its own full-width line — it can wrap without displacing anything. */}
      <Text variant={hero ? 'h1' : 'h2'}>{time}</Text>

      {hero && showDate ? (
        <Text variant="bodySecondary">{formatInstantDate(slot.startsAt)}</Text>
      ) : null}

      <View style={styles.tags}>
        <Badge label={meta.label} tone="neutral" icon={meta.icon} />
        {slot.level ? <Badge label={LEVEL_LABEL[slot.level]} tone="neutral" /> : null}
      </View>

      <View style={styles.divider} />

      <View style={styles.footRow}>
        <Text variant="bodySecondary">
          {slot.bookedCount} of {slot.capacity} booked
        </Text>
        {/* No "N spots left" — that is an invitation to book, which is a player's
            card's job. The count on the left already says it, for a coach. */}
        <CapacityMeter booked={slot.bookedCount} capacity={slot.capacity} showLabel={false} />
      </View>
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Session ${time}, ${slot.bookedCount} of ${slot.capacity} booked, ${confirmed ? 'confirmed' : 'pending'}`}
      style={({ pressed }) => (pressed ? styles.pressed : null)}
    >
      {body}
    </Pressable>
  );
}
