import Ionicons from '@expo/vector-icons/Ionicons';
import { CREDIT_EXPIRY_DAYS, buildSignupGrant, formatInstantDate } from '@tpa/core';
import { MOCK_NOW } from '@tpa/mocks';
import { color, radius, space } from '@tpa/theme';
import { StyleSheet, View } from 'react-native';

import { useSession } from '../../session/SessionProvider';
import { Button, NavyScreen, PillOnNavy, Text } from '../../ui';

/**
 * 04 — Trial grant. The credit count comes from SIGNUP_TRIAL_CREDITS and the
 * expiry date from the built grant (buildSignupGrant + formatInstantDate) — never
 * hardcoded.
 */
export default function TrialGrantScreen() {
  const { player, trialGrant, finishOnboarding } = useSession();

  // Fall back to a fresh grant if the user somehow arrives without one.
  const grant = trialGrant ?? buildSignupGrant(player?.id ?? ('pl_guest' as never), MOCK_NOW);
  const count = grant.quantityTotal;
  const validUntil = formatInstantDate(grant.expiresAt);

  return (
    <NavyScreen>
      <View style={styles.content}>
        <View style={styles.center}>
          <View style={styles.giftCircle}>
            <Ionicons name="gift" size={40} color={color.text.inverse} />
          </View>

          <Text variant="label" style={styles.centered}>
            Welcome to the Academy
          </Text>
          <Text variant="display" tone="inverse" style={styles.centered}>
            {`You've got ${count} free trial sessions`}
          </Text>
          <Text variant="body" tone="secondary" style={styles.centered}>
            {`${count} Trial credits were added to your wallet. Use them to meet our coaches on court — they're valid until ${validUntil}.`}
          </Text>

          <View style={styles.pills}>
            <PillOnNavy label={`${count} × Trial credits`} icon="sparkles-outline" />
            <PillOnNavy label={`Valid ${CREDIT_EXPIRY_DAYS} days`} icon="time-outline" />
          </View>
        </View>

        <Button label="Let's go" onPress={finishOnboarding} />
      </View>
    </NavyScreen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: 'space-between' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: space.md },
  centered: { textAlign: 'center' },
  giftCircle: {
    width: 84,
    height: 84,
    borderRadius: radius.pill,
    backgroundColor: color.accent.default,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, justifyContent: 'center', marginTop: space.md },
});
