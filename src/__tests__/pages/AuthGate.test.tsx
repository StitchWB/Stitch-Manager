/**
 * Auth gate tests.
 *
 * Tests the auth store's init() flow and the App gate logic:
 *   - disabled → app renders (no login/setup)
 *   - enabled + !hasUsers → setup renders
 *   - enabled + hasUsers + !user → login renders
 *   - enabled + hasUsers + user → app renders
 *
 * Mocks the auth backend module (fetch-based) rather than the store, so the
 * store's real init() logic is exercised.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';

// Mock the auth backend module — these are the fetch wrappers the store calls.
jest.mock('../../lib/backend/modules/auth', () => ({
  getAuthStatus: jest.fn(),
  getCurrentUser: jest.fn(),
  loginUser: jest.fn(),
  logoutUser: jest.fn(),
  setupUser: jest.fn(),
  listUsers: jest.fn(),
  createUser: jest.fn(),
  deleteUser: jest.fn(),
}));

// Mock the invoke module's setAuthExpiredHandler so the store can register
// its 401 callback without trying to import the real fetch wrapper.
jest.mock('../../lib/backend/core/invoke', () => ({
  setAuthExpiredHandler: jest.fn(),
  safeInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

// Mock the heavy App dependencies so we can render <App /> in isolation.
// App imports many stores and lazy pages; we stub them to keep the test fast
// and focused on the gate logic.
// Zustand stores are called with a selector: `useStore(state => state.x)`.
// The mock accepts a selector and returns the selected value, or the whole
// state object if no selector is passed.
const mockAppStoreState = {
  theme: 'dark' as const,
  language: 'en' as const,
  sidebarCollapsed: false,
  toggleSidebar: jest.fn(),
  addNotification: jest.fn(),
};
jest.mock('../../stores/app', () => ({
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
jest.mock('../../stores/logs', () => ({
  useLogsStore: (selector?: (s: typeof mockLogsStoreState) => unknown) =>
    selector ? selector(mockLogsStoreState) : mockLogsStoreState,
}));

const mockRegStoreState = {
  config: { uiScale: 1 },
  loadSettings: jest.fn(),
};
jest.mock('../../stores/registration', () => ({
  useRegistrationStore: (selector?: (s: typeof mockRegStoreState) => unknown) =>
    selector ? selector(mockRegStoreState) : mockRegStoreState,
}));

jest.mock('../../stores/registration/runtime.store', () => ({
  useRuntimeStore: () => ({}),
}));

jest.mock('../../stores/settings', () => ({
  useSettingsStore: () => ({ getState: () => ({}) }),
}));

jest.mock('../../stores/uiPreferences', () => ({
  useUIPreferencesStore: () => ({
    activeRoute: null,
    setActiveRoute: jest.fn(),
  }),
}));

const mockTotpStoreState = {
  fetchKeys: jest.fn(async () => []),
};
jest.mock('../../stores/totp', () => ({
  useTotpStore: (selector?: (s: typeof mockTotpStoreState) => unknown) =>
    selector ? selector(mockTotpStoreState) : mockTotpStoreState,
}));

jest.mock('../../stores/accounts', () => ({
  useAccountsStore: { getState: () => ({}), setState: jest.fn() },
}));

jest.mock('../../stores/scheduler', () => ({
  useSchedulerStore: { setState: jest.fn() },
}));

jest.mock('../../stores/aiProxy', () => ({
  useAiProxyStore: { getState: () => ({ setStatus: jest.fn() }) },
}));

jest.mock('../../lib/backend', () => ({
  safeInvoke: jest.fn(async () => { throw new Error('mocked'); }),
}));

jest.mock('../../components/ui/CommandPalette', () => ({
  CommandPalette: () => null,
}));

jest.mock('../../components/ui/ConfirmDialogHost', () => ({
  ConfirmDialogHost: () => null,
}));

jest.mock('sonner', () => ({
  Toaster: () => null,
}));

// Mock the Layout so we don't render the full sidebar (which would pull in
// many more dependencies). The gate test only cares about which top-level
// surface App renders.
jest.mock('../../components/layout/Layout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="layout">{children}</div>
  ),
}));

// Mock the pages so we can detect which one App rendered without rendering
// the full page tree.
jest.mock('../../pages/Login', () => ({
  __esModule: true,
  default: () => <div data-testid="login-page">Login</div>,
}));

jest.mock('../../pages/Setup', () => ({
  __esModule: true,
  default: () => <div data-testid="setup-page">Setup</div>,
}));

jest.mock('../../pages/Dashboard', () => ({
  __esModule: true,
  default: () => <div data-testid="dashboard-page">Dashboard</div>,
}));

// Lazy-load mock for all other pages — they all resolve to a stub.
jest.mock('../../pages/Accounts', () => ({
  __esModule: true,
  default: () => <div data-testid="accounts-page">Accounts</div>,
}));

// Import App AFTER all mocks are set up.
import App from '../../App';

const authModule = jest.requireMock('../../lib/backend/modules/auth') as {
  getAuthStatus: jest.Mock;
  getCurrentUser: jest.Mock;
  loginUser: jest.Mock;
  logoutUser: jest.Mock;
  setupUser: jest.Mock;
};

describe('Auth gate', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the auth store between tests so init() runs fresh.
    useAuthStore.setState({
      enabled: false,
      hasUsers: false,
      checked: false,
      user: null,
      busy: false,
      error: null,
      sessionExpired: false,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('renders Setup when auth enabled and no users exist', async () => {
    authModule.getAuthStatus.mockResolvedValue({ enabled: true, has_users: false });
    authModule.getCurrentUser.mockResolvedValue(null);

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('setup-page')).toBeTruthy();
    });
  });

  it('renders Login when auth enabled, users exist, but no session', async () => {
    authModule.getAuthStatus.mockResolvedValue({ enabled: true, has_users: true });
    authModule.getCurrentUser.mockResolvedValue(null);

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeTruthy();
    });
  });

  it('renders the app (Dashboard) when auth is disabled', async () => {
    authModule.getAuthStatus.mockResolvedValue({ enabled: false, has_users: false });

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('layout')).toBeTruthy();
    });
  });

  it('renders the app (Dashboard) when auth enabled and user is logged in', async () => {
    authModule.getAuthStatus.mockResolvedValue({ enabled: true, has_users: true });
    authModule.getCurrentUser.mockResolvedValue({
      id: 1,
      username: 'admin',
      role: 'admin',
    });

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('layout')).toBeTruthy();
    });
  });
});
