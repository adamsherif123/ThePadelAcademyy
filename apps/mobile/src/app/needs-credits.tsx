import { space } from '@tpa/theme';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useLocation } from '../location/LocationProvider';
import { Button, InfoCard, Screen, ScreenHeader, Text } from '../ui';

/**
 * The friendly "you'll need credits" prompt (Task 1). A player taps a session they
 * can't afford yet — instead of a dead card, this modal explains why and routes to
 * the store. Presented modally (see _layout), reusing the same Screen + footer
 * pattern as cancel-booking; it invents no new component.
 *
 * It's an INVITATION, not an error: no red, no "failed". The copy is tailored by the
 * `reason` the Book tab passed —
 *   • no_credit       — nothing usable on file at this branch (incl. a zero-credit
 *                        player tapping an open block: they can't afford ANY type);
 *   • credits_expired — they HAD credits AT THIS BRANCH and those lapsed;
 *   • wrong_location  — they hold perfectly good credits, at another branch.
 *
 * The third exists because the first two were being used for it, and both were
 * untrue: a player with valid credits at the other branch was told they had none,
 * or — worse, and what prompted this — that theirs had expired, when nothing of
 * theirs had. Each reason now says only what is true of that player, and the three
 * are kept apart in slotAvailability rather than here.
 */
type NeedsCreditsReason = 'no_credit' | 'credits_expired' | 'wrong_location';

const COPY: Record<NeedsCreditsReason, { title: string; body: string }> = {
  no_credit: {
    title: "You'll need credits to book",
    body: "Sessions are booked with credits from your wallet. Grab a package and you'll be ready to book this one — and any other session that fits you.",
  },
  credits_expired: {
    title: 'Your credits have expired',
    body: "The credits you had have lapsed, so there's nothing left to book with. Top up and you'll be ready to book this session again.",
  },
  wrong_location: {
    title: 'No credits for this location',
    body: 'Your credits are for another location, and a credit only works where it was bought. Buy credits for this one to book this session — or switch back to the location you already have credits for.',
  },
};

export default function NeedsCreditsScreen() {
  const router = useRouter();
  const { selected } = useLocation();
  const { reason } = useLocalSearchParams<{ slotId?: string; reason?: string }>();
  // Default to the generic no-credit copy for any unexpected/missing reason — the
  // prompt should never render blank, and "you need credits" is always true here.
  const copy = COPY[reason as NeedsCreditsReason] ?? COPY.no_credit;

  return (
    <Screen
      // This Screen isn't `scroll`, so its content renders via `style`, not
      // `contentContainerStyle` (which only the ScrollView branch reads).
      style={styles.content}
      footer={
        <View style={styles.footer}>
          {/* replace, not push: swap this prompt for the store so backing out of
              buy-credits returns straight to Book, not through the modal again. */}
          <Button label="Buy credits" icon="wallet-outline" onPress={() => router.replace('/buy-credits')} />
          <Button label="Not now" variant="secondary" onPress={() => router.back()} />
        </View>
      }
    >
      <ScreenHeader eyebrow="Almost there" title={copy.title} onBack={() => router.back()} />
      <InfoCard
        variant="neutral"
        icon="wallet-outline"
        text={
          // wrong_location's body already turns on which branch you are at, so
          // appending the same fact again would read as a stammer.
          selected && reason !== 'wrong_location'
            ? `${copy.body} Credits you buy will be for ${selected.name}.`
            : copy.body
        }
      />
      {/* Eats the remaining space so the note below lands right above the
          footer's own divider (Screen's borderTopWidth) — the divider then
          separates the note from the buttons, not from the InfoCard. */}
      <View style={styles.spacer} />
      <Text variant="caption" tone="muted" style={styles.note}>
        No charge happens here — you choose a package on the next screen.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg },
  spacer: { flex: 1 },
  footer: { gap: space.sm },
  note: { textAlign: 'center' },
});
