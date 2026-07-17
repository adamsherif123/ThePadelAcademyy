import Ionicons from '@expo/vector-icons/Ionicons';
import { formatInstantDate, formatInstantTime, isSessionConfirmed } from '@tpa/core';
import { color, radius, space } from '@tpa/theme';
import type { BookingStatus, Coach, Gender, IsoInstant, Level, SessionSlot } from '@tpa/types';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { ACADEMY } from './AcademyCard';
import { Avatar } from './Avatar';
import { Badge, type BadgeTone } from './Badge';
import { Button } from './Button';
import { InfoCard } from './InfoCard';
import { Text } from './Text';
import { GENDER_LABEL, LEVEL_LABEL, TRAINING_META } from './trainingMeta';

/** Past-status pill copy + tone. `booked` only appears if a past slot was never marked. */
const PAST_STATUS: Record<BookingStatus, { label: string; tone: BadgeTone }> = {
  attended: { label: 'Attended', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  no_show: { label: 'No-show', tone: 'warning' },
  booked: { label: 'Booked', tone: 'neutral' },
};

type BookingCardProps = {
  slot: SessionSlot;
  coach: Coach | undefined;
} & (
  | {
      /** Future court time: green/red cancellation strip + a CANCEL BOOKING button. */
      variant: 'upcoming';
      /** Whether cancelling now refunds the credit (computed by the screen via @tpa/core). */
      refundable: boolean;
      /** The refund deadline instant (cancellationDeadline), rendered via @tpa/core. */
      deadline: IsoInstant;
      onCancel: () => void;
    }
  | {
      /** History: a status pill (attended / cancelled / no-show), no actions. */
      variant: 'past';
      status: BookingStatus;
    }
  /** Read-only summary (the cancel screen) — header + location, type pill, no footer. */
  | { variant: 'detail' }
);

/**
 * A booked session, for the Sessions tab. Header (coach photo, Cairo date/time,
 * type pill, coach + group tags, location) is shared; the footer differs by
 * variant: upcoming shows the cancellation status strip and CANCEL button, past
 * shows a status pill. Presentation only — the screen supplies the refundable
 * verdict and deadline (from @tpa/core). RTL-safe / tokens only.
 */
export function BookingCard(props: BookingCardProps) {
  const { slot, coach } = props;
  const meta = TRAINING_META[slot.trainingType];
  const isGroup = slot.gender !== null && slot.level !== null;
  const coachLine = coach ? `with ${coach.name}` : 'Academy coach';
  const groupTags = isGroup
    ? ` · ${GENDER_LABEL[slot.gender as Gender]} · ${LEVEL_LABEL[slot.level as Level]}`
    : '';

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <Avatar name={coach?.name ?? 'Coach'} imageUrl={coach?.photoUrl} size={44} />
        <View style={styles.info}>
          <Text variant="body" weight="bold">
            {`${formatInstantDate(slot.startsAt)} · ${formatInstantTime(slot.startsAt)}`}
          </Text>
          <Text variant="caption" tone="secondary">
            {`${coachLine}${groupTags}`}
          </Text>
        </View>
        {props.variant === 'past' ? (
          <Badge label={PAST_STATUS[props.status].label} tone={PAST_STATUS[props.status].tone} />
        ) : (
          <Badge label={meta.label} icon={meta.icon} />
        )}
      </View>

      <Pressable style={styles.locationRow} onPress={() => Linking.openURL(ACADEMY.mapsUrl)}>
        <Ionicons name="location-outline" size={15} color={color.text.muted} />
        <Text variant="caption" tone="muted" style={styles.locationText}>
          {ACADEMY.locationLine}
        </Text>
        <Ionicons name="chevron-forward" size={13} color={color.text.muted} />
      </Pressable>

      {props.variant === 'upcoming' ? (
        <>
          {/* One chip carries the fill count AND the state (S11.1). Cap-1 sessions
              (individual/trial) confirm on the first booking — a chip there is
              noise, so suppress it. Otherwise: pending shows why (${N}/${M} joined,
              amber); confirmed-and-full is just "Confirmed"; confirmed-below-cap
              (admin locked it early) keeps the count. Honest — no notification
              promise (the app can't send one). */}
          {slot.capacity <= 1 ? null : !isSessionConfirmed(slot) ? (
            <Badge
              label={`${slot.bookedCount}/${slot.capacity} joined`}
              tone="warning"
              icon="people-outline"
            />
          ) : slot.bookedCount >= slot.capacity ? (
            <Badge label="Confirmed" tone="success" icon="checkmark-circle-outline" />
          ) : (
            <Badge
              label={`Confirmed · ${slot.bookedCount}/${slot.capacity}`}
              tone="success"
              icon="checkmark-circle-outline"
            />
          )}
          {props.refundable ? (
            <InfoCard
              variant="success"
              size="sm"
              text={`Free cancellation until ${formatInstantTime(props.deadline)}`}
            />
          ) : (
            <InfoCard
              variant="danger"
              size="sm"
              text="Inside 3-hour window — cancelling now forfeits your credit"
            />
          )}
          <View style={styles.cancelRow}>
            <Button
              label="Cancel booking"
              size="sm"
              fullWidth={false}
              variant="secondary"
              destructive
              onPress={props.onCancel}
            />
          </View>
        </>
      ) : null}
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
  top: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  info: { flex: 1, gap: 2 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  locationText: { textDecorationLine: 'underline' },
  cancelRow: { flexDirection: 'row', justifyContent: 'flex-end' },
});
