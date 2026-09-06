import { radius, space } from '@tpa/theme';
import type { Gender, Level } from '@tpa/types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { haptics } from '../../lib/haptics';
import { PRIVACY_POLICY_URL } from '../../lib/legal';
import { useSession } from '../../session/SessionProvider';
import { useTheme } from '../../theme/ThemeProvider';
import { Button, InfoCard, Input, ProfileFields, Screen, ScreenHeader, Text } from '../../ui';

const MIN_PASSWORD = 8;

/**
 * 03 — Profile setup (A2). Two ways in:
 *   • NEW player — arrives from the password screen with an `email` param and NO session:
 *     collects name/gender/level PLUS password + confirm, and on submit does
 *     signUp({email,password}) → complete_signup (create the player + 2 trial credits).
 *   • ORPHAN — the guard forces a signed-in user with no player row here (a signup that
 *     died after the auth user was created): the password already exists, so it only
 *     collects the profile and runs complete_signup.
 *
 * Either way it must not be a dead end: the header back control clears any half-finished
 * session and returns to email entry (see `onBack`). An admin never reaches this screen —
 * the guard routes an admin credential to the refusal screen (bug #2).
 */
// EVERY reason complete_signup can return, mapped to copy — mirrors edit-profile's
// REASON_COPY. The map is exhaustive against the RPC (see
// 20260818000037_phone_required_at_signup.sql) so a rejection can never fall through
// to a shrug; the generic fallback below exists only for a reason added later, and
// even that says something actionable rather than nothing.
const REASON_COPY: Record<string, string> = {
  name_required: 'Please enter your name.',
  invalid_gender: 'Please choose which group you train with.',
  invalid_level: 'Please choose your level.',
  phone_required: 'Enter your phone number to continue.',
  phone_taken:
    'That phone number is already registered. If it’s yours, sign in instead of creating a second account.',
  invalid_phone: 'Enter a valid Egyptian mobile (e.g. 0100 123 4567).',
  not_authenticated: 'Your sign-in expired. Go back and sign in again to finish setting up.',
  is_admin: 'That’s an academy staff account — it can’t be used as a player profile.',
};

/** Reasons that belong ON the name field. */
const NAME_REASONS = new Set(['name_required']);
/** Reasons that belong ON the phone field. */
const PHONE_REASONS = new Set(['phone_required', 'invalid_phone', 'phone_taken']);

export default function ProfileSetupScreen() {
  const router = useRouter();
  const { color } = useTheme();
  const styles = useMemo(
    () => StyleSheet.create({
      content: { gap: space.lg },
      field: { gap: space.sm },
      haveAccountRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center' },
      genderRow: { flexDirection: 'row', gap: space.md },
      genderCard: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: space.xl,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: color.border.subtle,
        backgroundColor: color.bg.surface,
      },
      selectedCard: { borderColor: color.accent.default, backgroundColor: color.bg.canvas },
      helper: { textAlign: 'center' },
    }),
    [color],
  );
  const { email: emailParam } = useLocalSearchParams<{ email?: string }>();
  const { completeProfile, signUpWithEmail, signOut, email: sessionEmail, status } = useSession();
  // An email param means the new-signup path (no session yet). Otherwise it's an orphan
  // session that already has a password — collect the profile only.
  const isNewFlow = Boolean(emailParam);
  const shownEmail = emailParam ?? sessionEmail ?? '';

  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const [level, setLevel] = useState<Level | null>(null);
  const [phone, setPhone] = useState('');
  const [trainedBefore, setTrainedBefore] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Field-specific rejections show inline on the field that's wrong; everything else
  // (network, auth-layer, an unmapped reason) is a page-level notice — the same split
  // edit-profile uses.
  const [nameError, setNameError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  const passwordTooShort = isNewFlow && password.length > 0 && password.length < MIN_PASSWORD;
  const confirmMismatch = isNewFlow && confirm.length > 0 && confirm !== password;
  const passwordOk = !isNewFlow || (password.length >= MIN_PASSWORD && confirm === password);
  const complete =
    name.trim().length > 0 &&
    gender !== null &&
    level !== null &&
    trainedBefore !== null &&
    phone.trim().length > 0 &&
    passwordOk;
  const busy = submitting;

  const onCreate = async () => {
    if (!complete || busy || gender === null || level === null) return;
    setSubmitting(true);
    setNameError(null);
    setPhoneError(null);
    setPageError(null);
    try {
      // New player: create the GoTrue auth user first (it owns the password), then the
      // profile. Only sign up if there is NO session yet — if a prior attempt already
      // created the auth user (e.g. it succeeded but complete_signup then hit phone_taken),
      // `status` is needs_profile, so we skip straight to completeProfile on retry instead
      // of re-signing-up the now-existing email.
      if (isNewFlow && status === 'signed_out') {
        const signUpRes = await signUpWithEmail(emailParam ?? '', password);
        if (!signUpRes.ok) {
          haptics.error();
          if (signUpRes.taken) {
            setPageError('That email already has an account. Go back and sign in with your password.');
          } else {
            // GoTrue's own message (weak password, rate limit, …) is already a sentence.
            setPageError(signUpRes.error ?? 'We couldn’t create your account. Please try again.');
          }
          return;
        }
      }
      // complete_signup creates the player (A5: NO credits at signup) and stores the
      // now-required phone + the self-reported trained_before. completeProfile never throws.
      const res = await completeProfile({ name: name.trim(), gender, level, phone, trainedBefore });
      if (res.ok) {
        // First-timers see the trial offer; returning members go straight into the app.
        router.replace(trainedBefore === false ? '/(auth)/trial-grant' : '/(tabs)');
        return;
      }
      haptics.error();
      // `res.error` is the RPC's reason code on a business rejection, or an already-
      // friendly sentence on a network failure (completeProfile writes "No connection…"
      // itself). Falling back through `res.error` — not straight to the generic — is what
      // keeps that network sentence intact instead of mislabelling a dead connection as
      // a bad profile.
      const reason = res.error ?? '';
      if (NAME_REASONS.has(reason)) setNameError(REASON_COPY[reason]!);
      else if (PHONE_REASONS.has(reason)) setPhoneError(REASON_COPY[reason]!);
      else {
        setPageError(
          REASON_COPY[reason] ??
            res.error ??
            'Something went wrong — please check your details and try again.',
        );
      }
    } finally {
      // A stuck spinner is a bug even when the error is handled: reset on EVERY path
      // (on success this screen is unmounting anyway, so it's harmless there).
      setSubmitting(false);
    }
  };

  const onHaveAccount = () =>
    router.replace({ pathname: '/(auth)/password', params: { email: emailParam ?? '' } });

  // Header back: leave cleanly without stranding a half-finished account. An orphan
  // needs_profile session would route us straight back here on the next launch (the S9.2
  // trap), so clear the local session first — signOut() flips to signed_out synchronously,
  // purges the persisted session from AsyncStorage, and never throws. The guard leaves a
  // signed_out user put while inside (auth), so navigate to email entry explicitly.
  const onBack = () => {
    void signOut();
    router.replace('/(auth)/sign-in');
  };

  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <ScreenHeader eyebrow="Almost there" title="Set up your Profile" onBack={onBack} />
      <Text variant="bodySecondary">
        This takes 30 seconds and decides which group sessions you&apos;ll see.
      </Text>
      {shownEmail ? (
        <Text variant="caption" tone="muted">
          {`Signing up as ${shownEmail}`}
        </Text>
      ) : null}

      <ProfileFields
        name={name}
        onNameChange={setName}
        nameError={nameError ?? undefined}
        gender={gender}
        onGenderChange={setGender}
        level={level}
        onLevelChange={setLevel}
      />

      <View style={styles.field}>
        <Text variant="label">Have you trained at The Padel Academy before?</Text>
        <View style={styles.genderRow}>
          {[
            { value: true, label: 'Yes' },
            { value: false, label: 'No, I’m new' },
          ].map((o) => {
            const selected = trainedBefore === o.value;
            return (
              <Pressable
                key={o.label}
                onPress={() => setTrainedBefore(o.value)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={[styles.genderCard, selected && styles.selectedCard]}
              >
                <Text variant="body" weight="bold" tone={selected ? 'accent' : 'primary'}>
                  {o.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.field}>
        <Text variant="label">Phone</Text>
        <Input
          placeholder="e.g. 0100 123 4567"
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          value={phone}
          onChangeText={setPhone}
          error={phoneError ?? undefined}
        />
        <Text variant="caption" tone="muted">
          So the academy can reach you about your sessions.
        </Text>
      </View>

      {isNewFlow ? (
        <View style={styles.field}>
          <Text variant="label">Choose a password</Text>
          <Input
            placeholder={`At least ${MIN_PASSWORD} characters`}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            value={password}
            onChangeText={setPassword}
            error={passwordTooShort ? `At least ${MIN_PASSWORD} characters` : undefined}
          />
          <Input
            placeholder="Confirm password"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            textContentType="newPassword"
            value={confirm}
            onChangeText={setConfirm}
            error={confirmMismatch ? 'Passwords don’t match' : undefined}
          />
        </View>
      ) : null}

      <InfoCard
        variant="neutral"
        text="Men's and ladies' groups train separately, and players are placed by level. You'll only see group slots that match your category and level."
      />

      <Button
        label={submitting ? 'Creating…' : 'Create my Profile'}
        onPress={onCreate}
        disabled={!complete || busy}
      />
      {pageError ? (
        <Text variant="caption" tone="accent" style={styles.helper}>
          {pageError}
        </Text>
      ) : !complete ? (
        <Text variant="caption" tone="muted" style={styles.helper}>
          {isNewFlow
            ? 'Fill in all fields and choose a password to continue'
            : 'Fill in all fields to continue'}
        </Text>
      ) : null}

      {isNewFlow ? (
        <Text variant="caption" tone="muted" style={styles.helper}>
          By creating an account you agree to our{' '}
          <Text
            variant="caption"
            tone="accent"
            onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
          >
            Privacy Policy
          </Text>
          .
        </Text>
      ) : null}

      {/* Fallback for a new-flow user who actually already has an account (the routing
          check sent them here, but e.g. they typed a new email by mistake). */}
      {isNewFlow ? (
        <View style={styles.haveAccountRow}>
          <Text variant="caption" tone="muted">
            Already have an account?{' '}
          </Text>
          <Pressable onPress={onHaveAccount} accessibilityRole="button" disabled={busy}>
            <Text variant="caption" tone="accent" weight="bold">
              Sign in
            </Text>
          </Pressable>
        </View>
      ) : null}
    </Screen>
  );
}
