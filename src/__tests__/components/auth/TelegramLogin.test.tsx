/**
 * TelegramLogin component tests.
 *
 * Verifies the official Telegram OIDC button (`.tg-auth-button`) renders
 * only when the auth store reports `tgAuthMode === 'oidc'`, and that the
 * one-time-code form is present in BOTH modes (it is the independent
 * fallback mechanism).
 *
 * The `telegramLogin` helper module is mocked so no real script injection
 * happens in jsdom (which has no real network / DOM script execution).
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock the telegramLogin helper so no real <script> is injected into jsdom.
// The component only calls `ensureTelegramLoginScript` on click, and reads
// `TG_OIDC_CLIENT_ID` at module-eval time — both are stubbed here.
jest.mock('@/lib/telegramLogin', () => ({
  ensureTelegramLoginScript: jest.fn().mockResolvedValue(undefined),
  TG_OIDC_CLIENT_ID: '8606505679',
}));

// Mock the links module so STITCH_BOT_LOGIN_URL resolves without pulling
// extra dependencies.
jest.mock('@/lib/links', () => ({
  STITCH_BOT_LOGIN_URL: 'https://t.me/stitch_bot',
}));

// Mock the auth backend module so the store can import it without trying
// to call real fetch wrappers during store construction.
jest.mock('@/lib/backend/modules/auth', () => ({
  getAuthStatus: jest.fn(),
  getCurrentUser: jest.fn(),
  loginUser: jest.fn(),
  loginTelegram: jest.fn(),
  loginTelegramOidc: jest.fn(),
  logoutUser: jest.fn(),
  setupUser: jest.fn(),
  setLoginPolicy: jest.fn(),
}));

jest.mock('@/lib/backend/core/invoke', () => ({
  setAuthExpiredHandler: jest.fn(),
  safeInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

// Mock the app store so the component re-renders on language change without
// pulling the real store (which has many other dependencies).
const mockAppStoreState = {
  theme: 'dark' as const,
  language: 'en' as const,
  sidebarCollapsed: false,
  toggleSidebar: jest.fn(),
  addNotification: jest.fn(),
};
jest.mock('@/stores/app', () => ({
  useAppStore: Object.assign(
    (selector?: (s: typeof mockAppStoreState) => unknown) =>
      selector ? selector(mockAppStoreState) : mockAppStoreState,
    { getState: () => mockAppStoreState },
  ),
}));

// Import the store and component AFTER all mocks are set up.
import { useAuthStore } from '@/stores/auth';
import TelegramLogin from '@/components/auth/TelegramLogin';

function renderTelegramLogin() {
  return render(
    <MemoryRouter>
      <TelegramLogin />
    </MemoryRouter>,
  );
}

describe('TelegramLogin component — OIDC button visibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default to a clean, legacy-mode store state for each test.
    useAuthStore.setState({
      enabled: true,
      hasUsers: true,
      required: true,
      enforceLogin: true,
      tgAuthMode: 'legacy',
      checked: true,
      user: null,
      busy: false,
      error: null,
      sessionExpired: false,
      guest: false,
      authView: 'telegram',
    });
  });

  it('renders the official .tg-auth-button when tgAuthMode is "oidc"', () => {
    useAuthStore.setState({ tgAuthMode: 'oidc' });

    renderTelegramLogin();

    const btn = screen.queryByTestId('tg-auth-button');
    expect(btn).not.toBeNull();
    // The host button carries the class the library keys off of.
    expect(btn?.className).toContain('tg-auth-button');
    // The wrapper div is also present (used to center the library element).
    expect(screen.queryByTestId('tg-oidc-wrapper')).not.toBeNull();
  });

  it('does NOT render the .tg-auth-button when tgAuthMode is "legacy"', () => {
    useAuthStore.setState({ tgAuthMode: 'legacy' });

    renderTelegramLogin();

    expect(screen.queryByTestId('tg-auth-button')).toBeNull();
    expect(screen.queryByTestId('tg-oidc-wrapper')).toBeNull();
  });

  it('renders the one-time-code input in BOTH modes (fallback mechanism)', () => {
    // Legacy mode
    useAuthStore.setState({ tgAuthMode: 'legacy' });
    const { unmount } = renderTelegramLogin();
    expect(screen.getByTestId('telegram-code-input')).toBeTruthy();
    expect(screen.getByTestId('telegram-submit-btn')).toBeTruthy();
    unmount();

    // OIDC mode — code form still present below the official button
    useAuthStore.setState({ tgAuthMode: 'oidc' });
    renderTelegramLogin();
    expect(screen.getByTestId('telegram-code-input')).toBeTruthy();
    expect(screen.getByTestId('telegram-submit-btn')).toBeTruthy();
    expect(screen.getByTestId('tg-auth-button')).toBeTruthy();
  });

  it('registers Telegram.Login.init with client_id in oidc mode', async () => {
    const init = jest.fn();
    (window as unknown as { Telegram: unknown }).Telegram = { Login: { init } };
    useAuthStore.setState({ tgAuthMode: 'oidc' });

    renderTelegramLogin();

    await waitFor(() => expect(init).toHaveBeenCalledTimes(1));
    expect(init.mock.calls[0][0]).toEqual({
      client_id: '8606505679',
      scope: ['openid', 'profile'],
    });
    delete (window as unknown as { Telegram?: unknown }).Telegram;
  });

  it('does NOT call Telegram.Login.init in legacy mode', async () => {
    const init = jest.fn();
    (window as unknown as { Telegram: unknown }).Telegram = { Login: { init } };
    useAuthStore.setState({ tgAuthMode: 'legacy' });

    renderTelegramLogin();
    await new Promise(r => setTimeout(r, 0));

    expect(init).not.toHaveBeenCalled();
    delete (window as unknown as { Telegram?: unknown }).Telegram;
  });

  it('renders the "or" divider only in oidc mode (separates button from code form)', () => {
    // OIDC mode — divider present
    useAuthStore.setState({ tgAuthMode: 'oidc' });
    const { unmount } = renderTelegramLogin();
    // The divider text comes from the en locale: "or"
    expect(screen.getByText('or')).toBeTruthy();
    unmount();

    // Legacy mode — no divider
    useAuthStore.setState({ tgAuthMode: 'legacy' });
    renderTelegramLogin();
    expect(screen.queryByText('or')).toBeNull();
  });
});
