import { space } from '@tpa/theme';
import { StyleSheet, View } from 'react-native';

import { useSession } from '../../session/SessionProvider';
import { Button, Card, Screen, ScreenHeader, Text } from '../../ui';

/**
 * Coach mode, phase 1 — the placeholder that proves the routing fork.
 *
 * Reaching this screen at all is the deliverable: it means the signed-in account is
 * a player whose `coach_id` resolves to a coaches record, and that `nextRoute` sent
 * them to the coach shell rather than the booking app. The schedule, hours and
 * rosters land in phase 3.
 *
 * Sign-out lives here deliberately — a coach has no Profile tab yet, and a shell
 * with no way out would be a trap.
 */
export default function CoachHomeScreen() {
  const { player, signOut } = useSession();
  const firstName = player?.name.split(' ')[0] ?? 'Coach';

  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <ScreenHeader eyebrow="Coach" title={`Hey, ${firstName}`} />

      <Card>
        <View style={styles.card}>
          <Text variant="h2">Coach mode is on its way</Text>
          <Text variant="bodySecondary">
            Your account is linked to the academy as a coach. Your schedule, the players booked
            into each session, and your hours coached will appear here in the next update.
          </Text>
        </View>
      </Card>

      <Button variant="secondary" label="Sign out" onPress={() => void signOut()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg },
  card: { gap: space.sm },
});
