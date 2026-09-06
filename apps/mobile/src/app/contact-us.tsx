import { space } from '@tpa/theme';
import { useRouter } from 'expo-router';
import { Linking, StyleSheet, View } from 'react-native';

import { ACADEMY, Button, Card, IconRow, InfoCard, Screen, ScreenHeader, Text } from '../ui';

/**
 * Profile → Contact us. The two people who answer for the academy, each reachable by
 * a tap.
 *
 * Presented modally (see _layout) and built from the same Screen + footer pieces as
 * needs-credits — it invents no new modal system and no new components. The numbers
 * come from ACADEMY.contacts, the same brand-facts constant that owns the address,
 * maps link and opening hours.
 *
 * Two actions per contact rather than one: Call is the safe default that works on any
 * phone, WhatsApp is what people here actually use for a quick question. The WhatsApp
 * link is https://wa.me/… rather than the whatsapp:// scheme deliberately — wa.me
 * falls back to the browser (which then offers to open the app) if WhatsApp isn't
 * installed, where the custom scheme would simply fail.
 */
export default function ContactUsScreen() {
  const router = useRouter();

  // openURL rejects when nothing can handle the scheme (a tablet with no dialer, a
  // simulator). Swallow it: a contact sheet must never crash, and the number is
  // still on screen to copy by hand.
  const open = (url: string) => {
    void Linking.openURL(url).catch(() => {});
  };

  return (
    <Screen
      // Not `scroll`, so content renders via `style` — same as needs-credits.
      style={styles.content}
      footer={<Button label="Done" variant="secondary" onPress={() => router.back()} />}
    >
      <ScreenHeader eyebrow="The academy" title="Contact us" onBack={() => router.back()} />

      <InfoCard
        variant="neutral"
        icon="chatbubbles-outline"
        text="Questions about a session, your credits, or anything else? Reach the academy directly — we'll get back to you."
      />

      <View style={styles.list}>
        {ACADEMY.contacts.map((c) => (
          <Card key={c.e164}>
            <IconRow icon="person-outline" title={c.name} subtitle={c.display} />
            <View style={styles.actions}>
              <Button
                label="Call"
                variant="secondary"
                size="sm"
                fullWidth={false}
                icon="call-outline"
                onPress={() => open(`tel:${c.e164}`)}
              />
              <Button
                label="WhatsApp"
                variant="secondary"
                size="sm"
                fullWidth={false}
                icon="logo-whatsapp"
                onPress={() => open(`https://wa.me/${c.e164.replace('+', '')}`)}
              />
            </View>
          </Card>
        ))}
      </View>

      <View style={styles.spacer} />

      <Text variant="caption" tone="muted" style={styles.note}>
        {ACADEMY.hours}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg },
  list: { gap: space.md },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  spacer: { flex: 1 },
  note: { textAlign: 'center' },
});
