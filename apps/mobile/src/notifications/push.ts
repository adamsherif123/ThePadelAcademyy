// The expo-notifications integration — thin, and it NEVER throws: every function
// returns a state so the app stays fully functional without push (permission denied,
// a simulator with no token, or an unconfigured EAS project). Remote push requires an
// EAS dev build; it does not work in Expo Go (SDK 53+). See NOTIFICATIONS_SETUP.md.
import { color } from '@tpa/theme';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { Platform as PushPlatform } from '../lib/api';

/**
 * FOREGROUND BEHAVIOUR — show the banner (and list + no sound/badge) even when the
 * app is open. Justification: a "session confirmed" / "credits added" push is genuine,
 * timely news the player wants to see the moment it happens; the ambient banner is the
 * right signal, and the Realtime subscription simultaneously refreshes the in-app state
 * so the wallet/sessions already match by the time they look. Sound/badge are off to
 * keep an open-app interruption light. Module-level so it's installed once at import.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** This device's OS mapped to the token's platform column, or null (web/unknown). */
export function pushPlatform(): PushPlatform | null {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return null;
}

/** Android needs a channel for heads-up delivery. No-op on iOS/web. */
export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Default',
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: color.accent.default,
  });
}

/** The EAS project id needed to mint an Expo push token. Empty until `eas init`. */
function easProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  const id = extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

export type PushRegistration =
  | { status: 'ok'; token: string; platform: PushPlatform }
  | { status: 'denied' }
  | { status: 'unavailable'; reason: string };

/**
 * Request permission (idempotent) and fetch this device's Expo push token. Denial is a
 * first-class state — the caller does nothing and the app works fully without push. On
 * a simulator/emulator no token issues ('unavailable: simulator'); without an EAS
 * project id, likewise ('unavailable: no_eas_project_id').
 */
export async function registerForPush(): Promise<PushRegistration> {
  const platform = pushPlatform();
  if (!platform) return { status: 'unavailable', reason: 'unsupported_platform' };
  if (!Device.isDevice) return { status: 'unavailable', reason: 'simulator' };

  await ensureAndroidChannel();

  const existing = await Notifications.getPermissionsAsync();
  let granted = existing.granted;
  if (!granted && existing.canAskAgain) {
    granted = (await Notifications.requestPermissionsAsync()).granted;
  }
  if (!granted) return { status: 'denied' };

  const projectId = easProjectId();
  if (!projectId) return { status: 'unavailable', reason: 'no_eas_project_id' };

  try {
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return { status: 'ok', token: data, platform };
  } catch (e) {
    return { status: 'unavailable', reason: e instanceof Error ? e.message : 'token_error' };
  }
}
