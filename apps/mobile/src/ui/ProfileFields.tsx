import { GENDERS, LEVELS } from '@tpa/core';
import { radius, space } from '@tpa/theme';
import type { Gender, Level } from '@tpa/types';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { Input } from './Input';
import { Text } from './Text';
import { GENDER_LABEL } from './trainingMeta';

/**
 * The shared identity fields — name, group category (gender), level — collected at
 * signup AND editable afterwards. Extracted from profile-setup so the two screens
 * share ONE gender/level picker and its copy, rather than maintaining a parallel form
 * (Task 2). Fully controlled: it owns no state, only renders values + reports changes,
 * so each screen keeps its own submit/validation logic. Phone lives on each screen
 * (its copy and optional-ness differ: "optional" at signup, "add it" when editing).
 */
const LEVEL_COPY: Record<Level, { title: string; description: string }> = {
  beginner: { title: 'Beginner', description: 'New to padel or still learning the basics' },
  adv_beginner: {
    title: 'Advanced Beginner',
    description: 'Comfortable rallying, working on consistency',
  },
  intermediate: { title: 'Intermediate', description: 'Match-ready — tactics, walls and net play' },
};

export function ProfileFields({
  name,
  onNameChange,
  nameError,
  gender,
  onGenderChange,
  level,
  onLevelChange,
}: {
  name: string;
  onNameChange: (value: string) => void;
  nameError?: string;
  gender: Gender | null;
  onGenderChange: (gender: Gender) => void;
  level: Level | null;
  onLevelChange: (level: Level) => void;
}) {
  const { color } = useTheme();
  const styles = useMemo(
    () => StyleSheet.create({
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
    }),
    [color],
  );
  return (
    <>
      <View style={styles.field}>
        <Text variant="label">Your name</Text>
        <Input placeholder="e.g. Ahmed Samir" value={name} onChangeText={onNameChange} error={nameError} />
      </View>

      <View style={styles.field}>
        <Text variant="label">Group category</Text>
        <View style={styles.genderRow}>
          {GENDERS.map((g) => {
            const selected = gender === g;
            return (
              <Pressable
                key={g}
                onPress={() => onGenderChange(g)}
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
              onPress={() => onLevelChange(l)}
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
    </>
  );
}
