// Crash/error reporting for the admin app (Vite/React).
//
// Sentry when a DSN is configured AND we're in a production build; a no-op (dev console)
// otherwise. Sentry.init installs the browser handlers that capture unhandled errors and
// unhandled promise rejections. Reporting must NEVER break the app, so every path is
// guarded. ACTIVATION (one line): set VITE_SENTRY_DSN in the build env. For readable
// stacks, upload source maps at build time — see docs/PRODUCTION_CUTOVER.md.
import * as Sentry from '@sentry/react';

let enabled = false;

function dsn(): string | null {
  const d = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  return typeof d === 'string' && d.length > 0 ? d : null;
}

/** Initialise reporting once, at app start. Gated to production builds with a DSN. */
export function initReporting(): void {
  const d = dsn();
  if (!d || import.meta.env.DEV) return;
  try {
    Sentry.init({ dsn: d, environment: 'production', tracesSampleRate: 0.1 });
    enabled = true;
  } catch {
    enabled = false;
  }
}

/** Report a caught error (error boundary, seams). Sentry if active, else a dev log. */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (enabled) {
    try {
      Sentry.captureException(error, context ? { extra: context } : undefined);
    } catch {
      /* ignore */
    }
  } else if (import.meta.env.DEV) {
    console.error('[reporting]', error, context ?? '');
  }
}
