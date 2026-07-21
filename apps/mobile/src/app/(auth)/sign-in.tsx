import Ionicons from '@expo/vector-icons/Ionicons';
import { color, space } from '@tpa/theme';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ACADEMY, BrandMark, Button, Input, NavyScreen, PillOnNavy, Text } from '../../ui';

/** Loose email shape check — the server is the real authority; this just catches typos. */
const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/**
 * 01 — Sign in with email (A2). Enter an email → Next → the password screen, which signs
 * a returning player in or offers "create account" for a new one. We do NOT probe whether
 * the email exists here: there's no way to do that without either a password (not yet
 * collected) or an enumeration endpoint (which would leak which emails are registered to
 * anyone holding the public anon key). So the new-vs-returning split happens on the next
 * screen, off the password attempt — never off an email-existence check.
 */
export default function SignInScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onContinue = () => {
    const value = email.trim();
    if (!looksLikeEmail(value)) {
      setError('Enter a valid email address.');
      return;
    }
    setError(null);
    router.push({ pathname: '/(auth)/password', params: { email: value } });
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
        <Button label="Continue" onPress={onContinue} />
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
