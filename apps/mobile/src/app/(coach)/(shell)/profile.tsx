import { space } from '@tpa/theme';
import { useRouter } from 'expo-router';
import { Linking, StyleSheet, View } from 'react-native';

import { useSession } from '../../../session/SessionProvider';
import { ACADEMY, Avatar, Button, Card, LinkRow, Screen, ScreenHeader, Text } from '../../../ui';

/**
 * Deliberately sparse. The player Profile carries a wallet, purchase history, an
 * edit-profile form and the coach roster; a coach needs none of those — a coach
 * account cannot hold credits or book at all (the server refuses it, migration
 * 050), so linking to any of it would be offering something that does not work.
 *
 * The design also showed a rating, career totals, a specialty line and a SWITCH TO
 * PLAYER APP button. None of those exist: there is no rating anywhere in the
 * system, no career aggregate, no specialty field — and "switch to player app"
 * would route a coach into a shell their own account is redirected straight out
 * of. They are mockup decoration, so they are not here.
 *
 * What is left is what a coach actually needs: who they are signed in as, their
 * two screens, a way to reach the academy, and a way out.
 */
export default function CoachProfileScreen() {
  const router = useRouter();
  const { player, email, signOut } = useSession();
  if (!player) return null;

  const call = (e164: string) => {
    void Linking.openURL(`tel:${e164}`).catch(() => {});
  };

  return (
    <Screen scroll tabBar contentContainerStyle={styles.content}>
      <ScreenHeader eyebrow="Your account" title="Profile" />

      <Card>
        <View style={styles.identity}>
          <Avatar name={player.name} size={52} />
          <View style={styles.identityText}>
            <Text variant="h2">{player.name}</Text>
            <Text variant="caption" tone="secondary">
              {email ?? 'Coach'}
            </Text>
          </View>
        </View>
      </Card>

      <View style={styles.group}>
        <Text variant="label">Your work</Text>
        <LinkRow
          icon="calendar-outline"
          title="My schedule"
          subtitle="Your upcoming sessions"
          onPress={() => router.push('/(coach)/(shell)/schedule')}
        />
        <LinkRow
          icon="time-outline"
          title="Hours"
          subtitle="What you've been credited for"
          onPress={() => router.push('/(coach)/(shell)/hours')}
        />
      </View>

      <View style={styles.group}>
        <Text variant="label">The academy</Text>
        {ACADEMY.contacts.map((c) => (
          <LinkRow
            key={c.e164}
            icon="call-outline"
            title={c.name}
            subtitle={c.display}
            onPress={() => call(c.e164)}
          />
        ))}
      </View>

      <Button variant="secondary" label="Sign out" onPress={() => void signOut()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg },
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  identityText: { flex: 1, gap: 2 },
  group: { gap: space.sm },
});
