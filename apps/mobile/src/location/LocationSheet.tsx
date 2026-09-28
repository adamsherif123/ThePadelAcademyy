import Ionicons from '@expo/vector-icons/Ionicons';
import { radius, space } from '@tpa/theme';
import type { Location, LocationId } from '@tpa/types';
import { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui';

/**
 * The branch chooser — a bottom sheet listing branches with the current one ticked.
 *
 * Extracted from LocationToggle so the trial request picker (S8.7) opens the SAME
 * control rather than a second one that looks almost like it. A player meets this
 * list on the Book tab and again while choosing where their trial will be; two
 * implementations would drift on ordering, on what a row shows, or on which one is
 * ticked, and a branch chooser that behaves differently in two places is worse
 * than one that is merely plain.
 *
 * Presentation only: the caller owns `options`, `selectedId` and what a choice
 * means — for the toggle it is what you are browsing, for the trial it is which
 * package you are about to request.
 */
export function LocationSheet({
  open,
  title,
  options,
  selectedId,
  onSelect,
  onClose,
}: {
  open: boolean;
  title: string;
  options: readonly Location[];
  selectedId: LocationId | null;
  onSelect: (id: LocationId) => void;
  onClose: () => void;
}) {
  const { color } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: color.scrim },
        sheet: {
          backgroundColor: color.bg.surface,
          borderTopLeftRadius: radius.lg,
          borderTopRightRadius: radius.lg,
          paddingTop: space.lg,
          paddingBottom: space.xxl,
          paddingHorizontal: space.lg,
          gap: space.xs,
        },
        sheetTitle: { marginBottom: space.xs },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: space.md,
          borderBottomWidth: 1,
          borderBottomColor: color.border.subtle,
        },
        rowText: { flex: 1, gap: 2 },
      }),
    [color],
  );

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close">
        {/* Stops a tap inside the sheet from closing it. */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          <Text variant="h2" style={styles.sheetTitle}>
            {title}
          </Text>
          {options.map((l) => {
            const isCurrent = l.id === selectedId;
            return (
              <Pressable
                key={l.id}
                style={styles.row}
                onPress={() => {
                  onSelect(l.id);
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: isCurrent }}
              >
                <View style={styles.rowText}>
                  <Text variant="body" weight={isCurrent ? 'semibold' : 'regular'}>
                    {l.name}
                  </Text>
                  <Text variant="caption" tone="secondary">
                    {l.hoursText}
                  </Text>
                </View>
                {isCurrent ? <Ionicons name="checkmark" size={20} color={color.accent.default} /> : null}
              </Pressable>
            );
          })}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
