import { color, radius, space } from '@tpa/theme';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { useSession } from '../../session/SessionProvider';
import { NavyScreen, PillOnNavy, ScreenHeader, Text } from '../../ui';
import { fontFamilyForWeight } from '../../theme/fonts';

const LENGTH = 6;

/**
 * 02 — OTP. Verifies the real SMS code; on success the session appears and the
 * root guard routes on (profile-setup if new, tabs if returning). We don't
 * navigate here — the auth state machine owns that transition.
 */
export default function OtpScreen() {
  const router = useRouter();
  const { phone, verifyOtp, sendOtp } = useSession();
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  const submit = async (digits: string) => {
    if (verifying) return;
    setVerifying(true);
    setError(null);
    const res = await verifyOtp(digits);
    if (!res.ok) {
      setVerifying(false);
      setError(res.error ?? 'That code didn’t work. Check it and try again.');
      setCode('');
    }
    // On success we stay put; the guard redirects once status flips.
  };

  const onChange = (next: string) => {
    const digits = next.replace(/[^0-9]/g, '').slice(0, LENGTH);
    setCode(digits);
    if (digits.length === LENGTH) void submit(digits);
  };

  const onResend = () => {
    setCode('');
    setError(null);
    if (phone) void sendOtp(phone);
  };

  return (
    <NavyScreen>
      <View style={styles.content}>
        <ScreenHeader
          eyebrow="Verification"
          title="Enter the Code"
          tone="navy"
          onBack={() => router.back()}
        />

        <Text variant="body" tone="secondary">
          We sent a 6-digit code to{' '}
          <Text variant="body" weight="bold" tone="inverse">
            {phone ?? ''}
          </Text>
        </Text>

        {error ? (
          <Text variant="body" tone="accent">
            {error}
          </Text>
        ) : null}

        <Pressable style={styles.boxes} onPress={() => inputRef.current?.focus()}>
          {Array.from({ length: LENGTH }).map((_, i) => {
            const active = i === code.length;
            return (
              <View key={i} style={[styles.box, active && styles.boxActive]}>
                <Text variant="h2" tone="inverse">
                  {code[i] ?? ''}
                </Text>
              </View>
            );
          })}
        </Pressable>

        {/* Off-screen input capturing the digits. */}
        <TextInput
          ref={inputRef}
          value={code}
          onChangeText={onChange}
          keyboardType="number-pad"
          maxLength={LENGTH}
          editable={!verifying}
          autoFocus
          style={styles.hiddenInput}
        />

        <View style={styles.resendRow}>
          <Text variant="body" tone="secondary">
            {verifying ? 'Verifying…' : "Didn't get it? "}
          </Text>
          {verifying ? null : (
            <Pressable onPress={onResend}>
              <Text variant="body" weight="bold" tone="accent">
                Resend code
              </Text>
            </Pressable>
          )}
        </View>

        <View style={styles.demoRow}>
          <PillOnNavy label="Dev — test numbers use code 123456" />
        </View>
      </View>
    </NavyScreen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg },
  boxes: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  box: {
    flex: 1,
    aspectRatio: 0.85,
    maxWidth: 56,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border.onInverse,
    backgroundColor: color.pillOnInverse.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxActive: { borderColor: color.accent.default },
  hiddenInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    fontFamily: fontFamilyForWeight.regular,
  },
  resendRow: { flexDirection: 'row', alignItems: 'center' },
  demoRow: { alignItems: 'center', marginTop: space.md },
});
