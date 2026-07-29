import { cairoCalendarDate, formatInstantDate, formatInstantTime, sameCairoDate } from '@tpa/core';
import { space } from '@tpa/theme';
import type { IsoInstant, SessionSlot } from '@tpa/types';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  coachById,
  dateStrip,
  sessionsForDay,
  weekAvailabilitySummary,
  type SlotAvailability,
  type WeekAvailabilitySummary,
} from '../../data/booking';
import { useBatches, useBookings, useCoaches, useSlots, useTemplates, combine } from '../../data/queries';
import { totalReadyToBook } from '../../data/wallet';
import { useSession } from '../../session/SessionProvider';
import {
  DateChip,
  EmptyState,
  ErrorView,
  InfoCard,
  LinkRow,
  LoadingView,
  Screen,
  ScreenHeader,
  SlotCard,
  type SlotCardState,
  Text,
  TRAINING_META,
} from '../../ui';

const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const DAYS = 14;

// No pending/confirmed chip on the browse list: CapacityMeter + "N/M booked"
// already show how full each slot is, and the pending-vs-confirmed detail (with
// honest copy) is surfaced at the decision point on confirm-booking. Keeping the
// browse cards scannable, we don't duplicate it here.
/**
 * Map a core-derived availability verdict to SlotCard display props. `av.trainingType`
 * on `bookable` is the RESOLVED type (the slot's own if already typed, else the type
 * `sessionsForDay` resolved an open block to) — the credit note always
 * names the type this exact tap would spend, never `slot.trainingType` directly
 * (which may still be null for an open block).
 */
function slotDisplay(av: SlotAvailability): { state: SlotCardState; note?: string; creditNote?: string } {
  switch (av.kind) {
    case 'bookable':
      return { state: 'bookable', creditNote: `Uses 1 ${TRAINING_META[av.trainingType].label} credit` };
    case 'full':
      return { state: 'full' };
    case 'booked':
      return { state: 'booked' };
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

/** "Next session today at 6 PM" / "Next session Tue, 14 Jul at 6 PM" — the date
 * is only stated when the next session isn't today, so the common case stays
 * short. Null input (nothing at all upcoming) renders nothing. */
function nextSessionLabel(nextSessionAt: IsoInstant | null, now: IsoInstant): string | null {
  if (!nextSessionAt) return null;
  const today = cairoCalendarDate(now);
  return sameCairoDate(nextSessionAt, today)
    ? `Next session today at ${formatInstantTime(nextSessionAt)}`
    : `Next session ${formatInstantDate(nextSessionAt)} at ${formatInstantTime(nextSessionAt)}`;
}

/**
 * The weekly-availability banner's copy (Task A). Three honest shapes — never
 * fabricates a "next session" when there isn't one:
 *  - sessions left this week: "{N} sessions available this week · {M} today ·
 *    Next session …"
 *  - nothing left this week, but something's coming later: "Nothing left this
 *    week — Next session …"
 *  - nothing upcoming at all: a plain "check back soon".
 */
function weekBannerText(summary: WeekAvailabilitySummary, now: IsoInstant): string {
  const next = nextSessionLabel(summary.nextSessionAt, now);
  if (summary.sessionsThisWeek === 0) {
    return next ? `Nothing left this week — ${next}.` : 'No sessions available right now — check back soon.';
  }
  const weekLabel = `${summary.sessionsThisWeek} session${summary.sessionsThisWeek === 1 ? '' : 's'} available this week`;
  const todayLabel = summary.sessionsToday > 0 ? ` · ${summary.sessionsToday} today` : '';
  return next ? `${weekLabel}${todayLabel} · ${next}.` : `${weekLabel}${todayLabel}.`;
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
  const [dayKey, setDayKey] = useState<string | null>(null);

  if (!player) return null;

  if (gate.isPending || gate.isError) {
    return (
      <Screen scroll tabBar contentContainerStyle={styles.content}>
        <ScreenHeader eyebrow="Book your session" title="Find your next session" />
        {gate.isPending ? <LoadingView /> : <ErrorView onRetry={gate.refetch} />}
      </Screen>
    );
  }

  const allSlots = slotsQ.data ?? [];
  const batches = batchesQ.data ?? [];
  const bookings = bookingsQ.data ?? [];
  const coaches = coachesQ.data ?? [];

  const days = dateStrip(templatesQ.data ?? [], allSlots, now, DAYS);
  const firstOpen = days.find((d) => !d.closed) ?? days[0]!;
  const selectedDay = days.find((d) => d.key === dayKey) ?? firstOpen;
  const isToday = selectedDay.key === days[0]!.key;
  const dayLabel = isToday ? 'Today' : `${WEEKDAY_ABBR[selectedDay.weekday]} ${selectedDay.day}`;

  const daySessions = sessionsForDay(allSlots, player, batches, bookings, now, selectedDay);
  const weekSummary = weekAvailabilitySummary(allSlots, now);
  const wallet = totalReadyToBook(batches, now);

  // An OPEN block routes to the picker (nothing is decided yet); an
  // already-typed slot goes straight to confirm. Unchanged from before the
  // redesign — only the list feeding this tap is new (Task 1).
  const onSlot = (slot: SessionSlot) =>
    slot.trainingType === null
      ? router.push({ pathname: '/pick-type', params: { slotId: slot.id } })
      : router.push({ pathname: '/confirm-booking', params: { slotId: slot.id } });

  return (
    <Screen scroll tabBar contentContainerStyle={styles.content}>
      <ScreenHeader eyebrow="Book your session" title="Find your next session" />

      <InfoCard variant="neutral" icon="calendar-outline" text={weekBannerText(weekSummary, now)} />

      {/* Date strip */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateStrip}>
        {days.map((d) => (
          <DateChip
            key={d.key}
            weekday={d.weekday}
            dayNumber={d.day}
            spots={d.spots}
            closed={d.closed}
            selected={d.key === selectedDay.key}
            onPress={() => setDayKey(d.key)}
          />
        ))}
      </ScrollView>

      <Text variant="label">
        {`${dayLabel} · ${daySessions.length} session${daySessions.length === 1 ? '' : 's'} · ${selectedDay.spots} spot${selectedDay.spots === 1 ? '' : 's'} available`}
      </Text>

      {/* Chronological feed — every session that day, once, typed or open. */}
      {daySessions.length === 0 ? (
        <EmptyState
          icon="calendar-outline"
          title="No sessions on this day"
          message="Nothing available on this day. Try another day in the strip above."
        />
      ) : (
        <View style={styles.slots}>
          {daySessions.map(({ slot, availability }) => {
            const display = slotDisplay(availability);
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
      )}

      {/* Compact wallet line — informs, never blocks (credits never hide a session). */}
      <LinkRow
        icon="wallet-outline"
        title={`Wallet: ${wallet} credit${wallet === 1 ? '' : 's'}`}
        subtitle="View packages"
        onPress={() => router.push('/buy-credits')}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg },
  dateStrip: { gap: space.sm, paddingVertical: space.xs },
  slots: { gap: space.md },
});
