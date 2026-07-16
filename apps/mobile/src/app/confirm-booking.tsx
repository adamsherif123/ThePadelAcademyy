import { CANCELLATION_WINDOW_HOURS, formatInstantDate, formatInstantTime } from '@tpa/core';
import { color, space } from '@tpa/theme';
import type { Gender, Level, SlotId } from '@tpa/types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { bookSlot, bookingPreview } from '../data/booking';
import { useDataStore } from '../data/store';
import { useSession } from '../session/SessionProvider';
import {
  ACADEMY,
  Avatar,
  Badge,
  Button,
  Card,
  CreditCallout,
  IconRow,
  InfoCard,
  Screen,
  ScreenHeader,
  Text,
  TRAINING_META,
  batchLabel,
} from '../ui';

const GENDER_LABEL: Record<Gender, string> = { men: 'Men', ladies: 'Ladies' };
const LEVEL_LABEL: Record<Level, string> = {
  beginner: 'Beginner',
  adv_beginner: 'Adv. Beginner',
  intermediate: 'Intermediate',
};

const UNBOOKABLE_MESSAGE: Record<string, string> = {
  slot_full: 'This session just filled up. Pick another slot.',
  slot_in_past: 'This session has already started.',
  slot_cancelled: 'This session was cancelled.',
  gender_mismatch: "This session isn't for your group.",
  level_mismatch: "This session isn't for your level.",
  no_usable_credit: 'You no longer have a usable credit for this session.',
};

/** 12 — Confirm booking. Read-through preview + the credit-spend confirmation. */
export default function ConfirmBookingScreen() {
  const router = useRouter();
  const { player, now } = useSession();
  useDataStore();
  const { slotId } = useLocalSearchParams<{ slotId: string }>();
  if (!player) return null;

  const preview = bookingPreview(player, slotId as SlotId, now);
  if (!preview) {
    return (
      <Screen>
        <ScreenHeader eyebrow="Confirm" title="Not Found" onBack={() => router.back()} />
        <Text variant="body" tone="secondary" style={styles.pad}>
          This session is no longer available.
        </Text>
      </Screen>
    );
  }

  const { slot, coach, verdict, batch, typeBalance, alreadyBooked } = preview;
  const meta = TRAINING_META[slot.trainingType];
  const isGroup = slot.gender !== null && slot.level !== null;
  const canConfirm = verdict.ok && batch !== undefined && !alreadyBooked;
  const leftAfter = typeBalance - 1;

  const onConfirm = () => {
    const res = bookSlot(player, slot.id, now);
    if (res.ok) {
      router.replace({ pathname: '/booked-success', params: { bookingId: res.booking.id } });
    }
    // On !ok the store is untouched; useDataStore re-render shows the unbookable guard.
  };

  return (
    <Screen
      scroll
      contentContainerStyle={styles.content}
      footer={<Button label="Confirm booking" disabled={!canConfirm} onPress={onConfirm} />}
    >
      <ScreenHeader
        eyebrow={`${meta.label} session`}
        title="Confirm Booking"
        onBack={() => router.back()}
      />

      {/* Coach + details */}
      <Card>
        <View style={styles.coachRow}>
          <Avatar name={coach?.name ?? 'Coach'} imageUrl={coach?.photoUrl} size={52} />
          <View style={styles.coachInfo}>
            <Text variant="body" weight="bold">
              {coach?.name ?? 'Academy coach'}
            </Text>
            <Text variant="caption" tone="secondary">
              {coach?.bio ?? 'Academy coaching'}
            </Text>
          </View>
          <Badge label={meta.label} icon={meta.icon} />
        </View>

        <View style={styles.divider} />

        <View style={styles.rows}>
          <IconRow chip icon="calendar-outline" label="Date" value={formatInstantDate(slot.startsAt)} />
          <IconRow
            chip
            icon="time-outline"
            label="Time"
            value={`${formatInstantTime(slot.startsAt)} – ${formatInstantTime(slot.endsAt)}`}
          />
          <IconRow
            chip
            icon="location-outline"
            label="Location"
            value={`${ACADEMY.name} · Rehab, Cairo`}
          />
        </View>

        <View style={styles.tags}>
          {isGroup ? (
            <>
              <Badge label={GENDER_LABEL[slot.gender as Gender]} />
              <Badge label={LEVEL_LABEL[slot.level as Level]} />
            </>
          ) : null}
          <Badge label={`${slot.bookedCount}/${slot.capacity} booked`} />
        </View>
      </Card>

      {/* Credit callout — or the unbookable guard */}
      {canConfirm && batch ? (
        <CreditCallout
          headline={`This will use 1 ${meta.label} credit`}
          detail={`You'll have ${leftAfter} ${meta.label} credit${leftAfter === 1 ? '' : 's'} left after booking.`}
          source={batchLabel(batch)}
          expiresAt={batch.expiresAt}
          now={now}
        />
      ) : (
        <InfoCard
          variant="amber"
          icon="alert-circle-outline"
          text={
            alreadyBooked
              ? "You've already booked this session."
              : verdict.ok
                ? 'This session is unavailable.'
                : (UNBOOKABLE_MESSAGE[verdict.reason] ?? 'This session is unavailable.')
          }
        />
      )}

      {/* Cancellation policy */}
      <InfoCard
        variant="neutral"
        icon="time-outline"
        text={`Cancel up to ${CANCELLATION_WINDOW_HOURS} hours before the session and your credit is refunded automatically. Inside ${CANCELLATION_WINDOW_HOURS} hours, the credit is forfeited.`}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg },
  pad: { marginTop: space.lg },
  coachRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  coachInfo: { flex: 1, gap: 2 },
  divider: { height: 1, backgroundColor: color.border.subtle, marginVertical: space.md },
  rows: { gap: space.md },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
});
