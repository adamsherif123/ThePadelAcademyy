import { space } from '@tpa/theme';
import { StyleSheet, View } from 'react-native';

import { useSession } from '../../session/SessionProvider';
import { BrandMark, Button, NavyScreen, Text } from '../../ui';

/**
 * Shown to a signed-in ADMIN who used their credential in the PLAYERS' app (A2 bug #2).
 * An admin authenticates at GoTrue but has no player identity (A1 keeps the two apart), so
 * there is nothing to book here — and they must NOT be routed to profile-setup (attempting
 * that bounce was the bug). Mirror of the admin app's "Not an admin" screen: say so plainly
 * and offer sign-out, never a dead end (S9.2).
 */
export default function NotAPlayerScreen() {
  const { email, signOut } = useSession();
  const who = email ?? 'this account';

  return (
    <NavyScreen contentContainerStyle={styles.content}>
      <View style={styles.panel}>
        <BrandMark size={56} />
        <View style={styles.head}>
          <Text variant="label">Academy staff</Text>
          <Text variant="display" tone="inverse">
            You&apos;re an academy admin
          </Text>
          <Text variant="body" tone="secondary">
            {`You're signed in as ${who}, which is an academy admin account — not a player. This app is for booking sessions. To manage the academy, open the admin site on the web. If you think this is a mistake, ask the academy about your account.`}
          </Text>
        </View>
        <Button label="Sign out / use a different email" onPress={() => void signOut()} />
      </View>
    </NavyScreen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center' },
  panel: { gap: space.xl },
  head: { gap: space.sm },
});
