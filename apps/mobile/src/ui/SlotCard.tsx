import Ionicons from '@expo/vector-icons/Ionicons';
import { formatSessionTimeRange } from '@tpa/core';
import { color, radius, space } from '@tpa/theme';
import type { Coach, Gender, Level, SessionSlot } from '@tpa/types';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from './Avatar';
import { CapacityDots } from './CapacityDots';
import { Text } from './Text';

export type SlotCardState = 'bookable' | 'full' | 'booked' | 'unavailable';

const GENDER_LABEL: Record<Gender, string> = { men: 'Men', ladies: 'Ladies' };
const LEVEL_LABEL: Record<Level, string> = {
  beginner: 'Beginner',
  adv_beginner: 'Adv. Beginner',
  intermediate: 'Intermediate',
};

/**
 * A bookable session card: coach photo, Cairo time range (via @tpa/core),
 * "Coach {name} · N/M booked", capacity dots, and — for group slots — the
 * gender/level tags. Unbookable states read as unavailable (greyed) and MUST
 * carry a reason: `full` shows a lock+FULL pill; `unavailable` shows the `note`;
 * `booked` shows a Booked pill; `bookable` shows a chevron + which credit is
 * spent. Presentation only — the screen maps availability to state/note. RTL-safe.
 */
export function SlotCard({
  slot,
  coach,
  now,
  state,
  note,
  creditNote,
  onPress,
}: {
  slot: SessionSlot;
  coach: Coach | undefined;
  now: SessionSlot['startsAt'];
  state: SlotCardState;
  note?: string;
  creditNote?: string;
  onPress?: () => void;
}) {
  const bookable = state === 'bookable';
  const isGroup = slot.gender !== null && slot.level !== null;

  const body = (
    <View style={[styles.card, !bookable && styles.dimmed]}>
      <View style={styles.top}>
        <Avatar name={coach?.name ?? 'Coach'} imageUrl={coach?.photoUrl} size={44} />
        <View style={styles.info}>
          <Text variant="body" weight="bold">
            {formatSessionTimeRange(slot.startsAt, slot.endsAt)}
          </Text>
          <Text variant="caption" tone="secondary">
            {`${coach ? `Coach ${coach.name.split(' ')[0]}` : 'Coach'} · ${slot.bookedCount}/${slot.capacity} booked`}
          </Text>
        </View>
        <StatusPill state={state} note={note} />
      </View>

      <View style={styles.bottom}>
        {isGroup ? (
          <Text variant="micro" tone="muted">
            {`${GENDER_LABEL[slot.gender as Gender]} · ${LEVEL_LABEL[slot.level as Level]}`}
          </Text>
        ) : (
          <View />
        )}
        <CapacityDots booked={slot.bookedCount} capacity={slot.capacity} muted={!bookable} />
      </View>

      {bookable && creditNote ? (
        <Text variant="caption" tone="accent" style={styles.creditNote}>
          {creditNote}
        </Text>
      ) : null}
    </View>
  );

  if (bookable && onPress) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button">
        {({ pressed }) => <View style={pressed ? styles.pressed : undefined}>{body}</View>}
      </Pressable>
    );
  }
  return body;
}

function StatusPill({ state, note }: { state: SlotCardState; note?: string }) {
  if (state === 'bookable') {
    return <Ionicons name="chevron-forward" size={20} color={color.text.muted} />;
  }
  if (state === 'full') {
    return (
      <View style={[styles.pill, styles.pillOutline]}>
        <Ionicons name="lock-closed" size={12} color={color.text.secondary} />
        <Text variant="micro" tone="secondary">
          Full
        </Text>
      </View>
    );
  }
  if (state === 'booked') {
    return (
      <View style={[styles.pill, { backgroundColor: color.status.success }]}>
        <Ionicons name="checkmark" size={12} color={color.text.inverse} />
        <Text variant="micro" tone="inverse">
          Booked
        </Text>
      </View>
    );
  }
  return (
    <View style={[styles.pill, styles.pillOutline]}>
      <Text variant="micro" tone="secondary">
        {note ?? 'Unavailable'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.bg.surface,
    borderColor: color.border.subtle,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.md,
  },
  dimmed: { opacity: 0.6 },
  pressed: { opacity: 0.85 },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  info: { flex: 1, gap: 2 },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  creditNote: {},
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderRadius: radius.pill,
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
  },
  pillOutline: { borderWidth: 1, borderColor: color.border.strong, backgroundColor: color.bg.surface },
});
