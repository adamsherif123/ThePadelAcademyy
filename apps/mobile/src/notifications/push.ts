// The expo-notifications integration — thin, and it NEVER throws: every function
// returns a state so the app stays fully functional without push (permission denied,
// a simulator with no token, or an unconfigured EAS project). Remote push requires an
// EAS dev build; it does not work in Expo Go (SDK 53+). See NOTIFICATIONS_SETUP.md.
import { color } from '@tpa/theme';
import Constants, { AppOwnership } from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { Platform as PushPlatform } from '../lib/api';

/**
 * True ONLY inside Expo Go, where SDK 53+ REMOVED remote-push support: the token and
 * listener APIs throw ("Android Push notifications … was removed from Expo Go"). We must
 * discriminate Expo Go from a real EAS DEV build — in SDK 56 the two are NOT separable by
 * `executionEnvironment` (both report `storeClient`), so that check would wrongly no-op a
 * dev build and kill the feature. `appOwnership` is `'expo'` ONLY in Expo Go (a dev or
 * production build reports `null`), so it is the reliable discriminator. In Expo Go the
 * whole remote subsystem is skipped — the in-app centre + Realtime keep working; only the
 * OS banner (which Expo Go can't deliver anyway) is absent.
 */
export function isExpoGo(): boolean {
  return Constants.appOwnership === AppOwnership.Expo;
}

/**
 * FOREGROUND BEHAVIOUR — show the banner (and list + no sound/badge) even when the
 * app is open. Justification: a "session confirmed" / "credits added" push is genuine,
 * timely news the player wants to see the moment it happens; the ambient banner is the
 * right signal, and the Realtime subscription simultaneously refreshes the in-app state
 * so the wallet/sessions already match by the time they look. Sound/badge are off to
 * keep an open-app interruption light. Module-level so it's installed once at import —
 * skipped in Expo Go and guarded so an import-time throw can never crash the app.
 */
if (!isExpoGo()) {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // no-op: foreground presentation just falls back to the OS default.
  }
}

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
 * Request permission (idempotent) and fetch this device's Expo push token. It NEVER
 * throws — every path returns a status the bridge already handles, so a registration
 * failure can never crash the app. First-class non-ok states: Expo Go (remote push is
 * absent — 'expo_go'), a simulator ('simulator'), permission denied ('denied'), no EAS
 * project id ('no_eas_project_id'), or any unexpected native throw ('registration_error').
 */
export async function registerForPush(): Promise<PushRegistration> {
  // Skip the ENTIRE remote-push subsystem in Expo Go BEFORE calling any native API that
  // would throw there.
  if (isExpoGo()) return { status: 'unavailable', reason: 'expo_go' };

  try {
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

    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return { status: 'ok', token: data, platform };
  } catch (e) {
    // Belt-and-braces: any native throw (incl. a future SDK removing another API in
    // Expo Go) becomes an unavailable status, never an uncaught crash.
    return { status: 'unavailable', reason: e instanceof Error ? e.message : 'registration_error' };
  }
}
