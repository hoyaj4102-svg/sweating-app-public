import { createRoot } from 'react-dom/client';

import App from './App';
import { discardSignupLink } from '@/auth/recovery-link';
import { ErrorBoundary } from '@/components/error-boundary';
import { initBrowserSentry } from '@/sentry';

initBrowserSentry();

import './index.css';

// Strip signup confirmation tokens from the address bar before the first render.
discardSignupLink();

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
