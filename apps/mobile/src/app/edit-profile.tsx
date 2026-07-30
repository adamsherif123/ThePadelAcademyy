import { space } from '@tpa/theme';
import type { Gender, Level } from '@tpa/types';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useSession } from '../session/SessionProvider';
import {
  Button,
  InfoCard,
  Input,
  ProfileFields,
  Screen,
  ScreenHeader,
  SuccessView,
  Text,
} from '../ui';

/**
 * Edit profile (Task 2). Reuses the shared ProfileFields (name/gender/level) — the
 * SAME pickers as signup — plus a phone field a player can add, change, or clear even
 * if they skipped it at signup. All four persist through the update_profile RPC, which
 * reuses complete_signup's +20 E.164 + phone_taken validation server-side; the client
 * never writes the row directly. On success SessionProvider invalidates the player
 * query, so the profile screen underneath shows the new values.
 *
 * Email is deliberately NOT editable here: it's the auth sign-in identity (owned by
 * GoTrue / auth.users), not a profile field — changing it is a separate re-auth flow.
 * It's shown read-only for context.
 */
// phone-specific RPC reasons → inline copy; mirrors profile-setup's REASON_COPY.
const REASON_COPY: Record<string, string> = {
  phone_taken: 'That phone number is already registered. Try another, or leave it blank.',
  invalid_phone: 'Enter a valid Egyptian mobile (e.g. 0100 123 4567), or leave it blank.',
};

export default function EditProfileScreen() {
  const router = useRouter();
  const { player, email, updateProfile } = useSession();

  // Pre-filled from the current row (initialisers run once; you only reach this screen
  // as a ready player, so these are populated). gender/level are never null in practice.
  const [name, setName] = useState(player?.name ?? '');
  const [gender, setGender] = useState<Gender | null>(player?.gender ?? null);
  const [level, setLevel] = useState<Level | null>(player?.level ?? null);
  const [phone, setPhone] = useState(player?.phone ?? '');

  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!player) return null;

  const nameValid = name.trim().length > 0;

  const onSave = async () => {
    if (!nameValid || gender === null || level === null || saving) return;
    setSaving(true);
    setPhoneError(null);
    setPageError(null);
    const res = await updateProfile({ name: name.trim(), gender, level, phone });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      return;
    }
    // A bad/duplicate number belongs ON the phone field (inline); everything else —
    // incl. the friendly network sentence — is a page-level notice.
    const reason = res.error ?? '';
    if (reason === 'phone_taken' || reason === 'invalid_phone') {
      setPhoneError(REASON_COPY[reason]);
    } else {
      setPageError(REASON_COPY[reason] ?? res.error ?? 'We couldn’t save your changes. Please try again.');
    }
  };

  if (saved) {
    return (
      <Screen>
        <SuccessView
          eyebrow="All set"
          title="Profile updated"
          primary={{ label: 'Done', onPress: () => router.back() }}
        />
      </Screen>
    );
  }

  return (
    <Screen
      scroll
      contentContainerStyle={styles.content}
      footer={
        <View style={styles.footer}>
          <Button label={saving ? 'Saving…' : 'Save changes'} onPress={onSave} disabled={!nameValid || saving} />
          <Button label="Cancel" variant="secondary" onPress={() => router.back()} disabled={saving} />
        </View>
      }
    >
      <ScreenHeader eyebrow="Your account" title="Edit profile" onBack={() => router.back()} />

      <ProfileFields
        name={name}
        onNameChange={setName}
        nameError={!nameValid && name.length > 0 ? 'Enter your name' : undefined}
        gender={gender}
        onGenderChange={setGender}
        level={level}
        onLevelChange={setLevel}
      />

      <View style={styles.field}>
        <Text variant="label">Phone</Text>
        <Input
          placeholder="e.g. 0100 123 4567"
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          value={phone}
          onChangeText={(v) => {
            setPhone(v);
            if (phoneError) setPhoneError(null);
          }}
          error={phoneError ?? undefined}
        />
        <Text variant="caption" tone="muted">
          Add it so the academy can reach you about your sessions. You can leave this blank.
        </Text>
      </View>

      <View style={styles.field}>
        <Text variant="label">Email</Text>
        <Text variant="body" tone="secondary">
          {email ?? '—'}
        </Text>
        <Text variant="caption" tone="muted">
          Your email is your sign-in and can&apos;t be changed here.
        </Text>
      </View>

      {pageError ? <InfoCard variant="amber" icon="alert-circle-outline" text={pageError} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg },
  field: { gap: space.sm },
  footer: { gap: space.sm },
});
