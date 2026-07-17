import { CloudOff, Loader2 } from 'lucide-react';

import { Button } from './Button';

/**
 * The two states every page now shows, since data is remote and async: a bounded
 * spinner while loading and a real error with Retry — never an endless spinner
 * (the client's Task-5 discipline, applied here).
 */
export function LoadingView({ label = 'Loading…' }: { label?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '64px 24px', color: 'var(--color-text-muted, #667)' }}>
      <Loader2 size={22} className="tpa-spin" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorView({
  onRetry,
  title = 'Couldn’t load',
  message = 'We couldn’t reach the academy. Check your connection and try again.',
}: {
  onRetry: () => void;
  title?: string;
  message?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '64px 24px', textAlign: 'center' }}>
      <CloudOff size={26} />
      <div style={{ fontWeight: 700 }}>{title}</div>
      <div style={{ color: 'var(--color-text-muted, #667)', maxWidth: 360 }}>{message}</div>
      <Button variant="secondary" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
