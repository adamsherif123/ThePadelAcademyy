import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { BackHandler } from 'react-native';

/**
 * Takes over Android's hardware back while `active`, on the FOCUSED screen only.
 *
 * Android has a back button that iOS does not, and by default it pops the screen —
 * which is wrong in two places this app has:
 *  - mid-submit: a booking or cancellation awaiting its RPC must not be popped out
 *    from under the navigation that runs when it lands (`router.replace` /
 *    `router.back` would then act on whatever screen is on top by then);
 *  - a screen whose header back does more than pop (profile-setup signs the
 *    half-finished account out first).
 *
 * `onBack` runs instead of the pop; omit it to simply swallow the press. Scoped by
 * useFocusEffect so a screen left mounted under a pushed one never steals that
 * screen's back. BackHandler never fires on iOS, so iOS behaviour is unchanged.
 * (Predictive back is off in app.json, so the press reaches BackHandler.)
 */
export function useHardwareBack(active: boolean, onBack?: () => void): void {
  useFocusEffect(
    useCallback(() => {
      if (!active) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        onBack?.();
        return true; // handled: no pop, no app exit
      });
      return () => sub.remove();
    }, [active, onBack]),
  );
}
