import { CANCELLATION_WINDOW_HOURS, formatExpiry, formatInstantTime } from '@tpa/core';
import { space } from '@tpa/theme';
import type { BookingId } from '@tpa/types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { cancelPreview } from '../data/booking';
import { useBatches, useBookings, useCancelBooking, useCoaches, useSlots, combine } from '../data/queries';
import { useSession } from '../session/SessionProvider';
import {
  batchLabel,
  BookingCard,
  Button,
  CreditCallout,
  ErrorView,
  InfoCard,
  LoadingView,
  Screen,
  ScreenHeader,
  Text,
  TRAINING_META,
} from '../ui';

/**
 * Cancel a booking. A full screen presented modally (not a compact sheet): the
 * forfeit case is a real, irreversible loss of a paid credit, so it needs room
 * for the session details, an unmissable state-specific warning, and an
 * emphasized way to back out. Three outcomes, and the difference is deliberate:
 *   - outside the window, credit usable  -> reassuring: it comes back, to this batch;
 *   - outside the window, credit expired -> honest caution: it comes back but is dead;
 *   - inside the window                  -> blunt red: the credit is forfeited.
 * The safe action ("Keep my booking") is the primary/filled button.
 */
export default function CancelBookingScreen() {
  const router = useRouter();
  const { player, now } = useSession();
  const slotsQ = useSlots();
  const batchesQ = useBatches();
  const bookingsQ = useBookings();
  const coachesQ = useCoaches();
  const gate = combine(slotsQ, batchesQ, bookingsQ, coachesQ);
  const cancelMutation = useCancelBooking();
  const [error, setError] = useState<string | null>(null);
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  if (!player) return null;

  if (gate.isPending || gate.isError) {
    return (
      <Screen>
        <ScreenHeader eyebrow="Cancel" title="Cancel Booking" onBack={() => router.back()} />
        {gate.isPending ? <LoadingView /> : <ErrorView onRetry={gate.refetch} />}
      </Screen>
    );
  }

  const preview = cancelPreview(
    {
      slots: slotsQ.data ?? [],
      coaches: coachesQ.data ?? [],
      batches: batchesQ.data ?? [],
      bookings: bookingsQ.data ?? [],
    },
    bookingId as BookingId,
    now,
  );
  if (!preview) {
    return (
      <Screen>
        <ScreenHeader eyebrow="Cancel" title="Not Found" onBack={() => router.back()} />
        <Text variant="body" tone="secondary" style={styles.pad}>
          This booking can no longer be cancelled.
        </Text>
      </Screen>
    );
  }

  const { slot, coach, refundable, refundExpired, batch } = preview;
  const meta = TRAINING_META[slot.trainingType];
  const submitting = cancelMutation.isPending;

  const onConfirm = async () => {
    setError(null);
    const outcome = await cancelMutation.mutateAsync({
      bookingId: bookingId as BookingId,
      expectedRefund: refundable,
    });
    if (outcome.status === 'cancelled') {
      // Sessions (underneath) was just re-read via invalidation and shows the truth.
      router.back();
    } else if (outcome.status === 'rejected') {
      setError(
        outcome.reason === 'already_cancelled'
          ? 'This booking was already cancelled.'
          : outcome.reason === 'not_cancellable'
            ? 'This booking can no longer be cancelled.'
            : 'We couldn’t cancel this booking.',
      );
    } else {
      setError(
        "We couldn't confirm the cancellation. Check Sessions — if it's still there, try again.",
      );
    }
  };

  return (
    <Screen
      scroll
      contentContainerStyle={styles.content}
      footer={
        <View style={styles.footer}>
          <Button label="Keep my booking" onPress={() => router.back()} disabled={submitting} />
          <Button
            label={submitting ? 'Cancelling…' : 'Cancel booking'}
            variant="secondary"
            destructive
            onPress={onConfirm}
            disabled={submitting}
          />
        </View>
      }
    >
      <ScreenHeader
        eyebrow={`${meta.label} session`}
        title="Cancel Booking"
        onBack={() => router.back()}
      />

      <BookingCard variant="detail" slot={slot} coach={coach} />

      {!refundable ? (
        <InfoCard
          variant="danger"
          text={`You're inside the ${CANCELLATION_WINDOW_HOURS}-hour window. Cancelling now forfeits this ${meta.label} credit — it will NOT be returned to your wallet.`}
        />
      ) : refundExpired && batch ? (
        <InfoCard
          variant="amber"
          text={`Your credit returns to ${batchLabel(batch)}, but it ${formatExpiry(batch.expiresAt, now)} — you won't be able to use it.`}
        />
      ) : refundable && batch ? (
        <CreditCallout
          headline="Your credit comes back"
          detail={`1 ${meta.label} credit returns to your wallet, keeping its original expiry.`}
          source={batchLabel(batch)}
          expiresAt={batch.expiresAt}
          now={now}
        />
      ) : (
        <InfoCard
          variant="neutral"
          text="Your seat will be freed. There's no credit on file to return for this booking."
        />
      )}

      {error ? <InfoCard variant="amber" icon="alert-circle-outline" text={error} /> : null}

      <Text variant="caption" tone="muted" style={styles.note}>
        {refundable
          ? `Free until ${formatInstantTime(preview.deadline)}. Cancelling frees your seat for another player.`
          : 'Cancelling frees your seat for another player.'}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg },
  pad: { marginTop: space.lg },
  footer: { gap: space.sm },
  note: { textAlign: 'center' },
});
