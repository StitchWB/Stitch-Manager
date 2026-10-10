/**
 * AI Hub route table tests.
 *
 * Renders the real <App /> (stores and pages stubbed) inside a MemoryRouter
 * and asserts the /ai/* route table: the three canonical hub pages render
 * AiProviders, legacy section paths redirect, and any other /ai/* path
 * falls through to NotFound instead of the old /ai/:section catch-all.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';

jest.mock('../lib/backend/modules/auth', () => ({
  getAuthStatus: jest.fn(async () => ({ enabled: false, has_users: false, required: false })),
  getCurrentUser: jest.fn(async () => null),
  getMyPermissions: jest.fn(async () => []),
  getPermissionsMatrix: jest.fn(async () => ({})),
  setPermission: jest.fn(),
  loginUser: jest.fn(),
  loginTelegram: jest.fn(),
  loginTelegramDeeplink: jest.fn(),
  loginTelegramOidc: jest.fn(),
  logoutUser: jest.fn(),
  setupUser: jest.fn(),
  startTelegramDeeplink: jest.fn(),
  getTelegramDeeplinkStatus: jest.fn(),
  listUsers: jest.fn(),
  createUser: jest.fn(),
  deleteUser: jest.fn(),
  setLoginPolicy: jest.fn(),
  setPreviewRole: jest.fn(),
  PERMISSION_KEYS: [],
}));

jest.mock('../lib/backend/core/invoke', () => ({
  setAuthExpiredHandler: jest.fn(),
  safeInvoke: jest.fn(async () => { throw new Error('mocked'); }),
  BackendError: class extends Error {},
  API_BASE_URL: '',
}));

jest.mock('../lib/backend', () => ({
  safeInvoke: jest.fn(async () => { throw new Error('mocked'); }),
}));

const mockAppStoreState = {
  theme: 'dark' as const,
  language: 'en' as const,
  sidebarCollapsed: false,
  toggleSidebar: jest.fn(),
};
jest.mock('../stores/app', () => ({
  useAppStore: Object.assign(
    (selector?: (s: typeof mockAppStoreState) => unknown) =>
      selector ? selector(mockAppStoreState) : mockAppStoreState,
    { getState: () => mockAppStoreState }
  ),
}));

const mockLogsStoreState = {
  subscribeToLogs: jest.fn(),
  unsubscribeFromLogs: jest.fn(),
  fetchLogs: jest.fn(),
};
jest.mock('../stores/logs', () => ({
  useLogsStore: (selector?: (s: typeof mockLogsStoreState) => unknown) =>
    selector ? selector(mockLogsStoreState) : mockLogsStoreState,
}));

const mockRegStoreState = {
  config: { uiScale: 1 },
  loadSettings: jest.fn(),
};
jest.mock('../stores/registration', () => ({
  useRegistrationStore: (selector?: (s: typeof mockRegStoreState) => unknown) =>
    selector ? selector(mockRegStoreState) : mockRegStoreState,
}));

jest.mock('../stores/registration/runtime.store', () => ({
  useRuntimeStore: () => ({}),
}));

jest.mock('../stores/settings', () => ({
  useSettingsStore: () => ({ getState: () => ({}) }),
}));

jest.mock('../stores/uiPreferences', () => ({
  useUIPreferencesStore: () => ({
    activeRoute: null,
    setActiveRoute: jest.fn(),
  }),
}));

const mockTotpStoreState = {
  fetchKeys: jest.fn(async () => []),
};
jest.mock('../stores/totp', () => ({
  useTotpStore: (selector?: (s: typeof mockTotpStoreState) => unknown) =>
    selector ? selector(mockTotpStoreState) : mockTotpStoreState,
}));

jest.mock('../stores/accounts', () => ({
  useAccountsStore: { getState: () => ({}), setState: jest.fn() },
}));

jest.mock('../stores/scheduler', () => ({
  useSchedulerStore: { setState: jest.fn() },
}));

jest.mock('../stores/aiProxy', () => ({
  useAiProxyStore: { getState: () => ({ setStatus: jest.fn() }) },
}));

jest.mock('../components/ui/CommandPalette', () => ({
  CommandPalette: () => null,
}));

jest.mock('../components/ui/ConfirmDialogHost', () => ({
  ConfirmDialogHost: () => null,
}));

jest.mock('sonner', () => ({
  Toaster: () => null,
  toast: Object.assign(jest.fn(), {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
  }),
}));

jest.mock('../components/layout/Layout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}));

jest.mock('../components/ai-proxy/AiHubLayout', () => {
  const { Outlet } = jest.requireActual('react-router-dom');
  return { __esModule: true, AiHubLayout: () => <Outlet /> };
});

jest.mock('../pages/AiOverview', () => ({
  __esModule: true,
  default: () => <div data-testid="ai-overview-page" />,
}));

jest.mock('../pages/AiProviders', () => ({
  __esModule: true,
  default: () => <div data-testid="ai-providers-page" />,
}));

jest.mock('../pages/NotFound', () => ({
  __esModule: true,
  default: () => <div data-testid="not-found-page" />,
}));

import App from '../App';

function renderAppAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );
}

describe('App /ai route table', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({
      enabled: false,
      hasUsers: false,
      required: false,
      enforceLogin: true,
      tgAuthMode: 'legacy',
      checked: true,
      user: null,
      busy: false,
      error: null,
      sessionExpired: false,
      guest: false,
      authView: 'welcome',
      permissions: [],
      permissionsLoaded: false,
    });
  });

  it.each(['/ai/providers', '/ai/routing', '/ai/monitor'])(
    'renders AiProviders at %s',
    async (path) => {
      renderAppAt(path);
      await waitFor(() => {
        expect(screen.getByTestId('ai-providers-page')).toBeTruthy();
      });
    }
  );

  it('redirects the legacy usage section to monitor', async () => {
    renderAppAt('/ai/usage');
    await waitFor(() => {
      expect(screen.getByTestId('ai-providers-page')).toBeTruthy();
    });
  });

  it('renders NotFound for an unknown ai section', async () => {
    renderAppAt('/ai/garbage');
    await waitFor(() => {
      expect(screen.getByTestId('not-found-page')).toBeTruthy();
    });
    expect(screen.queryByTestId('ai-providers-page')).toBeNull();
  });
});
