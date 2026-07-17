import {
  CANCELLATION_WINDOW_HOURS,
  formatInstantDate,
  formatInstantTime,
  isSessionConfirmed,
  spotsUntilConfirmed,
} from '@tpa/core';
import { color, space } from '@tpa/theme';
import type { Gender, Level, SlotId } from '@tpa/types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { bookingPreview } from '../data/booking';
import { useBatches, useBookSlot, useBookings, useCoaches, useSlots, combine } from '../data/queries';
import { useSession } from '../session/SessionProvider';
import {
  ACADEMY,
  Avatar,
  Badge,
  Button,
  Card,
  CreditCallout,
  ErrorView,
  GENDER_LABEL,
  IconRow,
  InfoCard,
  LEVEL_LABEL,
  LoadingView,
  Screen,
  ScreenHeader,
  Text,
  TRAINING_META,
  batchLabel,
} from '../ui';
import type { BookReason } from '../lib/api';

const UNBOOKABLE_MESSAGE: Record<BookReason, string> = {
  slot_full: 'This session just filled up. Pick another slot.',
  slot_in_past: 'This session has already started.',
  slot_cancelled: 'This session was cancelled.',
  gender_mismatch: "This session isn't for your group.",
  level_mismatch: "This session isn't for your level.",
  no_usable_credit: 'You no longer have a usable credit for this session.',
  slot_missing: 'This session is no longer available.',
  already_booked: "You've already booked this session.",
  not_authenticated: 'Your session expired. Please sign in again.',
};

/** 12 — Confirm booking. Read-through preview + the real credit-spend RPC. */
export default function ConfirmBookingScreen() {
  const router = useRouter();
  const { player, now } = useSession();
  const slotsQ = useSlots();
  const batchesQ = useBatches();
  const bookingsQ = useBookings();
  const coachesQ = useCoaches();
  const gate = combine(slotsQ, batchesQ, bookingsQ, coachesQ);
  const bookMutation = useBookSlot();
  const [error, setError] = useState<string | null>(null);
  const { slotId } = useLocalSearchParams<{ slotId: string }>();
  if (!player) return null;

  if (gate.isPending || gate.isError) {
    return (
      <Screen>
        <ScreenHeader eyebrow="Confirm" title="Confirm Booking" onBack={() => router.back()} />
        {gate.isPending ? <LoadingView /> : <ErrorView onRetry={gate.refetch} />}
      </Screen>
    );
  }

  const preview = bookingPreview(
    {
      slots: slotsQ.data ?? [],
      coaches: coachesQ.data ?? [],
      batches: batchesQ.data ?? [],
      bookings: bookingsQ.data ?? [],
    },
    player,
    slotId as SlotId,
    now,
  );
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
  const confirmed = isSessionConfirmed(slot);
  const toFill = spotsUntilConfirmed(slot);
  const submitting = bookMutation.isPending;
  const canConfirm = verdict.ok && batch !== undefined && !alreadyBooked && !submitting;
  const leftAfter = typeBalance - 1;

  const onConfirm = async () => {
    setError(null);
    // The RPC is the enforcement; canBookSlot above was only the preview. If they
    // disagree, the RPC wins and its reason is shown here.
    const outcome = await bookMutation.mutateAsync(slot.id);
    if (outcome.status === 'booked') {
      router.replace({ pathname: '/booked-success', params: { bookingId: outcome.bookingId } });
    } else if (outcome.status === 'rejected') {
      setError(UNBOOKABLE_MESSAGE[outcome.reason] ?? 'This session is unavailable.');
    } else {
      // Lost response after a possible success — never claim failure. The wallet /
      // sessions were just re-read; tell them to check, offer a safe retry.
      setError(
        "We couldn't confirm your booking. Check Sessions — if it's not there, tap Confirm to try again.",
      );
    }
  };

  return (
    <Screen
      scroll
      contentContainerStyle={styles.content}
      footer={
        <Button
          label={submitting ? 'Booking…' : 'Confirm booking'}
          disabled={!canConfirm}
          onPress={onConfirm}
        />
      }
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
          <IconRow chip icon="location-outline" label="Location" value={ACADEMY.locationLine} />
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

      {/* Confirmation state — what booking actually gets them. Honest: no promise
          of a notification (the app can't send one). toFill === 1 means this
          booking fills the last seat and confirms it on the spot (covers a 1-on-1,
          which auto-confirms on the first booking). */}
      {confirmed ? (
        <InfoCard
          variant="success"
          icon="checkmark-circle-outline"
          text="Confirmed — this session is on."
        />
      ) : toFill === 1 ? (
        <InfoCard
          variant="royal"
          icon="people-outline"
          text={`This session isn't confirmed yet — but booking it fills the last spot and locks it in. Your credit is spent when you book, and the ${CANCELLATION_WINDOW_HOURS}-hour cancellation rule still applies.`}
        />
      ) : (
        <InfoCard
          variant="amber"
          icon="people-outline"
          text={`This session isn't confirmed yet — it runs once it fills (${toFill} spots left, including yours). Your credit is spent when you book, and the ${CANCELLATION_WINDOW_HOURS}-hour cancellation rule still applies.`}
        />
      )}

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

      {/* Runtime booking error (RPC rejection or an unconfirmed/lost response) */}
      {error ? <InfoCard variant="amber" icon="alert-circle-outline" text={error} /> : null}

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
