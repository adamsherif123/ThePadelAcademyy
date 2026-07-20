import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { queryClient } from './lib/queryClient';
import { initReporting } from './lib/reporting';
import { RootErrorBoundary } from './ui/RootErrorBoundary';

// Self-hosted Inter (no external request, no layout shift). Only the weights the
// theme uses — regular…extrabold. 900/black was deleted in S3e.2; don't ship it.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';

import { App } from './App';
import { SessionProvider } from './session/SessionProvider';
import './tokens.generated.css';
import './base.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

// Start crash reporting once, before render. No-op without a DSN / in dev; never throws.
initReporting();

createRoot(rootElement).render(
  <StrictMode>
    <RootErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <SessionProvider>
            <App />
          </SessionProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
