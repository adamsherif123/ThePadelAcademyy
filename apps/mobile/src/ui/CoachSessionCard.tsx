import { formatInstantDate, formatInstantTime, isSessionConfirmed } from '@tpa/core';
import { radius, space } from '@tpa/theme';
import type { SessionSlot } from '@tpa/types';
import { Pressable, StyleSheet, View } from 'react-native';
import { useMemo } from 'react';

import { shadow } from '../theme/shadow';
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
  dimmed = false,
  onPress,
}: {
  slot: SessionSlot;
  variant?: 'hero' | 'row';
  /** "On court now" / "Starts in 25 minutes" — supplied by the screen. */
  eyebrow?: string;
  /** False inside a day group, where repeating that day's date is noise. */
  showDate?: boolean;
  /** A session that has already finished — still worth seeing, visibly past. */
  dimmed?: boolean;
  onPress?: () => void;
}) {
  const { color } = useTheme();
  const hero = variant === 'hero';
  const meta = trainingMetaFor(slot.trainingType);
  const confirmed = isSessionConfirmed(slot);
  // "5:00 – 6:00 PM", not "5:00 PM – 6:00 PM". Repeating the meridiem is noise
  // when both ends share it, and dropping it buys back most of a line's width.
  const from = formatInstantTime(slot.startsAt);
  const to = formatInstantTime(slot.endsAt);
  const suffix = from.slice(-2);
  const time = to.endsWith(suffix) ? `${from.slice(0, -3)} – ${to}` : `${from} – ${to}`;

  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          gap: space.xs,
          padding: space.md,
          borderRadius: radius.lg,
          backgroundColor: color.bg.surface,
          // The hero used to be outlined in accent blue, which read as a selected
          // state rather than an important one. It is lifted instead: a real
          // shadow, and the same hairline every other card has.
          //
          // The hairline STAYS under the shadow deliberately. `shadow()` is not
          // theme-reactive (a shadow is a dark tint whatever the scheme), so on the
          // dark canvas it is nearly invisible — without the border the card would
          // lose its edge entirely in dark mode.
          ...shadow(hero ? 'md' : 'card'),
          borderWidth: 1,
          borderColor: color.border.subtle,
        },
        pressed: { opacity: 0.85 },
        dimmed: { opacity: 0.6 },
        // The pill's row. `flex: 1` on the text and no shrink on the pill is what
        // keeps the pill inside the card when the left side runs long.
        metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
        metaText: { flex: 1 },
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

  // Nothing to say on the left (an upcoming row inside a day group, where the date
  // is already the group's heading) renders NOTHING — an empty Text would still
  // take a line's height and leave a gap under the pill.
  const metaLeft = eyebrow ?? (showDate ? formatInstantDate(slot.startsAt) : '');

  const body = (
    <View style={[styles.card, dimmed ? styles.dimmed : null]}>
      {/* 1 and 2 — when it is, and whether it is going ahead.
          The pill needs a row; the text beside it does not always exist. An
          upcoming session inside a day group has nothing to say on the left (the
          date is the group's heading), and giving the pill a row to itself left an
          empty column above the time — a gap that read as a mistake. So in that
          case the pill rides the TIME's row instead, and the card closes up.
          The time still takes the remaining width and the pill never shrinks, so a
          long range wraps inside its own column rather than pushing the pill out —
          the rule that put them on separate rows in the first place. */}
      {metaLeft ? (
        <>
          <View style={styles.metaRow}>
            <View style={styles.metaText}>
              <Text variant="caption" weight="semibold" tone={dimmed ? 'muted' : hero ? 'accent' : 'secondary'}>
                {metaLeft}
              </Text>
            </View>
            {statusPill}
          </View>
          <Text variant={hero ? 'h2' : 'body'} weight="bold">
            {time}
          </Text>
        </>
      ) : (
        <View style={styles.metaRow}>
          <Text variant={hero ? 'h2' : 'body'} weight="bold" style={styles.metaText}>
            {time}
          </Text>
          {statusPill}
        </View>
      )}

      {/* 3 — everything else about it on ONE line. The type and level were a row of
          chips each; as text beside the date they cost nothing and read faster. */}
      <Text variant="caption" tone="muted">
        {[eyebrow && showDate ? formatInstantDate(slot.startsAt) : null, meta.label, slot.level ? LEVEL_LABEL[slot.level] : null]
          .filter(Boolean)
          .join(' · ')}
      </Text>

      {/* 4 — occupancy. No divider above it: the line was drawing a box around four
          short rows that already read as one block. */}
      <View style={styles.footRow}>
        <Text variant="caption" tone="secondary">
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
