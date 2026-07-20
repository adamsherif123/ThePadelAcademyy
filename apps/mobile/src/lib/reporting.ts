// Crash/error reporting for the mobile app.
//
// Sentry when a DSN is configured AND we're not in dev; a no-op (dev console) otherwise
// — so it never spams during development and does nothing until activated. The SDK is
// loaded LAZILY (dynamic import), never at module-eval time: the same discipline that
// fixed the Expo Go crash, so a dev/Expo-Go run never touches the native SDK. Reporting
// must NEVER break the app, so every path is guarded.
//
// ACTIVATION (one line): set EXPO_PUBLIC_SENTRY_DSN in the build's env (EAS secret or
// .env). For readable native stacks + source-map upload, also add the config plugin and
// metro config — see docs/PRODUCTION_CUTOVER.md. Sentry.init already captures unhandled
// JS errors AND unhandled promise rejections; those extras just make the stacks nicer.
type SentryNS = typeof import('@sentry/react-native');

let sentry: SentryNS | null = null;
let started = false;

function dsn(): string | null {
  const d = process.env.EXPO_PUBLIC_SENTRY_DSN;
  return typeof d === 'string' && d.length > 0 ? d : null;
}

/** Initialise reporting once, early. Gated to production/preview builds with a DSN. */
export async function initReporting(): Promise<void> {
  if (started) return;
  started = true;
  const d = dsn();
  if (!d || __DEV__) return;
  try {
    const S = await import('@sentry/react-native');
    S.init({
      dsn: d,
      enabled: true,
      environment: 'production',
      tracesSampleRate: 0.1,
    });
    sentry = S;
  } catch {
    sentry = null; // a reporting failure must not crash the app
  }
}

/** Report a caught error (error boundary, seams). Sentry if active, else a dev log. */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (sentry) {
    try {
      sentry.captureException(error, context ? { extra: context } : undefined);
    } catch {
      /* ignore — never throw from the reporter */
    }
  } else if (__DEV__) {
    console.error('[reporting]', error, context ?? '');
  }
}
