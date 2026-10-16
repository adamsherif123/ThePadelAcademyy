import { space } from '@tpa/theme';
import Constants from 'expo-constants';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AppState, BackHandler, Platform, StyleSheet, View } from 'react-native';

import { fetchVersionFloor } from '../lib/api';
import { shouldHardBlock, storePlatform } from '../lib/version';
import { BrandMark, Button, NavyScreen, Text } from '../ui';
import { openStore } from './openStore';

/** How long the floor lookup gets before we give up and let the app through. */
const LOOKUP_TIMEOUT_MS = 5000;

/**
 * The hard update gate: a build below this platform's floor —
 * app_config.min_supported_ios_version on iOS, min_supported_android_version on
 * Android (073) — cannot be used at all.
 *
 * This exists because the locations release has to be able to retire old binaries.
 * 1.2 and 1.3 are both live and neither reads the floor, so neither can ever be
 * blocked — this ships the reader so every build from 1.3.1 on can be. Android
 * has it from its very first build, so no Android binary is ever unretireable.
 *
 * ── it wraps the navigator, it is not a route ──
 * A pushed screen is dismissable by definition: a back gesture, a hardware back, a
 * modal swipe, or any router.replace from a guard would put the user straight back
 * into an app we have just decided must not run. So this renders INSTEAD of the
 * tree, above the router, and there is nothing to dismiss. Android's hardware back
 * is swallowed while blocked as well — with no navigator mounted it would close
 * the activity, and reopening an app that just quit reads as a crash rather than
 * "update needed". (Predictive back is off in app.json, so BackHandler sees it.) It also sits outside
 * SessionProvider's notion of readiness, so it covers (auth) and (coach) and works
 * signed out — which is most of the point, since a blocked user may never get a
 * session at all.
 *
 * ── every failure renders children ──
 * Offline, a rejected fetch, a timeout, a null floor, an unparseable version, a
 * platform with no store, a backend without this platform's column (an Android
 * build against a pre-073 project gets 400/42703, which throws): all of them fall
 * through to the app. The asymmetry is
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
 * ── the client-version header ──
 * The floor read goes through the shared Supabase client, so it carries the
 * x-tpa-client header like every other request (supabase.ts). It reads only
 * app_config, which the header does not affect.
 */
export function HardUpdateGate({ children }: { children: ReactNode }) {
  // Starts false — "not known to be too old" — which is both the safe state and
  // the one that lets the app paint immediately.
  const [blocked, setBlocked] = useState(false);

  const check = useCallback(() => {
    // The platform and version rules live in shouldHardBlock, where they are unit
    // tested; this early exit only avoids a pointless network call off-store (web).
    const store = storePlatform(Platform.OS);
    if (!store) return;

    const installed = Constants.expoConfig?.version;
    if (!installed) return; // can't prove anything about an unknown build

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true; // a hung lookup must not hold anyone out
    }, LOOKUP_TIMEOUT_MS);

    void fetchVersionFloor(store)
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

  // Android hardware back: consumed while blocked, so it cannot close the app out
  // from under the update screen. Returning true stops the default (finish the
  // activity). Registered only while blocked — an unblocked app's back belongs to
  // the router and its screens.
  useEffect(() => {
    if (!blocked) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [blocked]);

  if (!blocked) return <>{children}</>;

  return (
    <NavyScreen
      // `style`, not contentContainerStyle: this Screen is not `scroll`, so the
      // content container is never used (same trap update-prompt.tsx calls out).
      style={styles.content}
      // iOS: itms-apps, then https — as shipped. Android: market://, then https.
      footer={<Button label="Update now" icon="cloud-download-outline" onPress={() => void openStore('gate')} />}
    >
      {/* Navy in both schemes: light icons, overriding the root's themed bar while
          this screen stands in for the whole app. */}
      <StatusBar style="light" />
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
