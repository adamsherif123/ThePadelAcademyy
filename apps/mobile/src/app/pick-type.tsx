import { CANONICAL_CAPACITY, bookableTypesFor, formatInstantDate, formatInstantTime } from '@tpa/core';
import { space } from '@tpa/theme';
import type { SlotId, TrainingType } from '@tpa/types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { coachById, slotById } from '../data/booking';
import { useBatches, useCoaches, useSlots, combine } from '../data/queries';
import { haptics } from '../lib/haptics';
import { useSession } from '../session/SessionProvider';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  ErrorView,
  InfoCard,
  LoadingView,
  Screen,
  ScreenHeader,
  Text,
  TypeCard,
} from '../ui';

/**
 * "You + 3 others · pending until it fills" / "confirms the moment you book".
 * This is PRE-booking on a still-OPEN block, so the capacity MUST come from
 * CANONICAL_CAPACITY (what booking this type will make the slot become), never
 * `slot.capacity` — an open slot's stored capacity is still the admin's
 * original default (e.g. 4) regardless of which type a player is about to
 * pick, and book_slot itself is about to overwrite it to this same canonical
 * number the instant the booking lands.
 */
function pickerSubtitle(trainingType: TrainingType): string {
  const capacity = CANONICAL_CAPACITY[trainingType];
  if (capacity <= 1) return 'Confirms the moment you book';
  const others = capacity - 1;
  return `You + ${others} other${others === 1 ? '' : 's'} · pending until it fills`;
}

/**
 * TASK 3 — the type picker. An OPEN block is an invitation, not a class: this
 * screen is where the player decides what it becomes. Offers ONLY the types
 * bookableTypesFor says they can actually afford — the exact same function the
 * browse list and this screen both consume, so what's offered here can never
 * disagree with what book_slot itself would allow (SQL↔TS parity, one level
 * removed: TS↔TS parity between the two client call sites).
 *
 * Zero affordable types is not a dead tap — it explains why and routes to Buy
 * Credits. Exactly one affordable type is still SHOWN (not skipped): creating
 * a new session on an open block is a bigger commitment than joining an
 * existing one ("wait, did I just start a whole Group session here?"), so the
 * capacity / pending-vs-instant framing earns its screen even with only one
 * real choice — it's pre-selected, so the tap-through is still one button away.
 */
export default function PickTypeScreen() {
  const router = useRouter();
  const { player, now } = useSession();
  const slotsQ = useSlots();
  const batchesQ = useBatches();
  const coachesQ = useCoaches();
  const gate = combine(slotsQ, batchesQ, coachesQ);
  const { slotId, preferredType } = useLocalSearchParams<{ slotId: string; preferredType?: string }>();
  const [selected, setSelected] = useState<TrainingType | null>(null);
  if (!player) return null;

  if (gate.isPending || gate.isError) {
    return (
      <Screen>
        <ScreenHeader eyebrow="Open block" title="Choose your session" onBack={() => router.back()} />
        {gate.isPending ? <LoadingView /> : <ErrorView onRetry={gate.refetch} />}
      </Screen>
    );
  }

  const slot = slotById(slotsQ.data ?? [], slotId as SlotId);
  if (!slot) {
    return (
      <Screen>
        <ScreenHeader eyebrow="Open block" title="Not Found" onBack={() => router.back()} />
        <Text variant="body" tone="secondary" style={styles.pad}>
          This block is no longer available.
        </Text>
      </Screen>
    );
  }

  const coach = coachById(coachesQ.data ?? [], slot.coachId);
  const offered = bookableTypesFor(slot, player, batchesQ.data ?? [], now);
  // Pre-select: the tab the player was browsing if it's actually offered, else
  // the sole option when there's exactly one, else nothing (they choose).
  const chosen =
    selected ??
    (offered.some((o) => o.trainingType === preferredType) ? (preferredType as TrainingType) : null) ??
    (offered.length === 1 ? offered[0]!.trainingType : null);

  const onContinue = () => {
    if (!chosen) return;
    router.push({ pathname: '/confirm-booking', params: { slotId: slot.id, trainingType: chosen } });
  };

  return (
    <Screen
      scroll
      contentContainerStyle={styles.content}
      footer={offered.length > 0 ? <Button label="Continue" disabled={!chosen} onPress={onContinue} /> : undefined}
    >
      <ScreenHeader eyebrow="Open block" title="Choose your session" onBack={() => router.back()} />

      <Card>
        <View style={styles.coachRow}>
          <Avatar name={coach?.name ?? 'Coach'} imageUrl={coach?.photoUrl} size={52} />
          <View style={styles.coachInfo}>
            <Text variant="body" weight="bold">
              {coach?.name ?? 'Academy coach'}
            </Text>
            <Text variant="caption" tone="secondary">
              {`${formatInstantDate(slot.startsAt)} · ${formatInstantTime(slot.startsAt)} – ${formatInstantTime(slot.endsAt)}`}
            </Text>
          </View>
        </View>
      </Card>

      {offered.length === 0 ? (
        <EmptyState
          icon="wallet-outline"
          title="No usable credit for this block"
          message="You don't hold a spendable credit for any session type right now. Buy a bundle to book here."
          cta={{ label: 'Buy credits', onPress: () => router.push('/buy-credits') }}
        />
      ) : (
        <>
          <Text variant="body" tone="secondary">
            Nothing is decided yet — pick what this becomes. Only types you hold a usable credit for are shown.
          </Text>
          <View style={styles.grid}>
            {offered.map((o) => (
              <TypeCard
                key={o.trainingType}
                trainingType={o.trainingType}
                subtitle={pickerSubtitle(o.trainingType)}
                credits={o.creditsAvailable}
                selected={chosen === o.trainingType}
                onPress={() => {
                  haptics.light();
                  setSelected(o.trainingType);
                }}
              />
            ))}
          </View>
          <InfoCard
            variant="neutral"
            icon="information-circle-outline"
            text="Group and duo sessions start once enough players join. Individual sessions are confirmed the moment you book."
          />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg },
  pad: { marginTop: space.lg },
  coachRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  coachInfo: { flex: 1, gap: 2 },
  grid: { gap: space.md },
});
