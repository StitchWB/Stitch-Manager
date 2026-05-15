import { Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef, lazy, Suspense } from 'react';
import { Toaster } from 'sonner';
import Layout from './components/layout/Layout';

import { useAppStore } from './stores/app';
import { useLogsStore } from './stores/logs';
import { useRegistrationStore } from './stores/registration';
import { useUIPreferencesStore } from './stores/uiPreferences';
import { CommandPalette } from '@/components/ui';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Accounts = lazy(() => import('./pages/Accounts'));
const AutoReg = lazy(() => import('./pages/AutoReg'));
const AiProviders = lazy(() => import('./pages/AiProviders'));
const AiOverview = lazy(() => import('./pages/AiOverview'));
const Antigravity = lazy(() => import('./pages/Antigravity'));
const Patcher = lazy(() => import('./pages/Patcher'));
const Scheduler = lazy(() => import('./pages/Scheduler'));
const Mail = lazy(() => import('./pages/Mail'));
const Settings = lazy(() => import('./pages/Settings'));
const Logs = lazy(() => import('./pages/Logs'));
const Chat = lazy(() => import('./pages/Chat'));
const ApiKeys = lazy(() => import('./pages/ApiKeys'));
const Scenarios = lazy(() => import('./pages/Scenarios'));
const Tools = lazy(() => import('./pages/Tools'));
const NotFound = lazy(() => import('./pages/NotFound'));

// Route prefetchers (idle/low-priority)
const prefetchAccounts = () => import('./pages/Accounts');
const prefetchScenarios = () => import('./pages/Scenarios');
const prefetchScheduler = () => import('./pages/Scheduler');
const prefetchMail = () => import('./pages/Mail');
const prefetchLogs = () => import('./pages/Logs');
const prefetchSettings = () => import('./pages/Settings');

type NavigatorConnectionLike = {
  saveData?: boolean;
  effectiveType?: string;
};

type NavigatorWithConnection = Navigator & {
  connection?: NavigatorConnectionLike;
};

type WindowWithIdleCallback = Window & {
  requestIdleCallback?: (
    callback: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void,
    opts?: { timeout?: number }
  ) => number;
  cancelIdleCallback?: (id: number) => void;
};

function RouteLoadingFallback() {
  return (
    <div className="h-full w-full min-h-[200px] flex items-center justify-center text-sm text-vsc-text-muted">
      Loading page...
    </div>
  );
}

/**
 * Tracks route changes and persists/restores the active route.
 */
function RouteTracker() {
  const location = useLocation();
  const navigate = useNavigate();
  const hasRestored = useRef(false);
  const { activeRoute, setActiveRoute } = useUIPreferencesStore();

  // Restore route on first mount (once only)
  useEffect(() => {
    if (hasRestored.current) return;
    hasRestored.current = true;

    if (activeRoute && activeRoute !== '/' && activeRoute !== location.pathname) {
      // Ensure the route exists in our route list
      const validRoutes = [
        '/',
        '/accounts',
        '/autoreg',
        '/ai',
        '/ai/antigravity',
        '/ai/api-keys',
        '/ai/:section',
        '/patcher',
        '/scheduler',
        '/mail',
        '/settings',
        '/logs',
        '/chat',
        '/scenarios',
        '/tools',
      ];
      // Simple check - if it starts with a known route base
      const isValid = validRoutes.some(
        r => activeRoute === r || activeRoute.startsWith(r.replace(':section', ''))
      );
      if (isValid) {
        navigate(activeRoute, { replace: true });
      }
    }
  }, [activeRoute, navigate, location.pathname]);

  // Persist route on every change
  useEffect(() => {
    if (location.pathname !== activeRoute) {
      setActiveRoute(location.pathname);
    }
  }, [location.pathname, activeRoute, setActiveRoute]);

  return null;
}

function App() {
  const theme = useAppStore(state => state.theme);
  const uiScale = useRegistrationStore(state => state.config.uiScale);
  const loadSettings = useRegistrationStore(state => state.loadSettings);

  const subscribeToLogs = useLogsStore(state => state.subscribeToLogs);
  const unsubscribeFromLogs = useLogsStore(state => state.unsubscribeFromLogs);
  const fetchLogs = useLogsStore(state => state.fetchLogs);

  const hasInitialized = useRef(false);

  useEffect(() => {
    const baseSize = 16; // Standard base size
    const scaledSize = baseSize * uiScale;
    document.documentElement.style.setProperty('--app-font-size', `${scaledSize}px`);
    console.log(`[APP] UI Scale applied: ${uiScale} (font-size: ${scaledSize}px)`);
  }, [uiScale]);

  // Apply theme on mount and when it changes

  useEffect(() => {
    const applyTheme = () => {
      if (
        theme === 'dark' ||
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      ) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };

    applyTheme();

    // Listen for system theme changes when using 'system' theme
    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => applyTheme();

      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [theme]);

  // Initialize settings and logging system
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    // Load settings from database (includes UI scale)
    loadSettings();

    // Subscribe to real-time log events from backend
    subscribeToLogs();

    // Fetch initial logs from database
    fetchLogs();

    return () => {
      unsubscribeFromLogs();
    };
  }, [loadSettings, subscribeToLogs, unsubscribeFromLogs, fetchLogs]);

  // Idle route prefetch to speed up first navigation.
  useEffect(() => {
    const nav = navigator as NavigatorWithConnection;
    const connection = nav.connection;

    const saveData = Boolean(connection?.saveData);
    const effectiveType = (connection?.effectiveType ?? '').toLowerCase();
    const constrainedNetwork = saveData || effectiveType.includes('2g');

    if (constrainedNetwork) {
      return;
    }

    const tasks = [
      prefetchAccounts,
      prefetchScenarios,
      prefetchScheduler,
      prefetchMail,
      prefetchLogs,
      prefetchSettings,
    ];

    const runPrefetch = () => {
      let delay = 0;
      for (const task of tasks) {
        window.setTimeout(() => {
          void task().catch(() => {
            // best-effort prefetch only
          });
        }, delay);
        delay += 400;
      }
    };

    const w = window as WindowWithIdleCallback;
    if (typeof w.requestIdleCallback === 'function') {
      const idleId = w.requestIdleCallback(
        () => {
          runPrefetch();
        },
        { timeout: 2500 }
      );

      return () => {
        if (typeof w.cancelIdleCallback === 'function') {
          w.cancelIdleCallback(idleId);
        }
      };
    }

    const fallbackTimer = window.setTimeout(runPrefetch, 1200);
    return () => window.clearTimeout(fallbackTimer);
  }, []);

  return (
    <>
      {/* Skip to main content link for keyboard navigation */}
      <Link to="#main-content" className="skip-to-content">
        Skip to main content
      </Link>

      <Layout>
        <RouteTracker />
        <Suspense fallback={<RouteLoadingFallback />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/autoreg" element={<AutoReg />} />
            <Route path="/ai" element={<AiOverview />} />
            <Route path="/ai/antigravity" element={<Antigravity />} />
            <Route path="/ai/api-keys" element={<ApiKeys />} />
            <Route path="/ai/:section" element={<AiProviders />} />
            <Route path="/ai-providers" element={<Navigate to="/ai/providers" replace />} />
            <Route path="/antigravity" element={<Navigate to="/ai/antigravity" replace />} />
            <Route path="/patcher" element={<Patcher />} />
            <Route path="/scheduler" element={<Scheduler />} />
            <Route path="/mail" element={<Mail />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/logs" element={<Logs />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/scenarios" element={<Scenarios />} />
            <Route path="/tools" element={<Tools />} />
            <Route path="/api-keys" element={<Navigate to="/ai/api-keys" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </Layout>
      <Toaster
        position="bottom-right"
        expand={false}
        richColors
        closeButton
        gap={8}
        visibleToasts={4}
        toastOptions={{
          style: {
            background: 'rgba(15, 23, 42, 0.95)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: '#e2e8f0',
            borderRadius: '8px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          },
          className: 'sonner-toast',
          duration: 4000,
        }}
        theme="dark"
      />
      <CommandPalette />
    </>
  );
}

export default App;
