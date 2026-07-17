import Ionicons from '@expo/vector-icons/Ionicons';
import { color, radius, space } from '@tpa/theme';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useSession } from '../../session/SessionProvider';
import { ACADEMY, BrandMark, Button, Input, NavyScreen, PillOnNavy, Text } from '../../ui';

/** 01 — Sign in with phone. Sends a real OTP, then the OTP screen verifies it. */
export default function SignInScreen() {
  const router = useRouter();
  const { sendOtp } = useSession();
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onContinue = async () => {
    if (submitting) return;
    // Empty input falls back to a configured test number so dev sign-in is one tap.
    const input = value.trim() || '155 555 0001';
    setSubmitting(true);
    setError(null);
    const res = await sendOtp(input);
    setSubmitting(false);
    if (res.ok) router.push('/(auth)/otp');
    else setError(res.error ?? 'Could not send the code. Please try again.');
  };

  return (
    <NavyScreen scroll contentContainerStyle={styles.content}>
      <BrandMark size={72} />

        <View style={styles.hero}>
          <Text variant="label">The Padel Academy · Cairo</Text>
          <Text variant="display" tone="inverse">
            {'Train hard.\nPlay padel.\nLevel up.'}
          </Text>
        </View>

        <View style={styles.pills}>
          <PillOnNavy label="Group" />
          <PillOnNavy label="Duo" />
          <PillOnNavy label="Individual" />
        </View>

        <View style={styles.locationRow}>
          <Ionicons name="location-outline" size={16} color={color.text.muted} />
          <Text variant="caption" tone="muted">
            {ACADEMY.locationLine}
          </Text>
        </View>

        <View style={styles.spacer} />

        <View style={styles.form}>
          <Text variant="label">Sign in with your phone</Text>
          <View style={styles.phoneRow}>
            <View style={styles.countryChip}>
              <Text variant="body" tone="inverse">
                🇪🇬 +20
              </Text>
            </View>
            <View style={styles.phoneInput}>
              <Input
                tone="navy"
                placeholder="1XX XXX XXXX"
                keyboardType="phone-pad"
                value={value}
                onChangeText={setValue}
                returnKeyType="done"
                onSubmitEditing={onContinue}
              />
            </View>
          </View>
          <Button
            label={submitting ? 'Sending code…' : 'Continue'}
            onPress={onContinue}
            disabled={submitting}
          />
          {error ? (
            <Text variant="caption" tone="accent" style={styles.helper}>
              {error}
            </Text>
          ) : null}
          <Text variant="caption" tone="muted" style={styles.helper}>
            We&apos;ll text you a verification code. New players get 2 free trial sessions.
          </Text>
        </View>
    </NavyScreen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, gap: space.lg },
  hero: { gap: space.sm },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  spacer: { flex: 1, minHeight: space.xl },
  form: { gap: space.md },
  phoneRow: { flexDirection: 'row', gap: space.sm, alignItems: 'stretch' },
  countryChip: {
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border.onInverse,
    backgroundColor: color.pillOnInverse.bg,
  },
  phoneInput: { flex: 1 },
  helper: { textAlign: 'center', marginTop: space.xs },
});
