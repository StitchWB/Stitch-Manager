/**
 * All-pages smoke-render gate.
 *
 * Route list is extracted from src/App.tsx at test time (regex over the
 * source — no hand-maintained list), so every route added to the app is
 * covered automatically. Each route renders the REAL <App> tree (real
 * pages, real Layout/Sidebar) with only the shared transport mocked
 * (safeInvoke, events, sonner, auth fetch wrappers) and an admin session
 * seeded into useAuthStore. A route fails the gate when it crashes into
 * the AppErrorBoundary, throws during render, or logs an uncaught
 * TypeError — the production /mail crash class this gate exists to stop.
 *
 * QUARANTINED routes are pre-existing crashes excluded from the gate;
 * each entry must carry the exact error and a reason.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

jest.mock('../../lib/backend/core/invoke', () => ({
  setAuthExpiredHandler: jest.fn(),
  safeInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

jest.mock('@/lib/events', () => ({
  listen: jest.fn(async () => jest.fn()),
  emit: jest.fn(async () => undefined),
  dispose: jest.fn(),
}));

jest.mock('../../lib/backend/modules/auth', () => ({
  getAuthStatus: jest.fn(),
  getCurrentUser: jest.fn(),
  getMyPermissions: jest.fn(),
  getPermissionsMatrix: jest.fn(),
  setPermission: jest.fn(),
  listUsers: jest.fn(),
  createUser: jest.fn(),
  updateUserRole: jest.fn(),
  deleteUser: jest.fn(),
  loginUser: jest.fn(),
  loginTelegram: jest.fn(),
  loginTelegramDeeplink: jest.fn(),
  loginTelegramOidc: jest.fn(),
  logoutUser: jest.fn(),
  setupUser: jest.fn(),
  setLoginPolicy: jest.fn(),
  setPreviewRole: jest.fn(),
  startTelegramDeeplink: jest.fn(),
  getTelegramDeeplinkStatus: jest.fn(),
  PERMISSION_KEYS: [
    'section.autoreg',
    'section.ai_hub',
    'section.automation',
    'section.mail',
    'section.tools',
    'section.totp',
    'section.scenarios',
    'section.settings',
    'section.logs',
    'action.export_accounts',
    'action.bulk_delete',
    'action.claim',
  ],
}));

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
  },
  Toaster: () => null,
}));

import App from '../../App';
import { AppErrorBoundary } from '../../components/system/AppErrorBoundary';
import { safeInvoke } from '../../lib/backend/core/invoke';
import {
  getAuthStatus,
  getCurrentUser,
  getMyPermissions,
  getPermissionsMatrix,
  listUsers,
} from '../../lib/backend/modules/auth';
import { _resetForTests } from '../../lib/backend/modules/servicePlugins';
import { useAuthStore } from '../../stores/auth';
import { useUIPreferencesStore } from '../../stores/uiPreferences';

jest.setTimeout(30000);

class FakeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): unknown[] {
    return [];
  }
}

if (typeof window.ResizeObserver === 'undefined') {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeObserver;
}
if (typeof window.IntersectionObserver === 'undefined') {
  (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeObserver;
}
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    addListener: jest.fn(),
    removeListener: jest.fn(),
    dispatchEvent: jest.fn(() => false),
  })) as unknown as typeof window.matchMedia;
}
window.requestIdleCallback = (() => 0) as unknown as typeof window.requestIdleCallback;
window.cancelIdleCallback = (() => {}) as unknown as typeof window.cancelIdleCallback;
Element.prototype.scrollTo = () => {};
window.scrollTo = () => {};

const APP_SOURCE = readFileSync(join(__dirname, '..', '..', 'App.tsx'), 'utf8');

const ROUTE_PATHS = Array.from(
  new Set(
    Array.from(APP_SOURCE.matchAll(/<Route\s[^>]*?path="([^"]+)"/g)).map(m => m[1]),
  ),
).filter(p => p !== '*');

const PARAM_SAMPLES: Record<string, string> = {
  section: 'providers',
  id: 'test-plugin',
  tab: 'general',
  userId: '1',
};

function concretize(path: string): string {
  return path
    .split('/')
    .map(seg => (seg.startsWith(':') ? PARAM_SAMPLES[seg.slice(1)] ?? 'test' : seg))
    .join('/');
}

const ROUTES = ROUTE_PATHS.map(concretize);

const QUARANTINED: Record<string, string> = {};

const ADMIN_USER = {
  id: 1,
  username: 'admin',
  role: 'admin' as const,
  tg_tier: null,
  preview_role: null,
};

const COMMAND_PAYLOADS: Record<string, unknown> = {
  initialize_app: {
    settings: {},
    accounts: [],
    activeAccounts: {},
    dashboardStats: {},
    totpKeys: [],
    scheduledTasks: [],
    proxyStatus: {},
    schedulerStatus: false,
    registrationStatus: {},
    registrationJobs: [],
    backgroundManagerConfig: {},
  },
  get_logs: { logs: [], total: 0, hasMore: false },
  get_log_stats: { total: 0, byLevel: {}, bySource: {}, byChannel: {} },
  get_settings: {},
  get_dashboard_stats: {},
  get_providers: { providers: [] },
  get_registration_status: {
    isRunning: false,
    success: null,
    status: null,
    provider: null,
    email: null,
    step: null,
    progress: null,
    error: null,
    startedAt: null,
    completedAt: null,
  },
  get_scheduler_status: false,
  get_scheduled_tasks: [],
  get_scheduler_templates: [],
  get_task_executions: [],
  get_available_models: [],
  get_provider_model_mappings: [],
  get_provider_capabilities: [],
  get_accounts: [],
  list_accounts: [],
  get_registration_jobs: [],
  get_ai_proxy_accounts: [],
  get_model_usage: [],
  get_request_history: [],
  get_weekly_stats: [],
  get_cost_estimate: 0,
  get_daily_stats: {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    totalTokens: 0,
    avgDurationMs: 0,
  },
  fetch_all_quotas_cmd: [],
  fetch_openai_account_quotas_cmd: [],
  fetch_kiro_account_quotas_cmd: [],
  scan_auth_files: [],
  plugin_grants_role_list: { roles: {}, plugins: [] },
  plugin_grants_group_list: { groups: {}, groupNames: {}, plugins: [] },
  admin_user_overview: {
    user: { id: 1, username: 'admin', role: 'admin' },
    permissions: [],
    groups: [],
    plugins: { effective: [], overrides: [] },
    keys: { ai_gateway_credentials: 0, proxy_keys: 0, provider_accounts: 0, totp: 0 },
    usage: { requests_today: 0, tokens_today: 0 },
  },
  get_proxy_status: {},
  get_marketplace: { items: [], activated: false, feeds: null },
  get_friends: { items: [] },
  get_radar_stats: { services: 0, offers: 0, active: 0, dead: 0, by_type: {} },
  get_radar_offers: { items: [], total: 0 },
  groups_list: { groups: [], invites: [] },
  groups_pool_list: { items: [] },
  groups_usage_list: { rows: [], max_per_member_daily: null },
  list_overrides: { overrides: [] },
  my_submissions: { items: [] },
  list_submissions: { items: [] },
  get_pending_reports: { reports: [] },
  email_inbox_get_sync_state: null,
  email_inbox_get_provider_catalog: [],
  get_opencode_config: {},
  get_oh_my_openagent_config: {},
  get_kiro_patch_config: {},
  kiro_proxy_status: { running: false, port: null },
  icloud_pool_get_stats: {},
  get_patch_status: {},
  detect_ides: [],
  get_key_health: [],
  get_custom_providers: [],
  obs_timeline: [],
  get_python_job_status: null,
};

function payloadFor(cmd: string): unknown {
  if (cmd in COMMAND_PAYLOADS) return COMMAND_PAYLOADS[cmd];
  if (/(^|_)list(_|$)/.test(cmd)) return [];
  return {};
}

const FETCH_PAYLOADS: Array<[string, unknown]> = [
  ['/api/holone/status', { enabled: false, mode: 'monitor', rule_count: 0 }],
  ['/api/holone/findings', { findings: [] }],
];

function makeJsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone() {
      return this;
    },
    headers: new Headers(),
  } as unknown as Response;
}

function installFetchRouter(): void {
  (globalThis as { fetch: unknown }).fetch = jest.fn(async (url: string) => {
    const suffix = String(url);
    for (const [endpoint, body] of FETCH_PAYLOADS) {
      if (suffix.includes(endpoint)) return makeJsonResponse(body);
    }
    return makeJsonResponse({});
  });
}

const ERROR_MARKER = /Uncaught|TypeError|Cannot read propert/;

let consoleErrorSpy: jest.SpiedFunction<(...args: unknown[]) => void>;

const FALLBACK_SELECTOR = 'div.h-full.w-full.min-h-\\[200px\\]';

async function renderRouteAndAssert(route: string): Promise<void> {
  const { container } = render(
    <AppErrorBoundary>
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>
    </AppErrorBoundary>,
  );

  await waitFor(
    () => {
      expect(container.querySelector(FALLBACK_SELECTOR)).toBeNull();
    },
    { timeout: 15000 },
  );

  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 50));
  });

  if (screen.queryByText('Ui crashed')) {
    const detail = document.querySelector('p.font-mono')?.textContent ?? 'unknown error';
    throw new Error(`route ${route} crashed into the AppErrorBoundary: ${detail}`);
  }

  const errors = consoleErrorSpy.mock.calls
    .map(args => args.map(String).join(' '))
    .filter(msg => ERROR_MARKER.test(msg));
  if (errors.length > 0) {
    throw new Error(`route ${route} logged runtime errors:\n${errors.slice(0, 5).join('\n')}`);
  }
}

describe('all-pages smoke-render gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetForTests();
    installFetchRouter();

    (getAuthStatus as jest.Mock).mockResolvedValue({
      enabled: true,
      has_users: true,
      required: true,
      enforce_login: true,
      tg_auth_mode: 'legacy',
    });
    (getCurrentUser as jest.Mock).mockResolvedValue(ADMIN_USER);
    (getMyPermissions as jest.Mock).mockResolvedValue([]);
    (getPermissionsMatrix as jest.Mock).mockResolvedValue({ roles: [], keys: [], matrix: {} });
    (listUsers as jest.Mock).mockResolvedValue([]);

    (safeInvoke as jest.Mock).mockImplementation((cmd: string) =>
      Promise.resolve(payloadFor(cmd)),
    );

    useAuthStore.setState({
      enabled: true,
      hasUsers: true,
      required: true,
      enforceLogin: true,
      tgAuthMode: 'legacy',
      checked: true,
      user: ADMIN_USER,
      busy: false,
      error: null,
      sessionExpired: false,
      guest: false,
      authView: 'login',
      permissions: [],
      permissionsLoaded: true,
    });
    useUIPreferencesStore.setState({ activeRoute: null });

    consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {}) as jest.SpiedFunction<(...args: unknown[]) => void>;
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  for (const route of ROUTES) {
    const quarantineReason = QUARANTINED[route];
    const testFn = quarantineReason ? it.skip : it;
    testFn(`renders ${route} without crashing`, async () => {
      await renderRouteAndAssert(route);
    });
  }

  it('renders NotFound for an unknown URL without crashing', async () => {
    await renderRouteAndAssert('/definitely-not-a-real-route');
  });
});
