/**
 * RolePreviewBanner component tests.
 *
 * Verifies the banner:
 *   - renders nothing when no preview is active
 *   - renders nothing for a non-admin user
 * - renders the banner text + role selector + exit button when a real
 *   admin has an active preview (preview_role set)
 * - exit button calls the store's setPreviewRole(null) action
 *
 * Mocks the auth backend module (fetch-based) and the sonner toast so
 * no real network / toast side-effects run in jsdom.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock the auth backend module so the store can import it without trying
// to call real fetch wrappers during store construction.
jest.mock('@/lib/backend/modules/auth', () => ({
  getAuthStatus: jest.fn(),
  getCurrentUser: jest.fn(),
  getMyPermissions: jest.fn(),
  loginUser: jest.fn(),
  loginTelegram: jest.fn(),
  loginTelegramOidc: jest.fn(),
  logoutUser: jest.fn(),
  setupUser: jest.fn(),
  setLoginPolicy: jest.fn(),
  setPreviewRole: jest.fn(),
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

jest.mock('@/lib/backend/core/invoke', () => ({
  setAuthExpiredHandler: jest.fn(),
  safeInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

// Mock sonner so toast.error calls are no-ops (the store action's error
// path is covered by the store tests; here we just need the banner to
// render without throwing).
jest.mock('sonner', () => ({
  toast: { error: jest.fn() },
}));

// Import the store and component AFTER all mocks are set up.
import { useAuthStore } from '@/stores/auth';
import { RolePreviewBanner } from '@/components/auth/RolePreviewBanner';

function renderBanner() {
  return render(
    <MemoryRouter>
      <RolePreviewBanner />
    </MemoryRouter>,
  );
}

describe('RolePreviewBanner — visibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default to a clean, enabled store state for each test.
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
      authView: 'welcome',
      permissions: [],
      permissionsLoaded: true,
    });
  });

  it('renders nothing when there is no user', () => {
    useAuthStore.setState({ user: null });
    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for a non-admin user', () => {
    useAuthStore.setState({
      user: { id: 2, username: 'regular', role: 'user' },
    });
    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for a real admin with no active preview', () => {
    useAuthStore.setState({
      user: { id: 1, username: 'admin', role: 'admin' },
    });
    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when auth is disabled (desktop mode)', () => {
    useAuthStore.setState({
      enabled: false,
      user: { id: 1, username: 'admin', role: 'admin', preview_role: 'user' },
    });
    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it('renders the banner text, selector, and exit when admin previews user', () => {
    useAuthStore.setState({
      user: {
        id: 1,
        username: 'admin',
        role: 'admin',
        preview_role: 'user',
      },
    });

    renderBanner();

    // Banner root is present.
    expect(screen.getByTestId('role-preview-banner')).toBeTruthy();
    // Banner text uses the i18n key with the previewed role label.
    // The default locale is 'en' — auth.role.user is "User".
    expect(screen.getByText(/Your current role: User/)).toBeTruthy();
    // Exit button is present (aria-label from i18n).
    expect(screen.getByRole('button', { name: 'Exit role preview' })).toBeTruthy();
  });
});

describe('RolePreviewBanner — exit action', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // window.location.reload() is a no-op in jsdom (logs a suppressed
    // "Not implemented" error), so setPreviewRole can call it without
    // reloading the test runner.
    useAuthStore.setState({
      enabled: true,
      hasUsers: true,
      required: true,
      enforceLogin: true,
      tgAuthMode: 'legacy',
      checked: true,
      user: {
        id: 1,
        username: 'admin',
        role: 'admin',
        preview_role: 'user',
      },
      busy: false,
      error: null,
      sessionExpired: false,
      guest: false,
      authView: 'welcome',
      permissions: [],
      permissionsLoaded: true,
    });
  });

  it('exit button calls setPreviewRole(null)', async () => {
    const setPreviewRoleSpy = jest.fn().mockResolvedValue(undefined);
    // Override the store action with a spy so we can observe the call
    // without going through the real backend mock.
    useAuthStore.setState({ setPreviewRole: setPreviewRoleSpy });

    renderBanner();

    const exitBtn = screen.getByRole('button', { name: 'Exit role preview' });
    fireEvent.click(exitBtn);

    await waitFor(() => {
      expect(setPreviewRoleSpy).toHaveBeenCalledWith(null);
    });
  });
});
