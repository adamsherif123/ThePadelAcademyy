import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { useAppConfig, useUnseenNews } from '../data/queries';
import { isOutdated } from '../lib/version';
import { useSession } from '../session/SessionProvider';
import { cairoDayKey, readDismissedOn } from './updatePrompt';

/**
 * Decides WHEN the "please update" pop-up appears — cold start and foreground,
 * mirroring NewsPopupBridge (mounted unconditionally in the root layout, no-ops
 * until the session is ready).
 *
 * Every gate below is a reason NOT to show it, and each one fails closed:
 *   • status !== 'ready'  — never over sign-in, mid-auth, or before restore.
 *   • unseen news pending — the news pop-up wins (see precedence note below).
 *   • no config data      — offline or the fetch failed. A launch with no
 *                           connectivity shows nothing, no error, no retry loop.
 *   • version unreadable  — can't prove they're behind, so don't claim it.
 *   • not actually behind — isOutdated is false for equal AND newer (TestFlight).
 *   • dismissed today     — the once-a-day rule, keyed on the Cairo day.
 *
 * ── precedence: news first ──
 * Both pop-ups fire on the same launch signal, so without a rule they'd stack two
 * modals on top of each other. News wins: it's content the academy deliberately
 * published and wants read, whereas this is a soft nudge that will come back
 * tomorrow anyway. Opening the news pop-up marks it seen, so the unseen set
 * empties and the update prompt gets its turn on the next launch or foreground.
 *
 * ── the installed version ──
 * Constants.expoConfig.version is the app.json `version` baked in at build time,
 * which IS CFBundleShortVersionString for this project. That holds because there
 * is no expo-updates/OTA here — if OTA is ever added, an update could carry a
 * manifest version that differs from the installed binary, and this should move to
 * expo-application's nativeApplicationVersion.
 */
export function UpdatePromptBridge(): null {
  const { status, now } = useSession();
  const router = useRouter();
  const configQ = useAppConfig();
  const unseenQ = useUnseenNews(now);
  // Read once on mount; the per-session ref below covers the rest of this run.
  const [dismissedOn, setDismissedOn] = useState<string | null | undefined>(undefined);
  const shownRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void readDismissedOn().then((v) => {
      if (!cancelled) setDismissedOn(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const tryShow = useCallback(() => {
    if (shownRef.current) return;
    if (status !== 'ready') return;
    if (dismissedOn === undefined) return; // storage not read yet
    if (unseenQ.data && unseenQ.data.length > 0) return; // news pop-up wins
    const latest = configQ.data?.latestIosVersion;
    if (!latest) return; // offline / no config row / fetch failed
    const installed = Constants.expoConfig?.version;
    if (!isOutdated(installed, latest)) return;
    if (dismissedOn === cairoDayKey(now)) return; // already answered today
    shownRef.current = true;
    router.push('/update-prompt');
  }, [status, dismissedOn, unseenQ.data, configQ.data, now, router]);

  // Cold start, and whenever any gate resolves (offline-then-reconnects included).
  useEffect(() => {
    tryShow();
  }, [tryShow]);

  // Foreground (backgrounded then reopened).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') tryShow();
    });
    return () => sub.remove();
  }, [tryShow]);

  return null;
}
