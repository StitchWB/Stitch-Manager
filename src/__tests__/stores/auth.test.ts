/**
 * Auth store tests — covers the enforce_login policy surface cheaply.
 *
 * Tests the store's init() parsing of enforce_login from /api/auth/status
 * and the setLoginPolicy() action (calls POST /api/auth/policy, then
 * re-fetches status and updates the store).
 *
 * Mocks the auth backend module (fetch-based) rather than the store, so
 * the store's real init()/setLoginPolicy() logic is exercised.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { useAuthStore, effectiveRole } from '../../stores/auth';

// Mock the auth backend module — these are the fetch wrappers the store calls.
jest.mock('../../lib/backend/modules/auth', () => ({
  getAuthStatus: jest.fn(),
  getCurrentUser: jest.fn(),
  getMyPermissions: jest.fn(),
  getPermissionsMatrix: jest.fn(),
  setPermission: jest.fn(),
  loginUser: jest.fn(),
  loginTelegram: jest.fn(),
  loginTelegramOidc: jest.fn(),
  logoutUser: jest.fn(),
  setupUser: jest.fn(),
  listUsers: jest.fn(),
  createUser: jest.fn(),
  deleteUser: jest.fn(),
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

// Mock the invoke module's setAuthExpiredHandler so the store can register
// its 401 callback without trying to import the real fetch wrapper.
jest.mock('../../lib/backend/core/invoke', () => ({
  setAuthExpiredHandler: jest.fn(),
  safeInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

const authModule = jest.requireMock('../../lib/backend/modules/auth') as {
  getAuthStatus: jest.Mock;
  getCurrentUser: jest.Mock;
  getMyPermissions: jest.Mock;
  setLoginPolicy: jest.Mock;
  setPreviewRole: jest.Mock;
  loginTelegramOidc: jest.Mock;
};

describe('auth store — enforce_login policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the store between tests so init() runs fresh.
    useAuthStore.setState({
      enabled: false,
      hasUsers: false,
      required: false,
      enforceLogin: true,
      tgAuthMode: 'legacy',
      checked: false,
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

  it('init() parses enforce_login from status', async () => {
    authModule.getAuthStatus.mockResolvedValue({
      enabled: true,
      has_users: true,
      required: false,
      enforce_login: false,
    });
    authModule.getCurrentUser.mockResolvedValue(null);
    authModule.getMyPermissions.mockResolvedValue([]);

    await useAuthStore.getState().init();

    const state = useAuthStore.getState();
    expect(state.enabled).toBe(true);
    expect(state.hasUsers).toBe(true);
    expect(state.required).toBe(false);
    expect(state.enforceLogin).toBe(false);
    expect(state.checked).toBe(true);
  });

  it('init() defaults enforce_login to true when backend omits the field', async () => {
    authModule.getAuthStatus.mockResolvedValue({
      enabled: true,
      has_users: false,
      required: false,
      // enforce_login omitted — older backend
    });
    authModule.getCurrentUser.mockResolvedValue(null);
    authModule.getMyPermissions.mockResolvedValue([]);

    await useAuthStore.getState().init();

    const state = useAuthStore.getState();
    expect(state.enforceLogin).toBe(true);
  });

  it('setLoginPolicy calls the API and refreshes status', async () => {
    // Seed the store as enabled + admin.
    useAuthStore.setState({
      enabled: true,
      hasUsers: true,
      required: true,
      enforceLogin: true,
      checked: true,
      user: { id: 1, username: 'admin', role: 'admin' },
    });

    // setLoginPolicy API returns the persisted value; getAuthStatus returns
    // the refreshed status with enforce_login=false.
    authModule.setLoginPolicy.mockResolvedValue(false);
    authModule.getAuthStatus.mockResolvedValue({
      enabled: true,
      has_users: true,
      required: false,
      enforce_login: false,
    });

    const result = await useAuthStore.getState().setLoginPolicy(false);

    expect(authModule.setLoginPolicy).toHaveBeenCalledWith(false);
    expect(result).toBe(false);
    // Store was refreshed from the new status.
    const state = useAuthStore.getState();
    expect(state.enforceLogin).toBe(false);
    expect(state.required).toBe(false);
  });

  it('setLoginPolicy propagates errors (caller can revert)', async () => {
    useAuthStore.setState({
      enabled: true,
      hasUsers: true,
      required: true,
      enforceLogin: true,
      checked: true,
      user: { id: 1, username: 'admin', role: 'admin' },
    });

    authModule.setLoginPolicy.mockRejectedValue(
      Object.assign(new Error('Forbidden'), { status: 403 }),
    );

    await expect(
      useAuthStore.getState().setLoginPolicy(false),
    ).rejects.toThrow('Forbidden');

    // Store was NOT updated (error thrown before the status refresh).
    expect(useAuthStore.getState().enforceLogin).toBe(true);
  });
});

// ── Telegram OIDC ───────────────────────────────────────────────────────────

describe('auth store — Telegram OIDC (tg_auth_mode)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the store between tests so init() runs fresh.
    useAuthStore.setState({
      enabled: false,
      hasUsers: false,
      required: false,
      enforceLogin: true,
      tgAuthMode: 'legacy',
      checked: false,
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

  it('init() maps tg_auth_mode="oidc" from status into tgAuthMode', async () => {
    authModule.getAuthStatus.mockResolvedValue({
      enabled: true,
      has_users: true,
      required: true,
      enforce_login: true,
      tg_auth_mode: 'oidc',
    });
    authModule.getCurrentUser.mockResolvedValue(null);
    authModule.getMyPermissions.mockResolvedValue([]);

    await useAuthStore.getState().init();

    expect(useAuthStore.getState().tgAuthMode).toBe('oidc');
  });

  it('init() defaults tgAuthMode to "legacy" when backend omits the field', async () => {
    authModule.getAuthStatus.mockResolvedValue({
      enabled: true,
      has_users: true,
      required: true,
      enforce_login: true,
      // tg_auth_mode omitted — older backend
    });
    authModule.getCurrentUser.mockResolvedValue(null);
    authModule.getMyPermissions.mockResolvedValue([]);

    await useAuthStore.getState().init();

    expect(useAuthStore.getState().tgAuthMode).toBe('legacy');
  });

  it('init() falls back to "legacy" on network failure', async () => {
    authModule.getAuthStatus.mockRejectedValue(new Error('network down'));

    await useAuthStore.getState().init();

    expect(useAuthStore.getState().tgAuthMode).toBe('legacy');
    expect(useAuthStore.getState().checked).toBe(true);
  });

  it('loginTelegramOidc calls the wrapper with the id_token and re-runs init() on success', async () => {
    useAuthStore.setState({
      enabled: true,
      hasUsers: true,
      required: true,
      checked: true,
      user: null,
      authView: 'telegram',
      permissions: [],
      permissionsLoaded: false,
    });

    authModule.loginTelegramOidc.mockResolvedValue({
      success: true,
      user: { id: 1, username: 'tg', role: 'admin' },
      entitlements: [],
    });
    // init() re-runs getAuthStatus + getCurrentUser on success.
    authModule.getAuthStatus.mockResolvedValue({
      enabled: true,
      has_users: true,
      required: true,
      enforce_login: true,
      tg_auth_mode: 'oidc',
    });
    authModule.getCurrentUser.mockResolvedValue({
      id: 1,
      username: 'tg',
      role: 'admin',
    });
    authModule.getMyPermissions.mockResolvedValue([]);

    const result = await useAuthStore.getState().loginTelegramOidc('id-jwt-token');

    expect(authModule.loginTelegramOidc).toHaveBeenCalledWith('id-jwt-token');
    expect(result).toBe(true);
    // init() re-ran — getAuthStatus called again after the login wrapper.
    expect(authModule.getAuthStatus).toHaveBeenCalled();
    // authView reset to 'welcome' and busy cleared.
    expect(useAuthStore.getState().authView).toBe('welcome');
    expect(useAuthStore.getState().busy).toBe(false);
  });

  it('loginTelegramOidc sets error and rethrows on failure', async () => {
    useAuthStore.setState({
      enabled: true,
      hasUsers: true,
      required: true,
      checked: true,
      user: null,
      authView: 'telegram',
      permissions: [],
      permissionsLoaded: false,
    });

    authModule.loginTelegramOidc.mockRejectedValue(new Error('Bad id_token'));

    await expect(
      useAuthStore.getState().loginTelegramOidc('bad-token'),
    ).rejects.toThrow('Bad id_token');

    // Error surfaced in store.error; busy cleared.
    expect(useAuthStore.getState().error).toBe('Bad id_token');
    expect(useAuthStore.getState().busy).toBe(false);
  });

  it('loginTelegramOidc falls back to the i18n key when the wrapper throws without a message', async () => {
    useAuthStore.setState({
      enabled: true,
      hasUsers: true,
      required: true,
      checked: true,
      user: null,
      authView: 'telegram',
      permissions: [],
      permissionsLoaded: false,
    });

    authModule.loginTelegramOidc.mockRejectedValue(new Error());

    await expect(
      useAuthStore.getState().loginTelegramOidc('whatever'),
    ).rejects.toThrow();

    expect(useAuthStore.getState().error).toBe('auth.tg.oidc.errorGeneric');
  });
});

// ── Role preview (effectiveRole + setPreviewRole + hasPermission) ───────────

describe('auth store — role preview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the store between tests. window.location.reload() is a no-op
    // in jsdom (logs a suppressed "Not implemented" error), so setPreviewRole
    // can call it without reloading the test runner.
    useAuthStore.setState({
      enabled: false,
      hasUsers: false,
      required: false,
      enforceLogin: true,
      tgAuthMode: 'legacy',
      checked: false,
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

  // ── effectiveRole helper ────────────────────────────────────────────────

  it('effectiveRole returns null for a null user', () => {
    expect(effectiveRole(null)).toBeNull();
  });

  it('effectiveRole returns the real role when preview_role is null/undefined', () => {
    const user = { id: 1, username: 'admin', role: 'admin' as const };
    expect(effectiveRole(user)).toBe('admin');
    expect(effectiveRole({ ...user, preview_role: null })).toBe('admin');
  });

  it('effectiveRole returns the previewed role when preview_role is set', () => {
    const user = {
      id: 1,
      username: 'admin',
      role: 'admin' as const,
      preview_role: 'user' as const,
    };
    expect(effectiveRole(user)).toBe('user');
  });

  // ── hasPermission ────────────────────────────────────────────────────────

  it('hasPermission does NOT fail-open for an admin previewing a non-admin role (permissions list decides)', () => {
    // Seed the store as enabled + admin previewing 'user', with an empty
    // permissions list (the backend computes it for the previewed role).
    useAuthStore.setState({
      enabled: true,
      hasUsers: true,
      required: true,
      checked: true,
      user: {
        id: 1,
        username: 'admin',
        role: 'admin',
        preview_role: 'user',
      },
      permissions: [],
      permissionsLoaded: true,
    });

    // Admin previewing 'user' with no permissions granted → key denied.
    expect(useAuthStore.getState().hasPermission('section.settings')).toBe(false);

    // Grant the key in the permissions list → key granted (list decides).
    useAuthStore.setState({ permissions: ['section.settings'] });
    expect(useAuthStore.getState().hasPermission('section.settings')).toBe(true);
  });

  it('hasPermission still fails-open for a real admin (no preview)', () => {
    useAuthStore.setState({
      enabled: true,
      hasUsers: true,
      required: true,
      checked: true,
      user: { id: 1, username: 'admin', role: 'admin' },
      permissions: [],
      permissionsLoaded: true,
    });

    // Real admin (no preview) → every key granted regardless of the list.
    expect(useAuthStore.getState().hasPermission('section.settings')).toBe(true);
  });

  // ── setPreviewRole action ───────────────────────────────────────────────

  it('setPreviewRole calls the API wrapper with the role', async () => {
    useAuthStore.setState({
      enabled: true,
      hasUsers: true,
      required: true,
      checked: true,
      user: { id: 1, username: 'admin', role: 'admin' },
    });

    authModule.setPreviewRole.mockResolvedValue(undefined);

    // jsdom's window.location.reload() is a no-op (logs a suppressed
    // "Not implemented" error), so this call completes without reloading.
    await useAuthStore.getState().setPreviewRole('user');

    expect(authModule.setPreviewRole).toHaveBeenCalledWith('user');
  });

  it('setPreviewRole passes null when exiting the preview', async () => {
    useAuthStore.setState({
      enabled: true,
      hasUsers: true,
      required: true,
      checked: true,
      user: { id: 1, username: 'admin', role: 'admin', preview_role: 'user' },
    });

    authModule.setPreviewRole.mockResolvedValue(undefined);

    await useAuthStore.getState().setPreviewRole(null);

    expect(authModule.setPreviewRole).toHaveBeenCalledWith(null);
  });

  it('setPreviewRole propagates errors (does not call reload)', async () => {
    useAuthStore.setState({
      enabled: true,
      hasUsers: true,
      required: true,
      checked: true,
      user: { id: 1, username: 'admin', role: 'admin' },
    });

    authModule.setPreviewRole.mockRejectedValue(
      Object.assign(new Error('Forbidden'), { status: 403 }),
    );

    await expect(
      useAuthStore.getState().setPreviewRole('user'),
    ).rejects.toThrow('Forbidden');

    // The API wrapper was called (and rejected); reload is never reached
    // because the await throws first.
    expect(authModule.setPreviewRole).toHaveBeenCalledWith('user');
  });
});
