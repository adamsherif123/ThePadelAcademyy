import Ionicons from '@expo/vector-icons/Ionicons';
import { color, space } from '@tpa/theme';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { useSession } from '../../session/SessionProvider';
import { BrandMark, Button, Input, NavyScreen, PillOnNavy, Text } from '../../ui';

/** 01 — Sign in with phone. Any input advances (mock); OTP verifies. */
export default function SignInScreen() {
  const router = useRouter();
  const { setPhone } = useSession();
  const [value, setValue] = useState('');

  const onContinue = () => {
    setPhone(value.trim() ? `+20 ${value.trim()}` : '+20 102 673 9782');
    router.push('/(auth)/otp');
  };

  return (
    <NavyScreen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
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
            Oro Plaza Hotel · Rehab, Cairo
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
          <Button label="Continue" onPress={onContinue} />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Text variant="caption" tone="muted" style={styles.helper}>
              We&apos;ll text you a verification code. New players get 2 free trial sessions.
            </Text>
          </KeyboardAvoidingView>
        </View>
      </ScrollView>
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
    borderRadius: 8,
    borderWidth: 1,
    borderColor: color.border.onInverse,
    backgroundColor: color.pillOnInverse.bg,
  },
  phoneInput: { flex: 1 },
  helper: { textAlign: 'center', marginTop: space.xs },
});
