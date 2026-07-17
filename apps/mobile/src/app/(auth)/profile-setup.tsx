import { GENDERS, LEVELS } from '@tpa/core';
import { color, radius, space } from '@tpa/theme';
import type { Gender, Level } from '@tpa/types';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useSession } from '../../session/SessionProvider';
import { Button, GENDER_LABEL, InfoCard, Input, Screen, ScreenHeader, Text } from '../../ui';

const LEVEL_COPY: Record<Level, { title: string; description: string }> = {
  beginner: { title: 'Beginner', description: 'New to padel or still learning the basics' },
  adv_beginner: {
    title: 'Advanced Beginner',
    description: 'Comfortable rallying, working on consistency',
  },
  intermediate: { title: 'Intermediate', description: 'Match-ready — tactics, walls and net play' },
};

/**
 * 03 — Profile setup (light). Gender + level filter which group slots show (S3b).
 *
 * The guard forces every new player here (session exists, no player yet), so it must
 * not be a dead end: it carries a sign-out escape. If complete_signup can't succeed
 * for this session — e.g. an orphaned session whose auth user was removed — the user
 * can sign out and start over with a different number instead of being bricked.
 */
export default function ProfileSetupScreen() {
  const router = useRouter();
  const { completeProfile, signOut, phone } = useSession();
  const [name, setName] = useState('');
  const [gender, setGender] = useState<Gender | null>(null);
  const [level, setLevel] = useState<Level | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const complete = name.trim().length > 0 && gender !== null && level !== null;
  const busy = submitting || leaving;

  const onCreate = async () => {
    if (!complete || busy) return;
    setSubmitting(true);
    setError(null);
    try {
      // complete_signup creates the player and grants the 2 trial credits atomically.
      // completeProfile never throws — it returns {ok:false,error} on any failure.
      const res = await completeProfile({ name: name.trim(), gender, level });
      if (res.ok) {
        // Show the trial-grant celebration; the guard allows it for a ready user.
        router.push('/(auth)/trial-grant');
        return;
      }
      setError('We couldn’t create your profile. If this keeps happening, sign out below and try a different number.');
    } finally {
      // A stuck spinner is a bug even when the error is handled: reset on EVERY path
      // (on success this screen is unmounting anyway, so it's harmless there).
      setSubmitting(false);
    }
  };

  const onSignOut = async () => {
    if (busy) return;
    setLeaving(true);
    await signOut(); // never throws; forces the signed-out state → guard → sign-in
  };

  return (
    <Screen scroll contentContainerStyle={styles.content}>
      <ScreenHeader eyebrow="Almost there" title="Set up your Profile" />
        <Text variant="bodySecondary">
          This takes 30 seconds and decides which group sessions you&apos;ll see.
        </Text>
        {phone ? (
          <Text variant="caption" tone="muted">
            {`Signing up as ${phone}`}
          </Text>
        ) : null}

        <View style={styles.field}>
          <Text variant="label">Your name</Text>
          <Input placeholder="e.g. Ahmed Samir" value={name} onChangeText={setName} />
        </View>

        <View style={styles.field}>
          <Text variant="label">Group category</Text>
          <View style={styles.genderRow}>
            {GENDERS.map((g) => {
              const selected = gender === g;
              return (
                <Pressable
                  key={g}
                  onPress={() => setGender(g)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[styles.genderCard, selected && styles.selectedCard]}
                >
                  <Text variant="h2" tone={selected ? 'accent' : 'primary'}>
                    {GENDER_LABEL[g]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.field}>
          <Text variant="label">Your level</Text>
          {LEVELS.map((l) => {
            const selected = level === l;
            return (
              <Pressable
                key={l}
                onPress={() => setLevel(l)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={[styles.levelCard, selected && styles.selectedCard]}
              >
                <View style={styles.levelText}>
                  <Text variant="body" weight="bold">
                    {LEVEL_COPY[l].title}
                  </Text>
                  <Text variant="caption" tone="secondary">
                    {LEVEL_COPY[l].description}
                  </Text>
                </View>
                <View style={[styles.radio, selected && styles.radioSelected]}>
                  {selected ? <View style={styles.radioDot} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>

        <InfoCard
          variant="neutral"
          text="Men's and ladies' groups train separately, and players are placed by level. You'll only see group slots that match your category and level."
        />

        <Button
          label={submitting ? 'Creating…' : 'Create my Profile'}
          onPress={onCreate}
          disabled={!complete || busy}
        />
        {error ? (
          <Text variant="caption" tone="accent" style={styles.helper}>
            {error}
          </Text>
        ) : !complete ? (
          <Text variant="caption" tone="muted" style={styles.helper}>
            Fill in all three fields to continue
          </Text>
        ) : null}

        {/* The escape hatch: this screen is forced by the guard, so it must never be
            a dead end. Sign out returns to sign-in to start over with another number. */}
        <Button
          label={leaving ? 'Signing out…' : 'Sign out / use a different number'}
          variant="ghost"
          onPress={onSignOut}
          disabled={busy}
        />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg },
  field: { gap: space.sm },
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
  levelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.bg.surface,
  },
  levelText: { flex: 1, gap: 2 },
  selectedCard: { borderColor: color.accent.default, backgroundColor: color.bg.canvas },
  radio: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: color.border.strong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: color.accent.default },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: color.accent.default,
  },
  helper: { textAlign: 'center' },
});
