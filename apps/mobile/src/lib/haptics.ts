// The app's ONE haptic vocabulary. Every call site uses this — never
// `expo-haptics` directly — so the whole feel can be tuned or globally
// disabled from one place (the parity discipline applied to feel).
//
// Seasoning, not sauce: haptics are placed at consequential-action
// confirmations and rejections, not on every tap. See the call sites for
// which moments earned one and why.
//
// NEVER blocks: every intent is a fire-and-forget `void` call (`haptics.
// success()`, never `await haptics.success()`) — the buzz accompanies an
// outcome, it never gates one. NEVER throws: expo-haptics already no-ops
// silently on hardware with no haptics engine, and iOS's own "System
// Haptics" OS toggle silently no-ops the native call when the user has
// turned haptics off system-wide (no app code needed for that case) — the
// try/catch below is defence in depth on top of both.
//
// "Reduce Motion" is a SEPARATE OS setting from System Haptics (it governs
// animation, not vibration), and neither iOS nor Android gates haptics on it
// automatically — so this module gates it itself: a user who's told their OS
// they want a calmer experience shouldn't still feel every buzz.
import * as Haptics from 'expo-haptics';
import { AccessibilityInfo } from 'react-native';

let reduceMotionEnabled = false;
void AccessibilityInfo.isReduceMotionEnabled()
  .then((enabled) => {
    reduceMotionEnabled = enabled;
  })
  .catch(() => {
    // Unsupported platform (web) or a query failure — default to haptics ON.
  });
AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
  reduceMotionEnabled = enabled;
});

async function fire(run: () => Promise<void>): Promise<void> {
  if (reduceMotionEnabled) return;
  try {
    await run();
  } catch {
    // No haptics engine, haptics disabled system-wide, or an unsupported
    // platform (web) — never surface this to the caller.
  }
}

export const haptics = {
  /** A consequential action succeeded — booked, submitted, purchased/granted. */
  success(): void {
    void fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
  },
  /** Weighty but not celebratory — a cancellation, an account deletion. */
  warning(): void {
    void fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
  },
  /** A submitted action came back rejected. */
  error(): void {
    void fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
  },
  /** A subtle selection tick — picking between a few discrete options. */
  light(): void {
    void fire(() => Haptics.selectionAsync());
  },
  /** A firmer single tap — consequential but not success/failure. */
  medium(): void {
    void fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
  },
};
