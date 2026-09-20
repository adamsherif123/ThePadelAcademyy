import { space } from '@tpa/theme';
import { Linking, StyleSheet, View } from 'react-native';

import { useSession } from '../../session/SessionProvider';
import { ACADEMY, Avatar, Button, Card, LinkRow, Screen, ScreenHeader, Text } from '../../ui';

/**
 * Deliberately sparse. The player Profile carries a wallet, purchase history, an
 * edit-profile form and the coach roster; a coach needs none of those — a coach
 * account cannot hold credits or book at all (the server refuses it, migration
 * 050), so linking to any of it would be offering something that does not work.
 *
 * What is left is what a coach actually needs from a settings screen: who they are
 * signed in as, a way to reach the academy, and a way out.
 */
export default function CoachProfileScreen() {
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
