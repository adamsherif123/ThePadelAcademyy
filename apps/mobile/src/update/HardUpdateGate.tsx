import { space } from '@tpa/theme';
import Constants from 'expo-constants';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AppState, Linking, Platform, StyleSheet, View } from 'react-native';

import { fetchVersionFloor } from '../lib/api';
import { shouldHardBlock } from '../lib/version';
import { BrandMark, Button, NavyScreen, Text } from '../ui';

/** The App Store page. The numeric id is the App Store app id, not the bundle id. */
const APP_STORE_URL = 'https://apps.apple.com/app/id6793803171';
/** Opens the Store app directly; falls back to https when nothing handles the scheme. */
const APP_STORE_DEEP_LINK = 'itms-apps://apps.apple.com/app/id6793803171';

/** How long the floor lookup gets before we give up and let the app through. */
const LOOKUP_TIMEOUT_MS = 5000;

/**
 * The hard update gate: a build below app_config.min_supported_ios_version cannot
 * be used at all.
 *
 * This exists because the locations release has to be able to retire old binaries.
 * 1.2 and 1.3 are both live and neither reads the floor, so neither can ever be
 * blocked — this ships the reader so every build from 1.3.1 on can be.
 *
 * ── it wraps the navigator, it is not a route ──
 * A pushed screen is dismissable by definition: a back gesture, a hardware back, a
 * modal swipe, or any router.replace from a guard would put the user straight back
 * into an app we have just decided must not run. So this renders INSTEAD of the
 * tree, above the router, and there is nothing to dismiss. It also sits outside
 * SessionProvider's notion of readiness, so it covers (auth) and (coach) and works
 * signed out — which is most of the point, since a blocked user may never get a
 * session at all.
 *
 * ── every failure renders children ──
 * Offline, a rejected fetch, a timeout, a null floor, an unparseable version, a
 * non-iOS platform: all of them fall through to the app. The asymmetry is
 * deliberate and is the whole safety argument — a missed gate leaves someone on an
 * old build for another day, while a false gate is an app that cannot be opened and
 * cannot be fixed without an App Store review cycle. `isBelowMinimum` fails open for
 * the same reason, and the timeout exists so a hung request degrades to "open the
 * app" rather than "hang on a blank screen".
 *
 * ── it never delays first paint ──
 * `blocked` starts false and children render immediately; the gate only ever takes
 * over once a positive answer has come back. Nothing here is awaited before the
 * first frame. The one thing it must do when it does take over is hide the splash
 * itself — RootNavigator normally does that, and it is no longer mounted.
 *
 * ── deliberately NOT sending a client-version header ──
 * The server-side net for the locations release identifies legacy clients by the
 * absence of that header. 1.3.1 must stay legacy: it cannot filter by location, so
 * it must keep being treated as a client that only sees the original branch.
 */
export function HardUpdateGate({ children }: { children: ReactNode }) {
  // Starts false — "not known to be too old" — which is both the safe state and
  // the one that lets the app paint immediately.
  const [blocked, setBlocked] = useState(false);

  const check = useCallback(() => {
    // The platform and version rules live in shouldHardBlock, where they are unit
    // tested; this early exit only avoids a pointless network call on Android.
    if (Platform.OS !== 'ios') return;

    const installed = Constants.expoConfig?.version;
    if (!installed) return; // can't prove anything about an unknown build

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true; // a hung lookup must not hold anyone out
    }, LOOKUP_TIMEOUT_MS);

    void fetchVersionFloor()
      .then((floor) => {
        if (timedOut) return;
        if (shouldHardBlock(Platform.OS, installed, floor)) setBlocked(true);
      })
      .catch(() => {
        // Offline, RLS, a dropped connection — all mean "we don't know", which is
        // not the same as "too old". Swallowed on purpose.
      })
      .finally(() => {
        clearTimeout(timer);
      });
  }, []);

  // Cold start.
  useEffect(() => {
    check();
  }, [check]);

  // Foreground: an app left open across a config bump gets gated on its next
  // return, rather than running unblocked until it happens to be killed.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') check();
    });
    return () => sub.remove();
  }, [check]);

  // RootNavigator hides the splash when the session resolves. If we are rendering
  // instead of it, that never runs and this screen would sit invisible behind the
  // splash forever.
  useEffect(() => {
    if (blocked) void SplashScreen.hideAsync().catch(() => {});
  }, [blocked]);

  if (!blocked) return <>{children}</>;

  const openStore = () => {
    void Linking.openURL(APP_STORE_DEEP_LINK).catch(() => {
      void Linking.openURL(APP_STORE_URL).catch(() => {});
    });
  };

  return (
    <NavyScreen
      // `style`, not contentContainerStyle: this Screen is not `scroll`, so the
      // content container is never used (same trap update-prompt.tsx calls out).
      style={styles.content}
      footer={<Button label="Update now" icon="cloud-download-outline" onPress={openStore} />}
    >
      <View style={styles.body}>
        <BrandMark />
        <Text variant="h1" tone="inverse" style={styles.heading}>
          Time to update
        </Text>
        <Text variant="body" tone="muted" style={styles.heading}>
          This version of the app is no longer supported. Update to keep booking your sessions.
        </Text>
      </View>
    </NavyScreen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center' },
  body: { alignItems: 'center', gap: space.md },
  heading: { textAlign: 'center' },
});
