import Ionicons from '@expo/vector-icons/Ionicons';
import { formatPiastres } from '@tpa/core';
import { color, radius, space } from '@tpa/theme';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { usePackages } from '../../data/queries';
import { Button, LoadingView, NavyScreen, PillOnNavy, Text } from '../../ui';

/**
 * A5 — repurposed from the old "2 free trial credits" celebration (those credits no longer
 * exist) into the TRIAL OFFER shown to a FIRST-TIME player right after signup. It points them
 * at the one-time discounted trial session and drops them into the request flow; "Maybe later"
 * lands them in the app with zero credits (the wallet then nudges them to the trial / store).
 * Returning members never see this — profile-setup routes them straight into the app.
 */
export default function TrialOfferScreen() {
  const router = useRouter();
  const packagesQ = usePackages();
  const trial = (packagesQ.data ?? []).find((p) => p.trainingType === 'trial' && p.isActive);

  if (packagesQ.isPending) {
    return (
      <NavyScreen>
        <LoadingView />
      </NavyScreen>
    );
  }

  return (
    <NavyScreen>
      <View style={styles.content}>
        <View style={styles.center}>
          <View style={styles.giftCircle}>
            <Ionicons name="sparkles" size={38} color={color.text.inverse} />
          </View>

          <Text variant="label" style={styles.centered}>
            Welcome to The Padel Academy
          </Text>
          <Text variant="display" tone="inverse" style={styles.centered}>
            {trial ? 'Start with a trial session' : 'You’re all set'}
          </Text>
          <Text variant="body" tone="secondary" style={styles.centered}>
            {trial
              ? 'Book your first session at a special one-time price. Pay by InstaPay or cash, report it, and the academy adds your credit once confirmed — one trial per player.'
              : 'Browse our packages and request the credits you need to get on court.'}
          </Text>

          {trial ? (
            <View style={styles.pills}>
              <PillOnNavy label={`Trial · ${formatPiastres(trial.price)}`} icon="sparkles-outline" />
              <PillOnNavy label="One per player" icon="person-outline" />
            </View>
          ) : null}
        </View>

        <View style={styles.actions}>
          {trial ? (
            <Button
              label="Get my trial session"
              onPress={() =>
                router.replace({ pathname: '/request-credits', params: { packageId: trial.id } })
              }
            />
          ) : (
            <Button label="Browse packages" onPress={() => router.replace('/buy-credits')} />
          )}
          <Button label="Maybe later" variant="ghost" onPress={() => router.replace('/(tabs)')} />
        </View>
      </View>
    </NavyScreen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: 'space-between' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: space.md },
  centered: { textAlign: 'center' },
  actions: { gap: space.sm },
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
