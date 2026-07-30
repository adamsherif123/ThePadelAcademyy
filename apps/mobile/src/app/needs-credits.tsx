import { space } from '@tpa/theme';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button, InfoCard, Screen, ScreenHeader, Text } from '../ui';

/**
 * The friendly "you'll need credits" prompt (Task 1). A player taps a session they
 * can't afford yet — instead of a dead card, this modal explains why and routes to
 * the store. Presented modally (see _layout), reusing the same Screen + footer
 * pattern as cancel-booking; it invents no new component.
 *
 * It's an INVITATION, not an error: no red, no "failed". The copy is tailored by the
 * `reason` the Book tab passed (the two credit-shortfall verdicts) —
 *   • no_credit       — nothing usable on file (incl. a zero-credit player tapping an
 *                        open block: they can't afford ANY type, and the copy still fits);
 *   • credits_expired — they had credits, but they lapsed.
 * Both are fixed by buying credits, so both land on the same primary action.
 */
const COPY: Record<'no_credit' | 'credits_expired', { title: string; body: string }> = {
  no_credit: {
    title: "You'll need credits to book",
    body: "Sessions are booked with credits from your wallet. Grab a package and you'll be ready to book this one — and any other session that fits you.",
  },
  credits_expired: {
    title: 'Your credits have expired',
    body: "The credits you had have lapsed, so there's nothing left to book with. Top up and you'll be ready to book this session again.",
  },
};

export default function NeedsCreditsScreen() {
  const router = useRouter();
  const { reason } = useLocalSearchParams<{ slotId?: string; reason?: string }>();
  // Default to the generic no-credit copy for any unexpected/missing reason — the
  // prompt should never render blank, and "you need credits" is always true here.
  const copy = reason === 'credits_expired' ? COPY.credits_expired : COPY.no_credit;

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
      <InfoCard variant="neutral" icon="wallet-outline" text={copy.body} />
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
