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
import { useAuthStore } from '../../stores/auth';

// Mock the auth backend module — these are the fetch wrappers the store calls.
jest.mock('../../lib/backend/modules/auth', () => ({
  getAuthStatus: jest.fn(),
  getCurrentUser: jest.fn(),
  loginUser: jest.fn(),
  loginTelegram: jest.fn(),
  loginTelegramOidc: jest.fn(),
  logoutUser: jest.fn(),
  setupUser: jest.fn(),
  listUsers: jest.fn(),
  createUser: jest.fn(),
  deleteUser: jest.fn(),
  setLoginPolicy: jest.fn(),
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
  setLoginPolicy: jest.Mock;
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
    });

    authModule.loginTelegramOidc.mockRejectedValue(new Error());

    await expect(
      useAuthStore.getState().loginTelegramOidc('whatever'),
    ).rejects.toThrow();

    expect(useAuthStore.getState().error).toBe('auth.tg.oidc.errorGeneric');
  });
});
