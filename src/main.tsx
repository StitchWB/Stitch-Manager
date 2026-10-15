// Must run before any module that fires toasts: installs the anti-spam patch.
import './lib/observability/toast-dedup';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import { installObservabilityHooks } from './lib/observability/install';
import { AppErrorBoundary } from './components/system/AppErrorBoundary';

installObservabilityHooks();

// A redeploy replaces hashed chunks; a stale tab reloads once to pick up new names.
const preloadReloadKey = 'stitch:preload-error-at';
window.addEventListener('vite:preloadError', event => {
  const last = Number(sessionStorage.getItem(preloadReloadKey) ?? 0);
  if (Date.now() - last < 10_000) return;
  sessionStorage.setItem(preloadReloadKey, String(Date.now()));
  event.preventDefault();
  window.location.reload();
});

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </BrowserRouter>
    </AppErrorBoundary>
  </React.StrictMode>
);
