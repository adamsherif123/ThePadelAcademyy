import { space } from '@tpa/theme';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useSession } from '../../session/SessionProvider';
import { BrandMark, Button, Input, NavyScreen, ScreenHeader, Text } from '../../ui';

/**
 * 02 — Password (A2). The RETURNING-player path: enter the password for the email from
 * the previous screen → signInWithPassword. On success we don't navigate — the guard
 * routes on the session flip (into the app, or to the refusal screen if this turns out to
 * be an admin credential). On failure we show ONE generic message: Supabase returns the
 * same error for a wrong password and a non-existent account by design, so this never
 * reveals whether the email is registered. A brand-new player taps "Create your account"
 * to go to profile-setup — that's where new-vs-returning actually splits (off the sign-in
 * attempt, not an email-existence probe).
 */
export default function PasswordScreen() {
  const router = useRouter();
  const { email } = useLocalSearchParams<{ email: string }>();
  const { signInWithEmail } = useSession();
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSignIn = async () => {
    if (submitting || password.length === 0) return;
    setSubmitting(true);
    setError(null);
    const res = await signInWithEmail(email ?? '', password);
    // Reset on EVERY path (the S9.2 stuck-spinner lesson). On success this screen is
    // unmounting as the guard routes away, so resetting here is harmless.
    setSubmitting(false);
    if (!res.ok) setError('That email and password don’t match. Check them and try again.');
  };

  const onCreate = () =>
    router.push({ pathname: '/(auth)/profile-setup', params: { email: email ?? '' } });

  return (
    <NavyScreen scroll contentContainerStyle={styles.content}>
      <BrandMark size={56} />
      <ScreenHeader eyebrow="Welcome back" title="Enter your password" tone="navy" onBack={() => router.back()} />

      <Text variant="body" tone="secondary">
        Signing in as{' '}
        <Text variant="body" weight="bold" tone="inverse">
          {email ?? ''}
        </Text>
      </Text>

      <View style={styles.form}>
        <Input
          tone="navy"
          label="Password"
          placeholder="Your password"
          secureTextEntry
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          value={password}
          onChangeText={setPassword}
          returnKeyType="go"
          onSubmitEditing={onSignIn}
          error={error ?? undefined}
        />
        <Button
          label={submitting ? 'Signing in…' : 'Sign in'}
          onPress={onSignIn}
          disabled={submitting || password.length === 0}
        />
      </View>

      <View style={styles.createRow}>
        <Text variant="body" tone="secondary">
          New to The Padel Academy?{' '}
        </Text>
        <Pressable onPress={onCreate} accessibilityRole="button">
          <Text variant="body" weight="bold" tone="accent">
            Create your account
          </Text>
        </Pressable>
      </View>
    </NavyScreen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, gap: space.lg },
  form: { gap: space.md, marginTop: space.md },
  createRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: space.md },
});
