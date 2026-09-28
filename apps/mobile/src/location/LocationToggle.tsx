import Ionicons from '@expo/vector-icons/Ionicons';
import { radius, space } from '@tpa/theme';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui';
import { useLocation } from './LocationProvider';
import { LocationMenu } from './LocationMenu';

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
 * ── a pill that drops a menu, not a segmented control ──
 * Branch names are real place names of unpredictable length, and there may be
 * more than two one day. A pill reads the same with two branches or five and
 * never truncates a name to fit.
 *
 * It used to open a bottom sheet. A sheet is a modal context — it dims the app
 * and slides up from somewhere unrelated to what you touched — and choosing a
 * branch is a filter, not a detour. The menu falls out of the pill instead; see
 * LocationMenu.
 */
export function LocationToggle() {
  const { color } = useTheme();
  const { selected, options, showToggle, select } = useLocation();

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
      }),
    [color],
  );

  if (!showToggle || !selected) return null;

  return (
    <View style={styles.bar}>
      <LocationMenu
        options={options}
        selectedId={selected.id}
        onSelect={select}
        trigger={({ open, toggle }) => (
          <Pressable
            style={styles.pill}
            onPress={toggle}
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            accessibilityLabel={`Location: ${selected.name}. Tap to change.`}
          >
            <Ionicons name="location-outline" size={15} color={color.text.secondary} />
            <Text variant="caption" weight="semibold">
              {selected.name}
            </Text>
            {/* Points at the menu it opens, and back at the pill once it is
                open — the cheapest possible signal that the two are one
                control. */}
            <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={color.text.muted} />
          </Pressable>
        )}
      />
    </View>
  );
}
