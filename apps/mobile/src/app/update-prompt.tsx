import { space } from '@tpa/theme';
import { useRouter } from 'expo-router';
import { Linking, StyleSheet, View } from 'react-native';

import { useSession } from '../session/SessionProvider';
import { Button, InfoCard, Screen, ScreenHeader, Text } from '../ui';
import { markDismissedToday } from '../update/updatePrompt';

/** The app's App Store page. The numeric id is the App Store app id, not the bundle id. */
const APP_STORE_URL = 'https://apps.apple.com/app/id6793803171';

/**
 * The soft "please update" nudge. Presented modally (see _layout) and built from
 * the same Screen + footer pieces as needs-credits and contact-us — no new modal
 * system, no new components.
 *
 * WHEN it appears is UpdatePromptBridge's job; this screen only renders it and
 * records the answer. Both actions write today's Cairo day, so tapping "Update
 * now" and then coming back without having updated doesn't nag again the same day
 * — they already acted on it once.
 */
export default function UpdatePromptScreen() {
  const router = useRouter();
  const { now } = useSession();

  const close = () => {
    void markDismissedToday(now);
    router.back();
  };

  const openStore = () => {
    void markDismissedToday(now);
    // Rejects when nothing can handle the URL (a simulator with no App Store).
    // Swallowed: a nudge must never crash, and "Later" is still right there.
    void Linking.openURL(APP_STORE_URL).catch(() => {});
    router.back();
  };

  return (
    <Screen
      // Not `scroll`, so content renders via `style` — same as needs-credits.
      style={styles.content}
      footer={
        <View style={styles.footer}>
          <Button label="Update now" icon="cloud-download-outline" onPress={openStore} />
          <Button label="Later" variant="secondary" onPress={close} />
        </View>
      }
    >
      <ScreenHeader eyebrow="The Padel Academy" title="A new version is available" onBack={close} />

      <InfoCard
        variant="neutral"
        icon="sparkles-outline"
        text="Update to get the latest features, fixes and improvements. It only takes a moment."
      />

      <View style={styles.spacer} />

      <Text variant="caption" tone="muted" style={styles.note}>
        You can keep using this version for now — we&apos;ll remind you again tomorrow.
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
