import { Component, type ReactNode } from 'react';

import { captureException } from '../lib/reporting';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Root render-error boundary. A rendering error anywhere in the admin shows a
 * recoverable screen (reload) instead of a dead white page, and reports to Sentry
 * (a no-op dev log until a DSN is set). A class component because getDerivedStateFromError
 * / componentDidCatch are the only way React catches render errors.
 */
export class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    captureException(error, { boundary: 'root' });
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            padding: 24,
            textAlign: 'center',
            background: 'var(--color-bg-canvas)',
            color: 'var(--color-text-primary)',
          }}
        >
          <h1 style={{ margin: 0 }}>Something went wrong</h1>
          <p style={{ margin: 0, opacity: 0.7 }}>The admin hit an unexpected error. Reloading usually fixes it.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: 8,
              padding: '10px 20px',
              borderRadius: 10,
              border: 'none',
              cursor: 'pointer',
              background: 'var(--color-accent-default)',
              color: 'var(--color-text-inverse)',
              fontWeight: 600,
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
