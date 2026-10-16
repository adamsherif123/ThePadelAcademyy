import { Linking, Platform } from 'react-native';

import { storeUrls } from '../lib/version';

/**
 * Opens this platform's store listing for the app — the one thing both "Update
 * now" buttons do.
 *
 * Tries storeUrls() in order and stops at the first that opens. Each URL rejects
 * when nothing on the device can handle it (a simulator with no App Store, an
 * emulator or de-Googled phone with no Play Store app for market://), so the next
 * is tried, and the last failure is swallowed: an update button must never crash.
 * Which URLs, in which order, is decided (and unit tested) in version.ts.
 */
export async function openStore(surface: 'gate' | 'prompt'): Promise<void> {
  for (const url of storeUrls(Platform.OS, surface)) {
    try {
      await Linking.openURL(url);
      return;
    } catch {
      // Try the next one.
    }
  }
}
