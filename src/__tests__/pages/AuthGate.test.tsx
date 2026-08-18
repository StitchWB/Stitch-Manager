/**
 * Auth gate tests.
 *
 * Tests the auth store's init() flow and the App gate logic:
 *   - disabled → app renders (no login/setup)
 *   - required + !hasUsers → setup renders (mandatory)
 *   - required + hasUsers + !user → login renders (mandatory)
 *   - required + hasUsers + user → app renders
 *   - !required + !hasUsers + !user → welcome gate renders (guest path)
 *   - !required + !user, click "continue without login" → app renders (guest)
 *   - !required + hasUsers + !user → welcome gate renders with Login secondary
 *
 * Mocks the auth backend module (fetch-based) rather than the store, so the
 * store's real init() logic is exercised.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';

// Mock the auth backend module — these are the fetch wrappers the store calls.
jest.mock('../../lib/backend/modules/auth', () => ({
  getAuthStatus: jest.fn(),
  getCurrentUser: jest.fn(),
  loginUser: jest.fn(),
  loginTelegram: jest.fn(),
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
  loginTelegram: jest.Mock;
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
      required: false,
      checked: false,
      user: null,
      busy: false,
      error: null,
      sessionExpired: false,
      guest: false,
      authView: 'welcome',
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('renders Setup when auth required and no users exist', async () => {
    authModule.getAuthStatus.mockResolvedValue({ enabled: true, has_users: false, required: true });
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

  it('renders Login when auth required, users exist, but no session', async () => {
    authModule.getAuthStatus.mockResolvedValue({ enabled: true, has_users: true, required: true });
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
    authModule.getAuthStatus.mockResolvedValue({ enabled: false, has_users: false, required: false });

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
    authModule.getAuthStatus.mockResolvedValue({ enabled: true, has_users: true, required: true });
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

  it('renders WelcomeGate when auth enabled, not required, no users, no guest', async () => {
    authModule.getAuthStatus.mockResolvedValue({ enabled: true, has_users: false, required: false });
    authModule.getCurrentUser.mockResolvedValue(null);

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('guest-continue-btn')).toBeTruthy();
    });
    // Three buttons: TG (primary), password login (always visible), continue.
    expect(screen.getByTestId('guest-telegram-btn')).toBeTruthy();
    expect(screen.getByTestId('guest-login-btn')).toBeTruthy();
    // No users → hint link to create a local account (replaces old setup button).
    expect(screen.getByTestId('guest-no-account-hint')).toBeTruthy();
    // Old secondary setup button is removed.
    expect(screen.queryByTestId('guest-setup-btn')).toBeNull();
    // Mandatory surfaces are NOT rendered
    expect(screen.queryByTestId('setup-page')).toBeNull();
    expect(screen.queryByTestId('login-page')).toBeNull();
  });

  it('renders WelcomeGate with Login secondary when auth not required and users exist', async () => {
    authModule.getAuthStatus.mockResolvedValue({ enabled: true, has_users: true, required: false });
    authModule.getCurrentUser.mockResolvedValue(null);

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('guest-continue-btn')).toBeTruthy();
    });
    // Three buttons always present; TG + password login + continue.
    expect(screen.getByTestId('guest-telegram-btn')).toBeTruthy();
    expect(screen.getByTestId('guest-login-btn')).toBeTruthy();
    // Users exist → no "create local account" hint link.
    expect(screen.queryByTestId('guest-no-account-hint')).toBeNull();
    expect(screen.queryByTestId('guest-setup-btn')).toBeNull();
  });

  it('enters the app as guest when "Continue without login" is clicked', async () => {
    authModule.getAuthStatus.mockResolvedValue({ enabled: true, has_users: false, required: false });
    authModule.getCurrentUser.mockResolvedValue(null);

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('guest-continue-btn')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('guest-continue-btn'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('layout')).toBeTruthy();
    });
    // Guest mode is now active in the store
    expect(useAuthStore.getState().guest).toBe(true);
    // Mandatory surfaces are NOT rendered
    expect(screen.queryByTestId('setup-page')).toBeNull();
    expect(screen.queryByTestId('login-page')).toBeNull();
  });

  it('navigates to Setup when "No account? Create a local one" hint is clicked (!required, !has_users)', async () => {
    authModule.getAuthStatus.mockResolvedValue({ enabled: true, has_users: false, required: false });
    authModule.getCurrentUser.mockResolvedValue(null);

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('guest-no-account-hint')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('guest-no-account-hint'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('setup-page')).toBeTruthy();
    });
    // authView is now 'setup'
    expect(useAuthStore.getState().authView).toBe('setup');
  });

  it('navigates to Login when "Login" is clicked (!required, has_users)', async () => {
    authModule.getAuthStatus.mockResolvedValue({ enabled: true, has_users: true, required: false });
    authModule.getCurrentUser.mockResolvedValue(null);

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('guest-login-btn')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('guest-login-btn'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeTruthy();
    });
    expect(useAuthStore.getState().authView).toBe('login');
  });

  it('required path is still mandatory: no guest button when required=true', async () => {
    authModule.getAuthStatus.mockResolvedValue({ enabled: true, has_users: true, required: true });
    authModule.getCurrentUser.mockResolvedValue(null);

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeTruthy();
    });
    // No guest affordance on the mandatory login surface
    expect(screen.queryByTestId('guest-continue-btn')).toBeNull();
    expect(screen.queryByTestId('guest-setup-btn')).toBeNull();
    expect(screen.queryByTestId('guest-login-btn')).toBeNull();
    expect(screen.queryByTestId('guest-telegram-btn')).toBeNull();
  });

  it('welcome gate shows three buttons (Telegram, password, continue)', async () => {
    authModule.getAuthStatus.mockResolvedValue({ enabled: true, has_users: true, required: false });
    authModule.getCurrentUser.mockResolvedValue(null);

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('guest-telegram-btn')).toBeTruthy();
    });
    expect(screen.getByTestId('guest-login-btn')).toBeTruthy();
    expect(screen.getByTestId('guest-continue-btn')).toBeTruthy();
  });

  it('navigates to TelegramLogin when TG button is clicked', async () => {
    authModule.getAuthStatus.mockResolvedValue({ enabled: true, has_users: false, required: false });
    authModule.getCurrentUser.mockResolvedValue(null);

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('guest-telegram-btn')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('guest-telegram-btn'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('telegram-page')).toBeTruthy();
    });
    expect(useAuthStore.getState().authView).toBe('telegram');
  });

  it('login page shows Telegram link', () => {
    // The Login page is mocked as a stub for gate tests; render the real
    // component to verify the TG link is present.
    const RealLogin = jest.requireActual('../../pages/Login').default;

    useAuthStore.setState({
      enabled: true,
      hasUsers: true,
      required: true,
      checked: true,
      user: null,
      authView: 'login',
    });

    render(
      <MemoryRouter>
        <RealLogin />
      </MemoryRouter>
    );

    expect(screen.getByTestId('login-tg-link')).toBeTruthy();
  });

  it('calls login_telegram on submit and refreshes session on success', async () => {
    authModule.getAuthStatus.mockResolvedValue({ enabled: true, has_users: false, required: false });
    authModule.getCurrentUser.mockResolvedValue(null);
    authModule.loginTelegram.mockResolvedValue({
      success: true,
      user: { id: 1, username: 'tg', role: 'admin' },
      entitlements: [],
    });

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    // Wait for welcome gate
    await waitFor(() => {
      expect(screen.getByTestId('guest-telegram-btn')).toBeTruthy();
    });

    // Click TG button → TelegramLogin renders
    await act(async () => {
      fireEvent.click(screen.getByTestId('guest-telegram-btn'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('telegram-page')).toBeTruthy();
    });

    // Type code and submit
    const codeInput = screen.getByTestId('telegram-code-input');
    await act(async () => {
      fireEvent.change(codeInput, { target: { value: '123456' } });
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('telegram-submit-btn'));
    });

    // Verify loginTelegram was called with the code
    await waitFor(() => {
      expect(authModule.loginTelegram).toHaveBeenCalledWith('123456');
    });

    // Verify init() was called again (getAuthStatus called twice: once on
    // mount, once after TG login success).
    await waitFor(() => {
      expect(authModule.getAuthStatus).toHaveBeenCalledTimes(2);
    });
  });
});
