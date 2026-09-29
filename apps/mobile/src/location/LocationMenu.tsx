import Ionicons from '@expo/vector-icons/Ionicons';
import { radius, space } from '@tpa/theme';
import type { Location, LocationId } from '@tpa/types';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  I18nManager,
  Modal,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type View as RNView,
  type ViewStyle,
} from 'react-native';

import { haptics } from '../lib/haptics';
import { shadow } from '../theme/shadow';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from '../ui';

/** Screen-space box of the control the menu hangs off. */
interface AnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MIN_WIDTH = 220;
const GUTTER = space.lg;
/** The hairline of air between the trigger and the card, so they read as attached. */
const OFFSET = 6;
/** Enough per row to choose a side without measuring the card and costing a frame. */
const ROW_HEIGHT = 40;

/**
 * A branch dropdown that falls out of the control you tapped.
 *
 * ── why not a bottom sheet ──
 * It was one, and a sheet is the wrong weight for this. A sheet is a modal
 * context: it dims the app, slides up from somewhere unrelated to what you
 * touched, and asks to be dismissed. Choosing a branch is a filter, not a
 * detour — the menu should appear where the control is, let you pick, and get
 * out of the way. So: no scrim, no slide, a card anchored to the trigger, and a
 * tap anywhere to dismiss.
 *
 * ── it owns the trigger ──
 * The caller renders its own control through `trigger` and this component wraps
 * it, so the anchor ref is created and consumed in one place. A caller cannot
 * forget to attach it, the app's two triggers cannot drift on how they measure,
 * and the ref never crosses a hook boundary into somebody else's render — which
 * is what react-hooks/refs is there to prevent, and it rejects a hook that hands
 * a ref out through a returned object.
 *
 * ── it matches the control it came from ──
 * The card takes the trigger's width when the trigger is wide (the full-width
 * row in the trial flow) and a comfortable minimum when it is not (the compact
 * pill on the tabs), aligned to the trigger's leading edge, so it reads as an
 * extension of it rather than a panel that happens to be nearby.
 *
 * It flips ABOVE the trigger when there is not enough room below, and never runs
 * past either side gutter — the pill sits near the top of some screens and the
 * form row halfway down another, and a menu that opens off-screen is a control
 * the player cannot use.
 */
export function LocationMenu({
  options,
  selectedId,
  onSelect,
  trigger,
  anchorStyle,
}: {
  options: readonly Location[];
  selectedId: LocationId | null;
  onSelect: (id: LocationId) => void;
  /** The caller's own control. `open` is for its chevron; `toggle` is its onPress. */
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode;
  /** The wrapper shrink-wraps the trigger by default; pass stretch for a full-width row. */
  anchorStyle?: ViewStyle;
}) {
  const { color } = useTheme();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const anchorRef = useRef<RNView>(null);
  const [rect, setRect] = useState<AnchorRect | null>(null);
  const [open, setOpen] = useState(false);

  // `toggle` only flips state — it never touches the ref, so nothing
  // ref-derived is handed to `trigger` during render. Clearing the rect here
  // (an event handler) rather than in the effect means the next open always
  // waits for a fresh measure instead of flashing at the position the trigger
  // used to have, which matters because both triggers live in scroll views.
  const toggle = useCallback(() => {
    // A selection tick, the same one pick-type uses: you have entered a chooser.
    // On the way closed too — the control answered you either way.
    haptics.light();
    setRect(null);
    setOpen((wasOpen) => !wasOpen);
  }, []);

  // The measurement happens HERE, in an effect, which is where React says a ref
  // should be read — and on OPEN rather than on layout, because a rect captured
  // at layout time is wrong the moment the player scrolls. It cannot live in the
  // event handler: that makes the ref reachable from render through `trigger`,
  // which react-hooks/refs rejects, and rightly.
  useEffect(() => {
    if (!open) return;
    anchorRef.current?.measureInWindow((x, y, width, height) => setRect({ x, y, width, height }));
  }, [open]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        anchor: { alignSelf: 'flex-start' },
        backdrop: { flex: 1 },
        card: {
          position: 'absolute',
          backgroundColor: color.bg.surface,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: color.border.subtle,
          paddingVertical: space.xs,
          ...shadow('lg'),
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          paddingVertical: space.sm,
          paddingHorizontal: space.md,
        },
        rowPressed: { backgroundColor: color.bg.canvas },
        // The name yields and the tick never does, so a long branch name
        // truncates rather than pushing the tick out of the card.
        rowName: { flex: 1 },
      }),
    [color],
  );

  // Sized to the trigger, floored so a compact pill still gets a usable menu,
  // capped so neither edge escapes the screen gutters.
  const width = Math.min(Math.max(rect?.width ?? 0, MIN_WIDTH), screenW - GUTTER * 2);
  // measureInWindow reports a PHYSICAL x; `start` is logical. Converting here is
  // what makes the menu hang off the same edge of the trigger in Arabic as it
  // does in English, instead of jumping to the other side of the screen.
  const physicalStart = rect ? (I18nManager.isRTL ? screenW - (rect.x + rect.width) : rect.x) : GUTTER;
  const start = Math.min(Math.max(physicalStart, GUTTER), Math.max(GUTTER, screenW - width - GUTTER));

  const estimatedHeight = options.length * ROW_HEIGHT + space.xs * 2;
  const below = (rect?.y ?? 0) + (rect?.height ?? 0) + OFFSET;
  const flip = below + estimatedHeight > screenH - GUTTER;
  const top = flip ? Math.max(GUTTER, (rect?.y ?? 0) - estimatedHeight - OFFSET) : below;

  return (
    <>
      {/* collapsable={false} keeps this View in the Android view tree — an
          optimised-away wrapper cannot be measured, and the menu would open at
          the top-left corner of the screen. */}
      <View ref={anchorRef} collapsable={false} style={[styles.anchor, anchorStyle]}>
        {trigger({ open, toggle })}
      </View>

      <Modal
        visible={open && rect !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        {/* No scrim. A dropdown is not a modal context — dimming the screen
            behind a two-item filter overstates what is happening. The backdrop
            exists only to catch the tap that dismisses it. */}
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Close" />
        <View style={[styles.card, { top, start, width }]}>
          {options.map((l) => {
            const isCurrent = l.id === selectedId;
            return (
              <Pressable
                key={l.id}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                onPress={() => {
                  // Only when the branch actually CHANGES. Re-picking the one you
                  // are already on changes nothing, and a buzz there would be the
                  // phone telling you something happened when nothing did.
                  // Firmer than the open tick because this one is consequential:
                  // the feed, the wallet and every price on screen move with it.
                  if (!isCurrent) haptics.medium();
                  onSelect(l.id);
                  setOpen(false);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: isCurrent }}
              >
                {/* The name, and nothing else. Opening hours were here and
                    truncated to "5:00 PM – 11:…" at this width; they are also
                    not what you are choosing on — the branch is. The selected
                    branch's hours are on Home's academy card, in full. */}
                <Text
                  variant="body"
                  weight={isCurrent ? 'semibold' : 'regular'}
                  style={styles.rowName}
                  numberOfLines={1}
                >
                  {l.name}
                </Text>
                {isCurrent ? <Ionicons name="checkmark" size={18} color={color.accent.default} /> : null}
              </Pressable>
            );
          })}
        </View>
      </Modal>
    </>
  );
}
