import Ionicons from '@expo/vector-icons/Ionicons';
import { radius, space } from '@tpa/theme';
import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui';
import { useLocation } from './LocationProvider';

/**
 * Which branch the app is showing, and how to change it.
 *
 * ── it lives in the screen's SCROLL CONTENT, not in the shell ──
 * It used to sit above <Tabs> in the tab layout — one control for the whole
 * shell. That put it outside every safe area: on a notched phone it rendered
 * under the Dynamic Island, where it could be read but not tapped. Screen
 * applies the top inset, so the fix is to be inside one. Each branch-scoped tab
 * renders its own instance; they all read the same context, so they cannot
 * disagree, and it scrolls away with the header it belongs to.
 *
 * Sessions deliberately does NOT render it. That list spans every branch by
 * design (a booking elsewhere must still appear), so a toggle there would be a
 * control that visibly does nothing — worse than no control at all.
 *
 * ── it disappears when there is nothing to choose ──
 * 1.4 ships before the second branch opens. With one active location the whole
 * control renders null, so the app looks exactly like 1.3 until the day the
 * branch goes live — at which point the pill simply appears. No flag, no build.
 *
 * ── a pill, not a segmented control ──
 * Branch names are real place names of unpredictable length, and there may be
 * more than two one day. A pill that opens a sheet reads the same with two
 * branches or five, and never truncates a name to fit.
 */
export function LocationToggle() {
  const { color } = useTheme();
  const { selected, options, showToggle, select } = useLocation();
  const [open, setOpen] = useState(false);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        // No padding and no background of its own: the pill is rendered INSIDE
        // each screen's scroll content, which already supplies the horizontal
        // gutter and the canvas. The negative bottom margin pulls it against the
        // header below, so it reads as a label on that screen rather than a
        // floating control with a screen-sized gap under it.
        bar: { marginBottom: -space.sm },
        pill: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.xs,
          alignSelf: 'flex-start',
          paddingVertical: space.xs,
          paddingHorizontal: space.sm,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: color.border.subtle,
          backgroundColor: color.bg.surface,
        },
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

  if (!showToggle || !selected) return null;

  return (
    <View style={styles.bar}>
      <Pressable
        style={styles.pill}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Location: ${selected.name}. Tap to change.`}
      >
        <Ionicons name="location-outline" size={15} color={color.text.secondary} />
        <Text variant="caption" weight="semibold">
          {selected.name}
        </Text>
        <Ionicons name="chevron-down" size={14} color={color.text.muted} />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Close">
          {/* Stops a tap inside the sheet from closing it. */}
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text variant="h2" style={styles.sheetTitle}>
              Choose a location
            </Text>
            {options.map((l) => {
              const isCurrent = l.id === selected.id;
              return (
                <Pressable
                  key={l.id}
                  style={styles.row}
                  onPress={() => {
                    select(l.id);
                    setOpen(false);
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
                  {isCurrent ? (
                    <Ionicons name="checkmark" size={20} color={color.accent.default} />
                  ) : null}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
