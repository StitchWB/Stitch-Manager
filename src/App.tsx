import { Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef, lazy, Suspense } from 'react';
import { Toaster } from 'sonner';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, Loader2, Terminal } from 'lucide-react';
import Layout from './components/layout/Layout';

import { t } from '@/lib/i18n';
import { useAppStore } from './stores/app';
import { useAuthStore } from './stores/auth';
import { useLogsStore } from './stores/logs';
import { useRegistrationStore } from './stores/registration';
import { useRuntimeStore } from './stores/registration/runtime.store';
import { useSettingsStore } from './stores/settings';
import { useUIPreferencesStore } from './stores/uiPreferences';
import { useTotpStore } from './stores/totp';
import { useAccountsStore } from './stores/accounts';
import { useSchedulerStore } from './stores/scheduler';
import { useAiProxyStore } from './stores/aiProxy';
import { CommandPalette } from '@/components/ui/CommandPalette';
import { ConfirmDialogHost } from '@/components/ui/ConfirmDialogHost';
import { AdminRoute } from './components/auth/AdminRoute';
import { safeInvoke } from './lib/backend';
import type { Account, ProxyStatus, ScheduledTask, SettingsData } from './types/generated';
import type { TotpKey } from './lib/backend/modules/totp';
import type { RegistrationJob, RegistrationStatus } from './types/ui';
import type { BackgroundManagerConfig } from './lib/backend/modules/backgroundManager';

/** Shape returned by backend get_registration_status — richer than the frontend RegistrationStatus union. */
interface RegistrationStatusResponse {
  isRunning: boolean;
  success: boolean | null;
  status: string | null;
  provider: string | null;
  email: string | null;
  step: string | null;
  progress: number | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Login from './pages/Login';
import Setup from './pages/Setup';
import WelcomeGate from './components/auth/WelcomeGate';
import TelegramLogin from './components/auth/TelegramLogin';
const AutoReg = lazy(() => import('./pages/AutoReg'));
const AiProviders = lazy(() => import('./pages/AiProviders'));
const AiOverview = lazy(() => import('./pages/AiOverview'));
const AiAnalytics = lazy(() => import('./pages/AiAnalytics'));
const Antigravity = lazy(() => import('./pages/Antigravity'));
const HoloneSecurity = lazy(() => import('./pages/HoloneSecurity'));
const ToolsPage = lazy(() => import('./pages/ToolsPage'));
const Patcher = lazy(() => import('./pages/Patcher'));
const Scheduler = lazy(() => import('./pages/Scheduler'));
const Mail = lazy(() => import('./pages/Mail'));
const Settings = lazy(() => import('./pages/Settings'));
const Logs = lazy(() => import('./pages/Logs'));
const Chat = lazy(() => import('./pages/Chat'));
const AiIntegrations = lazy(() => import('./pages/AiIntegrations'));
const OpenCodeConfig = lazy(() => import('./pages/OpenCodeConfig'));
const Scenarios = lazy(() => import('./pages/Scenarios'));
const Tools = lazy(() => import('./pages/Tools'));
const Automation = lazy(() => import('./pages/Automation'));
const Totp = lazy(() => import('./pages/Totp'));
const AiGateway = lazy(() => import('./pages/AiGateway'));
const Radar = lazy(() => import('./pages/Radar'));
const Friends = lazy(() => import('./pages/Friends'));
const Marketplace = lazy(() => import('./pages/Marketplace'));
const NotebookLM = lazy(() => import('./pages/NotebookLM'));
const Users = lazy(() => import('./pages/Users'));
const Codes = lazy(() => import('./pages/Codes'));
const Monitoring = lazy(() => import('./pages/Monitoring'));
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
      {t('common.loading') || 'Loading...'}
    </div>
  );
}

/**
 * Themed loading splash shown while the auth gate is resolving (fetching
 * /api/auth/status and /api/auth/me). Same Deep Space aesthetic as the
 * login/setup pages so the transition is seamless.
 */
function AuthLoadingSplash() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center relative overflow-hidden bg-[#0a0a0d]">
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(99,102,241,0.18), transparent 60%), radial-gradient(ellipse 60% 50% at 20% 100%, rgba(139,92,246,0.12), transparent 60%), radial-gradient(ellipse 60% 50% at 80% 100%, rgba(59,130,246,0.10), transparent 60%)',
        }}
      />
      <div className="relative flex flex-col items-center gap-4">
        <div className="rounded-xl w-12 h-12 flex items-center justify-center bg-gradient-to-br from-indigo-500 to-indigo-700 shadow-xl shadow-indigo-900/40">
          <Terminal className="w-6 h-6 text-white" />
        </div>
        <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
      </div>
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

    // Restore the last workspace only when the app opens at the root.
    // Explicit deep links must always win over persisted navigation state.
    if (activeRoute && activeRoute !== '/' && location.pathname === '/') {
      // Ensure the route exists in our route list
      const validRoutes = [
        '/',
        '/accounts',
        '/autoreg',
        '/ai',
        '/ai/antigravity',
        '/ai/api-keys',
        '/ai/tools',
        '/ai/chat',
        '/ai/:section',
        '/ai-analytics',
        '/patcher',
        '/scheduler',
        '/automation',
        '/mail',
        '/settings',
        '/logs',
        '/chat',
        '/scenarios',
        '/tools',
        '/marketplace',
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
  const fetchTotpKeys = useTotpStore(state => state.fetchKeys);

  // Auth gate state
  const authEnabled = useAuthStore(state => state.enabled);
  const authRequired = useAuthStore(state => state.required);
  const authHasUsers = useAuthStore(state => state.hasUsers);
  const authChecked = useAuthStore(state => state.checked);
  const authUser = useAuthStore(state => state.user);
  const authGuest = useAuthStore(state => state.guest);
  const authView = useAuthStore(state => state.authView);
  const authInit = useAuthStore(state => state.init);

  const hasInitialized = useRef(false);

  useEffect(() => {
    const baseSize = 16; // Standard base size
    const scaledSize = baseSize * uiScale;
    document.documentElement.style.setProperty('--app-font-size', `${scaledSize}px`);
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

  // Initialize auth state first. The app gate below waits for `authChecked`
  // before rendering either the loading splash, the setup page, the login
  // page, or the normal app. When auth is disabled, init() resolves with
  // {enabled:false, checked:true} and the app renders exactly as before.
  useEffect(() => {
    void authInit();
  }, [authInit]);

  // Initialize settings and logging system — only after the auth gate has
  // resolved (so we don't fire /api/* calls that would 401 while the user
  // is still on the login/setup surface).
  useEffect(() => {
    if (!authChecked) return;
    // When auth is required, only initialize the app once the user is logged
    // in — otherwise the /api/initialize_app call would 401 and trigger the
    // session-expired handler. When auth is optional (guest mode or auth
    // disabled), the backend serves /api/* without a session.
    if (authEnabled && authRequired && !authUser) return;
    if (authEnabled && !authUser && !authGuest) return;
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    // Use single initialization endpoint instead of multiple concurrent calls
    const initializeApp = async () => {
      try {
        const data = await safeInvoke<{
          settings: Record<string, unknown>;
          accounts: Account[];
          activeAccounts: Record<string, string>;
          dashboardStats: Record<string, unknown>;
          totpKeys: TotpKey[];
          scheduledTasks: ScheduledTask[];
          proxyStatus: ProxyStatus;
          schedulerStatus: boolean;
          registrationStatus: RegistrationStatusResponse;
          registrationJobs: RegistrationJob[];
          backgroundManagerConfig: BackgroundManagerConfig;
        }>('initialize_app');
        
        // Populate accounts store
        if (data.accounts) {
          useAccountsStore.setState({ accounts: data.accounts });
        }
        
        // Populate active accounts (backend returns string IDs, store expects number | null)
        if (data.activeAccounts) {
          const converted: Record<string, number | null> = {};
          for (const [k, v] of Object.entries(data.activeAccounts)) {
            const num = Number(v);
            converted[k] = Number.isFinite(num) ? num : null;
          }
          useAccountsStore.setState({ activeAccountIds: converted });
        }
        
        // Populate scheduler store
        if (data.scheduledTasks) {
          useSchedulerStore.setState({ tasks: data.scheduledTasks });
        }
        if (data.schedulerStatus !== undefined) {
          useSchedulerStore.setState({ isRunning: data.schedulerStatus });
        }
        
        // Populate proxy store
        if (data.proxyStatus) {
          useAiProxyStore.getState().setStatus(data.proxyStatus);
        }
        
        // Populate TOTP store
        if (data.totpKeys && data.totpKeys.length > 0) {
          useTotpStore.setState({ keys: data.totpKeys });
        }
        
        // Populate registration store (use runtime store directly, not facade)
        if (data.registrationStatus) {
          const rs = data.registrationStatus;
          const status: RegistrationStatus =
            rs.status === 'running' || rs.status === 'completed' || rs.status === 'failed' || rs.status === 'cancelled'
              ? rs.status
              : 'pending';
          useRuntimeStore.setState({
            isRunning: rs.isRunning,
            status,
            activeProvider: rs.provider ?? 'all',
          });
        }

        // Populate settings store
        if (data.settings) {
          useSettingsStore.getState().setSettings(data.settings as SettingsData);
        }
        if (data.backgroundManagerConfig) {
          useSettingsStore.getState().setBackgroundManagerConfig(data.backgroundManagerConfig);
        }
        
        // Subscribe to real-time log events from backend
        subscribeToLogs();
        
        // Fetch initial logs from database (not included in init response)
        fetchLogs();
        
        // Load settings (this still needs to be called to populate the full config)
        loadSettings();
      } catch (error) {
        console.error('Failed to initialize app:', error);
        // Fallback to individual API calls if initialization fails
        loadSettings();
        subscribeToLogs();
        fetchLogs();
        void fetchTotpKeys().catch(() => { });
      }
    };

    void initializeApp();

    return () => {
      unsubscribeFromLogs();
    };
  }, [loadSettings, subscribeToLogs, unsubscribeFromLogs, fetchLogs, fetchTotpKeys, authChecked, authEnabled, authRequired, authUser, authGuest]);

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

  // Auth gate. Order matters:
  //   1. !checked                              → themed loading splash
  //   2. required && !hasUsers && !user         → <Setup/>   (mandatory)
  //   3. required && hasUsers && !user          → <Login/>   (mandatory, TG reachable via link)
  //   4. required && authView='telegram'        → <TelegramLogin/>  (from Login link)
  //   5. !required && !user && !guest          → <WelcomeGate/>  (opt-in)
  //   6. !required && !user && guest            → the normal app (guest mode)
  //   7. !required && !user && authView='setup' → <Setup/>   (with back link)
  //   8. !required && !user && authView='login' → <Login/>   (with back link)
  //   9. !required && !user && authView='telegram' → <TelegramLogin/>  (with back link)
  //  10. otherwise (user present)               → the normal app
  if (!authChecked) {
    return <AuthLoadingSplash />;
  }
  if (authEnabled && authUser) {
    // Logged in — render the app.
  } else if (authEnabled && authRequired) {
    // Mandatory auth: no escape. Setup when no users, else Login.
    // TG login is reachable from Login via a tertiary link.
    if (authView === 'telegram') {
      return <TelegramLogin />;
    }
    if (!authHasUsers) {
      return <Setup />;
    }
    return <Login />;
  } else if (authEnabled && !authGuest) {
    // Optional auth, not yet a guest: show welcome gate or the optional
    // setup/login/telegram surface the user navigated to from the gate.
    if (authView === 'setup') {
      return <Setup />;
    }
    if (authView === 'login') {
      return <Login />;
    }
    if (authView === 'telegram') {
      return <TelegramLogin />;
    }
    return <WelcomeGate />;
  }
  // Otherwise: auth disabled, or guest mode, or user present → render the app.

  return (
    <>
      {/* Skip to main content link for keyboard navigation */}
      <Link to="#main-content" className="skip-to-content">
        {t('common.skipToMainContent')}
      </Link>

      <Layout>
        <RouteTracker />
        <Suspense fallback={<RouteLoadingFallback />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/radar" element={<Radar />} />
            <Route path="/friends" element={<Friends />} />
            <Route path="/marketplace" element={<Marketplace />} />
            <Route path="/chat" element={<Chat />} />
            {/* Product surface — open to any authenticated user */}
            <Route path="/autoreg" element={<AutoReg />} />
            <Route path="/ai" element={<AiOverview />} />
            <Route path="/ai/overview" element={<Navigate to="/ai" replace />} />
            <Route path="/ai/integrations" element={<AiIntegrations />} />
            <Route path="/ai/usage" element={<Navigate to="/ai/monitor" replace />} />
            <Route path="/ai/diagnostics" element={<Navigate to="/ai/monitor" replace />} />
            <Route path="/ai/freemodel" element={<Navigate to="/ai/providers" replace />} />
            <Route path="/ai/antigravity" element={<Antigravity />} />
            <Route path="/ai/holone" element={<HoloneSecurity />} />
            <Route path="/ai/tools" element={<ToolsPage />} />
            <Route path="/ai/api-keys" element={<Navigate to="/ai/providers" replace />} />
            <Route path="/ai/opencode-config" element={<OpenCodeConfig />} />
            <Route path="/ai/chat" element={<Chat />} />
            <Route path="/ai/analytics" element={<AiAnalytics />} />
            <Route path="/ai/gateway" element={<AiGateway />} />
            <Route path="/ai/:section" element={<AiProviders />} />
            <Route path="/ai-providers" element={<Navigate to="/ai/providers" replace />} />
            <Route path="/ai-analytics" element={<Navigate to="/ai/analytics" replace />} />
            <Route path="/antigravity" element={<Navigate to="/ai/antigravity" replace />} />
            <Route path="/patcher" element={<Patcher />} />
            <Route path="/scheduler" element={<Scheduler />} />
            <Route path="/automation" element={<Automation />} />
            <Route path="/automation/:tab" element={<Automation />} />
            <Route path="/mail" element={<Mail />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/logs" element={<Logs />} />
            <Route path="/scenarios" element={<Scenarios />} />
            <Route path="/tools" element={<Tools />} />
            <Route path="/totp" element={<Totp />} />
            <Route path="/ai/notebooklm" element={<NotebookLM />} />
            <Route path="/notebooklm" element={<Navigate to="/ai/notebooklm" replace />} />
            {/* Admin zone — guarded by AdminRoute */}
            <Route path="/users" element={<AdminRoute><Users /></AdminRoute>} />
            <Route path="/codes" element={<AdminRoute><Codes /></AdminRoute>} />
            <Route path="/monitoring" element={<AdminRoute><Monitoring /></AdminRoute>} />
            <Route path="/api-keys" element={<Navigate to="/ai/providers" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </Layout>
      <Toaster
        position="bottom-right"
        expand={false}
        closeButton
        gap={10}
        visibleToasts={3}
        icons={{
          success: <CheckCircle2 size={15} />,
          error: <AlertCircle size={15} />,
          warning: <AlertTriangle size={15} />,
          info: <Info size={15} />,
        }}
        toastOptions={{
          style: { color: '#e2e8f0' },
          className: 'sonner-toast',
        }}
        theme="dark"
      />
      <ConfirmDialogHost />
      <CommandPalette />
    </>
  );
}

export default App;
