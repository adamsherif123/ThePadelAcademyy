import Ionicons from '@expo/vector-icons/Ionicons';
import { color, space } from '@tpa/theme';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { emailHasAccount } from '../../lib/api';
import { ACADEMY, BrandMark, Button, Input, NavyScreen, PillOnNavy, Text } from '../../ui';

/** Loose email shape check — the server is the real authority; this just catches typos. */
const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/**
 * 01 — Sign in with email (A2 → A2.1). Enter an email → Next → we ask the server whether a
 * player account exists for it (email_has_account, one bit) and route directly: existing →
 * the password screen (login), new → create-account. Adam chose this server-side check over
 * A2's "always show password, tap to create" wall — the tiny email-enumeration surface is
 * acceptable for the academy's threat model and the UX win is real. An admin email returns
 * false (no player row) → create-account → where signUp/complete_signup refuse them (A1) and
 * they hit the not-a-player screen. If the check can't run we fall back to the password
 * screen, which still carries a "create your account" link, so no one is blocked.
 */
export default function SignInScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onContinue = async () => {
    const value = email.trim();
    if (!looksLikeEmail(value)) {
      setError('Enter a valid email address.');
      return;
    }
    if (checking) return;
    setError(null);
    setChecking(true);
    try {
      const exists = await emailHasAccount(value);
      router.push({ pathname: exists ? '/(auth)/password' : '/(auth)/profile-setup', params: { email: value } });
    } catch {
      // Don't block on a transport failure — the password screen offers "create account".
      router.push({ pathname: '/(auth)/password', params: { email: value } });
    } finally {
      // Reset on every path (the S9.2 stuck-spinner contract).
      setChecking(false);
    }
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
        <Text variant="label">Sign in with your email</Text>
        <Input
          tone="navy"
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          value={email}
          onChangeText={setEmail}
          returnKeyType="next"
          onSubmitEditing={onContinue}
          error={error ?? undefined}
        />
        <Button label={checking ? 'Checking…' : 'Continue'} onPress={onContinue} disabled={checking} />
        <Text variant="caption" tone="muted" style={styles.helper}>
          New players get 2 free trial sessions. You&apos;ll set a password next.
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
  helper: { textAlign: 'center', marginTop: space.xs },
});
