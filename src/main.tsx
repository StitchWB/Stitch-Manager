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

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </BrowserRouter>
    </AppErrorBoundary>
  </React.StrictMode>
);
