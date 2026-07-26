import { space } from '@tpa/theme';
import type { Booking, Coach, CreditBatch, IsoInstant, Player, SessionSlot, TrainingType } from '@tpa/types';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  type SlotAvailability,
  coachById,
  dateStrip,
  slotAvailability,
  slotsForType,
} from '../../data/booking';
import { useBatches, useBookings, useCoaches, useSlots, useTemplates, combine } from '../../data/queries';
import { balanceByType } from '../../data/wallet';
import { useSession } from '../../session/SessionProvider';
import {
  DateChip,
  EmptyState,
  ErrorView,
  LoadingView,
  Screen,
  ScreenHeader,
  GENDER_LABEL,
  LEVEL_LABEL,
  SlotCard,
  type SlotCardState,
  Text,
  TRAINING_META,
  TypeCard,
} from '../../ui';

const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

// Book-screen taglines (product copy). Layout lives in TypeCard.
const TAGLINE: Record<TrainingType, string> = {
  group: '3–4 players',
  duo: '2 players',
  individual: '1-on-1 coaching',
  trial: 'Free taster session',
};

// Grid order per 11-book.png: Group, Duo / Individual, Trial.
const TYPE_ORDER: TrainingType[] = ['group', 'duo', 'individual', 'trial'];

const DAYS = 14;

// No pending/confirmed chip on the browse list: CapacityDots + "N/M booked"
// already show how full each slot is, and the pending-vs-confirmed detail (with
// honest copy) is surfaced at the decision point on confirm-booking. Keeping the
// browse cards scannable, we don't duplicate it here.
/**
 * Map a core-derived availability verdict to SlotCard display props. `av.trainingType`
 * on `bookable` is the RESOLVED type (the slot's own if already typed, else the tab
 * being browsed) — the credit note always names the type this exact tap would spend,
 * never `slot.trainingType` directly (which may still be null for an open block).
 */
function slotDisplay(
  av: SlotAvailability,
  slot: SessionSlot,
): { state: SlotCardState; note?: string; creditNote?: string } {
  switch (av.kind) {
    case 'bookable':
      return { state: 'bookable', creditNote: `Uses 1 ${TRAINING_META[av.trainingType].label} credit` };
    case 'full':
      return { state: 'full' };
    case 'booked':
      return { state: 'booked' };
    case 'gender_mismatch':
      return { state: 'unavailable', note: slot.gender === 'men' ? 'Men only' : 'Ladies only' };
    // A race: this slot's type resolved to something else between the list
    // loading and now. Same visual as `full` (nothing left for THIS tap here) —
    // the next refresh moves the card to wherever it actually landed.
    case 'type_taken':
      return { state: 'unavailable', note: 'Just taken' };
    case 'credits_expired':
      return { state: 'unavailable', note: 'Credits expired' };
    case 'no_credit':
      return { state: 'unavailable', note: 'No credits' };
    case 'past':
      return { state: 'unavailable', note: 'Started' };
    case 'cancelled':
      return { state: 'unavailable', note: 'Cancelled' };
  }
}

export default function BookScreen() {
  const router = useRouter();
  const { player, now } = useSession();
  const slotsQ = useSlots();
  const batchesQ = useBatches();
  const bookingsQ = useBookings();
  const coachesQ = useCoaches();
  const templatesQ = useTemplates();
  const gate = combine(slotsQ, batchesQ, bookingsQ, coachesQ, templatesQ);
  const [type, setType] = useState<TrainingType>('group');
  const [dayKey, setDayKey] = useState<string | null>(null);

  if (!player) return null;

  if (gate.isPending || gate.isError) {
    return (
      <Screen scroll tabBar contentContainerStyle={styles.content}>
        <ScreenHeader eyebrow="Spend your credits" title="Book a Session" />
        {gate.isPending ? <LoadingView /> : <ErrorView onRetry={gate.refetch} />}
      </Screen>
    );
  }

  const allSlots = slotsQ.data ?? [];
  const batches = batchesQ.data ?? [];
  const bookings = bookingsQ.data ?? [];
  const coaches = coachesQ.data ?? [];

  const days = dateStrip(templatesQ.data ?? [], now, DAYS);
  const firstOpen = days.find((d) => !d.closed) ?? days[0]!;
  const selectedDay = days.find((d) => d.key === dayKey) ?? firstOpen;

  const balance = balanceByType(batches, now);
  const slots = slotsForType(allSlots, type, player, batches, now, selectedDay);
  const isToday = selectedDay.key === days[0]!.key;
  const dayLabel = isToday ? 'Today' : `${WEEKDAY_ABBR[selectedDay.weekday]} ${selectedDay.day}`;

  return (
    <Screen scroll tabBar contentContainerStyle={styles.content}>
      <ScreenHeader eyebrow="Spend your credits" title="Book a Session" />

      {/* Type selector 2×2 */}
      <View style={styles.grid}>
        {[TYPE_ORDER.slice(0, 2), TYPE_ORDER.slice(2, 4)].map((row, i) => (
          <View key={i} style={styles.gridRow}>
            {row.map((t) => (
              <TypeCard
                key={t}
                trainingType={t}
                subtitle={TAGLINE[t]}
                credits={balance[t]}
                selected={type === t}
                onPress={() => setType(t)}
              />
            ))}
          </View>
        ))}
      </View>

      {/* Profile filter line — group only */}
      {type === 'group' ? (
        <Text variant="caption" tone="secondary">
          Group slots are matched to your profile —{' '}
          <Text variant="caption" weight="bold" tone="primary">
            {`${GENDER_LABEL[player.gender]} · ${LEVEL_LABEL[player.level]}`}
          </Text>
        </Text>
      ) : null}

      {/* Date strip */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateStrip}>
        {days.map((d) => (
          <DateChip
            key={d.key}
            weekday={d.weekday}
            dayNumber={d.day}
            closed={d.closed}
            selected={d.key === selectedDay.key}
            onPress={() => setDayKey(d.key)}
          />
        ))}
      </ScrollView>

      <Text variant="label">{`${dayLabel} · ${TRAINING_META[type].label} slots`}</Text>

      {/* Slots / empty states */}
      <BookBody
        type={type}
        balance={balance[type]}
        slots={slots}
        player={player}
        batches={batches}
        bookings={bookings}
        coaches={coaches}
        now={now}
        onBuy={() => router.push('/buy-credits')}
        onSlot={(slot) =>
          // An OPEN block routes to the picker (it may be affordable as more
          // types than just the tab being browsed); an already-typed slot goes
          // straight to confirm, unchanged. `preferredType` is a hint only —
          // the picker still shows every affordable type, pre-selecting this one.
          slot.trainingType === null
            ? router.push({ pathname: '/pick-type', params: { slotId: slot.id, preferredType: type } })
            : router.push({ pathname: '/confirm-booking', params: { slotId: slot.id } })
        }
      />
    </Screen>
  );
}

function BookBody({
  type,
  balance,
  slots,
  player,
  batches,
  bookings,
  coaches,
  now,
  onBuy,
  onSlot,
}: {
  type: TrainingType;
  balance: number;
  slots: SessionSlot[];
  player: Player;
  batches: CreditBatch[];
  bookings: Booking[];
  coaches: Coach[];
  now: IsoInstant;
  onBuy: () => void;
  onSlot: (slot: SessionSlot) => void;
}) {
  const label = TRAINING_META[type].label;

  // No usable credits of this type — distinguish lapsed vs never (TASK 5) + CTA (TASK 6).
  if (balance === 0) {
    const lapsed = slots.some(
      (s) => slotAvailability(s, player, batches, bookings, now, type).kind === 'credits_expired',
    );
    return (
      <EmptyState
        icon="wallet-outline"
        title={lapsed ? `Your ${label} credits expired` : `No ${label} credits`}
        message={
          lapsed
            ? `Credits are valid 30 days from purchase. Buy more to book ${label.toLowerCase()} sessions.`
            : `You don't have any ${label.toLowerCase()} credits yet. Buy a bundle to start booking.`
        }
        cta={{ label: 'Buy credits', onPress: onBuy }}
      />
    );
  }

  // Open day, nothing available for this type/profile.
  if (slots.length === 0) {
    return (
      <EmptyState
        icon="calendar-outline"
        title={`No ${label} sessions`}
        message="Nothing available on this day. Try another day in the strip above."
      />
    );
  }

  return (
    <View style={styles.slots}>
      {slots.map((slot) => {
        const av = slotAvailability(slot, player, batches, bookings, now, type);
        const display = slotDisplay(av, slot);
        return (
          <SlotCard
            key={slot.id}
            slot={slot}
            coach={coachById(coaches, slot.coachId)}
            now={now}
            state={display.state}
            note={display.note}
            creditNote={display.creditNote}
            onPress={display.state === 'bookable' ? () => onSlot(slot) : undefined}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg },
  grid: { gap: space.md },
  gridRow: { flexDirection: 'row', gap: space.md },
  dateStrip: { gap: space.sm, paddingVertical: space.xs },
  slots: { gap: space.md },
});
