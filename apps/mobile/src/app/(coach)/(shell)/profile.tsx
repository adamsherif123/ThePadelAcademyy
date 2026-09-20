import { space } from '@tpa/theme';
import { useRouter } from 'expo-router';
import { Linking, StyleSheet, View } from 'react-native';

import { PRIVACY_POLICY_URL } from '../../../lib/legal';
import { useSession } from '../../../session/SessionProvider';
import { AcademyCard, Avatar, Button, Card, LinkRow, Screen, ScreenHeader, Text } from '../../../ui';

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
        {/* The player app's own Contact us screen, not a second list of numbers:
            it carries WhatsApp as well as calling, and one screen means one place
            to change how the academy is reached. */}
        <LinkRow
          icon="chatbubble-ellipses-outline"
          title="Contact us"
          subtitle="Call or WhatsApp the academy"
          onPress={() => router.push('/contact-us')}
        />
        <AcademyCard />
      </View>

      <Button variant="secondary" label="Sign out" onPress={() => void signOut()} />

      {/* Parity with the player Profile, and not optional: Apple 5.1.1(v) requires
          an app that creates accounts to offer deletion IN-APP, and a coach lands
          here instead of the player app — so without this a coach would have no way
          to delete theirs. The same gated confirm screen the player app uses; a
          coach is a player row, so the same delete_account RPC does the work. */}
      <Button
        label="Delete account"
        variant="ghost"
        destructive
        icon="trash-outline"
        size="sm"
        onPress={() => router.push('/delete-account')}
      />

      <Text
        variant="caption"
        tone="muted"
        style={styles.privacyLink}
        onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
      >
        Privacy Policy
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg },
  privacyLink: { textAlign: 'center', marginTop: space.xs },
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  identityText: { flex: 1, gap: 2 },
  group: { gap: space.sm },
});
