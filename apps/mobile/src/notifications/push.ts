// The expo-notifications integration. It NEVER throws and — critically — NEVER touches
// expo-notifications at module-eval time.
//
// WHY NO STATIC IMPORT: importing expo-notifications runs its own module-scope
// auto-registration side effect (DevicePushTokenAutoRegistration.fx → addPushTokenListener
// → warnOfExpoGoPushUsage), which THROWS on Android in Expo Go (SDK 53+ removed remote
// push there; iOS only warns). A static `import … from 'expo-notifications'` would throw
// during THIS module's import — before any guard runs — taking down the whole route tree.
// So expo-notifications is loaded lazily, ONLY when not in Expo Go, and every call is
// try/caught. In Expo Go it is never imported, so the side effect never evaluates.
import { color } from '@tpa/theme';
import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import type { Platform as PushPlatform } from '../lib/api';

/**
 * True ONLY inside Expo Go. Uses `isRunningInExpoGo()` — a native-module presence check
 * (`requireNativeModule('ExpoGo') != null`), the SAME signal expo-notifications itself
 * uses to decide whether to throw. So our guard is exactly aligned with the throw: true
 * only where the library would throw, false in every dev/production build (which have no
 * ExpoGo native module). `appOwnership`/`executionEnvironment` are NOT reliable here.
 */
export function isExpoGo(): boolean {
  return isRunningInExpoGo();
}

/**
 * Lazily load expo-notifications — and ONLY outside Expo Go, so its throwing module-scope
 * side effect never evaluates there. Returns null when unavailable (Expo Go, or a load
 * failure), so every caller degrades instead of throwing.
 */
async function loadNotifications(): Promise<typeof import('expo-notifications') | null> {
  if (isExpoGo()) return null;
  try {
    return await import('expo-notifications');
  } catch {
    return null;
  }
}

/** This device's OS mapped to the token's platform column, or null (web/unknown). */
export function pushPlatform(): PushPlatform | null {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return null;
}

/** The EAS project id needed to mint an Expo push token. Empty until `eas init`. */
function easProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  const id = extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * FOREGROUND BEHAVIOUR — show the banner (+ list, no sound/badge) even when the app is
 * open: a "session confirmed" / "credits added" push is timely news, and the Realtime
 * subscription refreshes the in-app state alongside it. Called once from an effect (NOT
 * at module scope), guarded and try/caught. No-op in Expo Go.
 */
export async function setupForegroundHandler(): Promise<void> {
  const N = await loadNotifications();
  if (!N) return;
  try {
    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // no-op: foreground presentation falls back to the OS default.
  }
}

async function ensureAndroidChannel(N: typeof import('expo-notifications')): Promise<void> {
  if (Platform.OS !== 'android') return;
  await N.setNotificationChannelAsync('default', {
    name: 'Default',
    importance: N.AndroidImportance.DEFAULT,
    lightColor: color.accent.default,
  });
}

export type PushRegistration =
  | { status: 'ok'; token: string; platform: PushPlatform }
  | { status: 'denied' }
  | { status: 'unavailable'; reason: string };

/**
 * Request permission (idempotent) and fetch this device's Expo push token. NEVER throws —
 * every path returns a status the bridge already handles. Non-ok states: Expo Go
 * ('expo_go'), a simulator ('simulator'), permission denied ('denied'), no EAS project id
 * ('no_eas_project_id'), or any native throw ('registration_error').
 */
export async function registerForPush(): Promise<PushRegistration> {
  if (isExpoGo()) return { status: 'unavailable', reason: 'expo_go' };
  try {
    const platform = pushPlatform();
    if (!platform) return { status: 'unavailable', reason: 'unsupported_platform' };
    if (!Device.isDevice) return { status: 'unavailable', reason: 'simulator' };

    const N = await loadNotifications();
    if (!N) return { status: 'unavailable', reason: 'module_unavailable' };

    await ensureAndroidChannel(N);

    const existing = await N.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted && existing.canAskAgain) {
      granted = (await N.requestPermissionsAsync()).granted;
    }
    if (!granted) return { status: 'denied' };

    const projectId = easProjectId();
    if (!projectId) return { status: 'unavailable', reason: 'no_eas_project_id' };

    const { data } = await N.getExpoPushTokenAsync({ projectId });
    return { status: 'ok', token: data, platform };
  } catch (e) {
    return { status: 'unavailable', reason: e instanceof Error ? e.message : 'registration_error' };
  }
}

/** The deep-link payload send-push attaches to each notification. */
export type PushTapData = { notificationId?: string; type?: string; slotId?: string | null };

function tapDataFrom(response: import('expo-notifications').NotificationResponse): PushTapData {
  const d = (response?.notification?.request?.content?.data ?? {}) as PushTapData;
  return { notificationId: d.notificationId, type: d.type, slotId: d.slotId ?? null };
}

/**
 * Subscribe to foreground receipt (onForeground) and a tap (onTap). Returns a cleanup.
 * A no-op empty cleanup in Expo Go — keeps expo-notifications out of the bridge entirely,
 * so the bridge never triggers the throwing import.
 */
export async function addPushListeners(handlers: {
  onForeground: () => void;
  onTap: (data: PushTapData) => void;
}): Promise<() => void> {
  const N = await loadNotifications();
  if (!N) return () => {};
  try {
    const received = N.addNotificationReceivedListener(() => handlers.onForeground());
    const responded = N.addNotificationResponseReceivedListener((r) => handlers.onTap(tapDataFrom(r)));
    return () => {
      received.remove();
      responded.remove();
    };
  } catch {
    return () => {};
  }
}

/** The tap that cold-started the app from killed, or null (incl. Expo Go). Never throws. */
export async function getInitialTap(): Promise<PushTapData | null> {
  const N = await loadNotifications();
  if (!N) return null;
  try {
    const response = await N.getLastNotificationResponseAsync();
    return response ? tapDataFrom(response) : null;
  } catch {
    return null;
  }
}
