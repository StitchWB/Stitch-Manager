/**
 * Auth store (zustand).
 *
 * Single source of truth for the auth session state. The App gate reads
 * {enabled, required, hasUsers, checked, user, guest, authView} to decide
 * which surface to render:
 *
 *   !checked                              → themed loading splash
 *   required && !hasUsers && !user         → <Setup/>   (first-run, mandatory)
 *   required && hasUsers && !user          → <Login/>   (mandatory)
 *   !required && !user && !guest           → <WelcomeGate/>  (opt-in)
 *   !required && !user && guest            → the normal app (guest mode)
 *   !required && !user && authView='setup' → <Setup/>   (with back link)
 *   !required && !user && authView='login' → <Login/>   (with back link)
 *   otherwise (user present)               → the normal app
 *
 * init() is idempotent and safe to call from React StrictMode double-invoke:
 * it fetches /api/auth/status, then (when enabled) /api/auth/me. When auth
 * is disabled, the store stays in the "checked, no user, not enabled" state
 * and the app renders exactly as before — no login surface, no gate.
 *
 * `guest` is an in-memory-only flag (never persisted) that lets a desktop
 * user dismiss the welcome gate and use the app without authenticating. It
 * survives route changes but is cleared on logout, session expiry, or page
 * reload (since zustand state is not persisted).
 *
 * `authView` tracks which optional auth surface the user navigated to from
 * the welcome gate or the sidebar guest chip ('welcome' | 'setup' | 'login'
 * | 'telegram'). It is only consulted when !required && !user && !guest.
 *
 * `tgAuthMode` mirrors the backend's `tg_auth_mode` from /api/auth/status:
 * 'legacy' (one-time-code flow via the bot) or 'oidc' (official Telegram
 * popup via oauth.telegram.org). Defaults to 'legacy' when the backend
 * omits the field; the TelegramLogin surface renders the official OIDC
 * button above the code form only when this is 'oidc'.
 *
 * The shared fetch wrapper in src/lib/backend/core/invoke.ts calls
 * `setAuthExpiredHandler` to register a callback that fires when a regular
 * /api/* call returns 401. We register `clearSession` so the gate reappears
 * without a hard refresh.
 */

import { create } from 'zustand';
import {
  getAuthStatus,
  getCurrentUser,
  getMyPermissions,
  loginUser,
  loginTelegram as loginTelegramApi,
  loginTelegramOidc as loginTelegramOidcApi,
  logoutUser,
  setupUser,
  setLoginPolicy as setLoginPolicyApi,
  setPreviewRole as setPreviewRoleApi,
  PERMISSION_KEYS,
  type AuthUser,
} from '../lib/backend/modules/auth';
import { setAuthExpiredHandler } from '../lib/backend/core/invoke';

export type AuthRole = 'admin' | 'user';
export type AuthView = 'welcome' | 'setup' | 'login' | 'telegram';

/**
 * The effective role of the current session — the previewed role when an
 * admin is previewing, otherwise the real role. Returns null when there is
 * no session. This is the single source of truth for all role gating in the
 * frontend (sidebar, AdminRoute, CommandPalette, Settings, etc.).
 */
export function effectiveRole(user: AuthUser | null): AuthUser['role'] | null {
  if (!user) return null;
  return user.preview_role ?? user.role;
}

interface AuthState {
  /** Whether the backend has auth enabled. False on desktop / unconfigured. */
  enabled: boolean;
  /** Whether any users exist (drives first-run setup vs. login). */
  hasUsers: boolean;
  /** Whether a session is required (server env flag OR (has_users AND enforce_login)). */
  required: boolean;
  /** Admin-controllable login-enforcement toggle (effective value from /status). */
  enforceLogin: boolean;
  /** Which Telegram login surface the backend has wired up ('legacy' code flow vs 'oidc' popup). */
  tgAuthMode: 'legacy' | 'oidc';
  /** True once init() has finished (success or failure). */
  checked: boolean;
  /** The currently logged-in user, or null. */
  user: AuthUser | null;
  /** True while a login/setup/logout request is in flight. */
  busy: boolean;
  /** Last error message from login/setup (cleared on next attempt). */
  error: string | null;
  /** True when the session was dropped by a 401 on a regular API call. */
  sessionExpired: boolean;
  /** In-memory-only flag: user chose to continue without login (!required). */
  guest: boolean;
  /** Which optional auth surface to show when !required && !user && !guest. */
  authView: AuthView;
  /** Permission keys granted to the current session (empty when not loaded). */
  permissions: string[];
  /** True once /my_permissions has resolved (or auth is disabled). */
  permissionsLoaded: boolean;

  // Actions
  init: () => Promise<void>;
  login: (username: string, password: string) => Promise<boolean>;
  loginTelegram: (code: string) => Promise<boolean>;
  /** Exchange a Telegram OIDC id_token (from the official popup) for a session. */
  loginTelegramOidc: (idToken: string) => Promise<boolean>;
  setup: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
  /** Drop the user back to the login surface (called by the 401 hook). */
  clearSession: () => void;
  /** Dismiss the welcome gate and use the app without authenticating. */
  enterAsGuest: () => void;
  /** Leave guest mode and navigate to an optional auth surface. */
  exitGuest: (view?: AuthView) => void;
  /** Switch the optional auth surface (welcome/setup/login). */
  setAuthView: (view: AuthView) => void;
  /** Persist the enforce_login policy via POST /api/auth/policy (admin only). */
  setLoginPolicy: (enforceLogin: boolean) => Promise<boolean>;
  /**
   * Switch the admin's effective role for the current session via
   * POST /api/auth/preview_role (admin-only "role preview"). After the
   * backend confirms, a full app reload is REQUIRED: it re-initializes
   * every store and re-fetches every list as the previewed role. The
   * backend session is the single source of truth — no preview state is
   * persisted client-side.
   */
  setPreviewRole: (role: string | null) => Promise<void>;
  /**
   * Returns true when the current session may use `key`. When auth is
   * disabled, not yet loaded, or the effective role is admin, every key
   * is granted (desktop mode / fail-open). Otherwise the key must appear
   * in the `permissions` list fetched from /my_permissions.
   */
  hasPermission: (key: string) => boolean;
}

let initInFlight: Promise<void> | null = null;

export const useAuthStore = create<AuthState>((set, get) => {
  // Register the global 401 handler. When a regular /api/* call returns 401
  // and auth is enabled, drop the user back to the login page client-side.
  // The handler is a no-op when auth is disabled (desktop mode).
  setAuthExpiredHandler(() => {
    const { enabled, user, clearSession } = get();
    if (enabled && user) {
      clearSession();
    }
  });

  return {
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

    init: async () => {
      // Dedupe concurrent init() calls (React StrictMode double-invoke).
      if (initInFlight) return initInFlight;
      initInFlight = (async () => {
        try {
          const status = await getAuthStatus();
          if (!status.enabled) {
            // Auth disabled — desktop mode. Grant every key so the UI is
            // fully open and hasPermission() short-circuits to true.
            set({
              enabled: false,
              hasUsers: false,
              required: false,
              enforceLogin: true,
              tgAuthMode: 'legacy',
              checked: true,
              user: null,
              permissions: [...PERMISSION_KEYS],
              permissionsLoaded: true,
            });
            return;
          }
          // Auth enabled — probe the session.
          const user = await getCurrentUser();
          // Fetch the user's permission keys once the session is known.
          // When the user is null (not logged in) the call would 401; skip
          // and leave permissions empty until login completes.
          let permissions: string[] = [];
          let permissionsLoaded = false;
          if (user) {
            permissions = await getMyPermissions();
            permissionsLoaded = true;
          }
          set({
            enabled: true,
            hasUsers: status.has_users,
            required: status.required,
            // Default to true when the backend omits the field (older
            // backends) so existing deployments stay mandatory.
            enforceLogin:
              typeof status.enforce_login === 'boolean'
                ? status.enforce_login
                : true,
            // Default to 'legacy' when the backend omits the field (older
            // backends); the OIDC button only renders when explicitly 'oidc'.
            tgAuthMode: status.tg_auth_mode === 'oidc' ? 'oidc' : 'legacy',
            checked: true,
            user,
            permissions,
            permissionsLoaded,
            // Only clear the "session expired" banner once a session is
            // actually established. A re-init while logged out (StrictMode,
            // re-render) must NOT wipe the banner set by the 401 handler.
            sessionExpired: user ? false : get().sessionExpired,
            // If already authenticated, guest mode is irrelevant. Otherwise
            // default to the welcome surface when not required.
            guest: false,
            authView: 'welcome',
          });
        } catch {
          // Network failure: fall open to the desktop (unauthenticated) path
          // so the user can still see the app rather than a hung gate.
          set({
            enabled: false,
            hasUsers: false,
            required: false,
            enforceLogin: true,
            tgAuthMode: 'legacy',
            checked: true,
            user: null,
            permissions: [...PERMISSION_KEYS],
            permissionsLoaded: true,
          });
        } finally {
          initInFlight = null;
        }
      })();
      return initInFlight;
    },

    login: async (username, password) => {
      set({ busy: true, error: null, sessionExpired: false });
      try {
        const user = await loginUser(username, password);
        set({ user, busy: false, hasUsers: true, sessionExpired: false, guest: false, authView: 'welcome' });
        return true;
      } catch (err) {
        const status = (err as Error & { status?: number })?.status;
        const message =
          status === 401
            ? 'auth.error'
            : 'auth.errorNetwork';
        set({ busy: false, error: message });
        return false;
      }
    },

    loginTelegram: async (code) => {
      set({ busy: true, error: null, sessionExpired: false });
      try {
        const result = await loginTelegramApi(code);
        if (!result.success) {
          throw new Error(result.error || 'auth.tg.errorGeneric');
        }
        // Success — refresh session/user state so the gate closes.
        await get().init();
        set({ busy: false, authView: 'welcome' });
        return true;
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : 'auth.tg.errorGeneric';
        set({ busy: false, error: message });
        throw err;
      }
    },

    loginTelegramOidc: async (idToken) => {
      set({ busy: true, error: null, sessionExpired: false });
      try {
        const result = await loginTelegramOidcApi(idToken);
        if (!result.success) {
          throw new Error(result.error || 'auth.tg.oidc.errorGeneric');
        }
        // Success — refresh session/user state so the gate closes.
        await get().init();
        set({ busy: false, authView: 'welcome' });
        return true;
      } catch (err) {
        const message =
          err instanceof Error && err.message
            ? err.message
            : 'auth.tg.oidc.errorGeneric';
        set({ busy: false, error: message });
        throw err;
      }
    },

    setup: async (username, password) => {
      set({ busy: true, error: null, sessionExpired: false });
      try {
        const user = await setupUser(username, password);
        set({ user, busy: false, hasUsers: true, sessionExpired: false, guest: false, authView: 'welcome' });
        return true;
      } catch (err) {
        const status = (err as Error & { status?: number })?.status;
        const message =
          status === 403
            ? 'auth.setup.errorExists'
            : status === 400
              ? 'auth.setup.errorValidation'
              : 'auth.errorNetwork';
        set({ busy: false, error: message });
        return false;
      }
    },

    logout: async () => {
      set({ busy: true });
      try {
        await logoutUser();
      } finally {
        // Always drop the client-side session, even if the network call failed
        // — the cookie is cleared server-side on success, and on failure the
        // user still wants to leave the authenticated surface.
        set({ user: null, busy: false, sessionExpired: false, guest: false, authView: 'welcome' });
      }
    },

    clearError: () => set({ error: null, sessionExpired: false }),

    clearSession: () => {
      set({ user: null, sessionExpired: true, guest: false, authView: 'welcome', permissions: [], permissionsLoaded: false });
    },

    enterAsGuest: () => {
      set({ guest: true, authView: 'welcome' });
    },

    exitGuest: (view) => {
      set({ guest: false, authView: view ?? 'welcome' });
    },

    setAuthView: (view) => {
      set({ authView: view });
    },

    setLoginPolicy: async (enforceLogin) => {
      // Persist via POST /api/auth/policy (admin-only).  On success, refresh
      // the auth status so the store reflects the new effective `required`.
      // Returns the persisted value (which the caller can use to revert the
      // toggle on error).
      const persisted = await setLoginPolicyApi(enforceLogin);
      // Re-fetch status to update required/enforceLogin in the store.
      const status = await getAuthStatus();
      set({
        enforceLogin: status.enforce_login,
        required: status.required,
        hasUsers: status.has_users,
      });
      return persisted;
    },

    setPreviewRole: async (role) => {
      // POST /api/auth/preview_role (admin-only). On success, reload the
      // app so every store/list re-initializes as the previewed role. The
      // backend session is the single source of truth — no client-side
      // preview state is persisted.
      await setPreviewRoleApi(role);
      window.location.reload();
    },

    hasPermission: (key) => {
      const { enabled, permissionsLoaded, permissions, user } = get();
      // Fail open: desktop mode (auth disabled), not-yet-loaded, or admin
      // effective role → every key granted. Otherwise the key must be in
      // the list. The effective role covers admin preview: an admin
      // previewing a non-admin role no longer fails open here — the
      // permissions list (computed by the backend for the previewed role)
      // decides.
      if (!enabled || !permissionsLoaded) return true;
      if (effectiveRole(user) === 'admin') return true;
      return permissions.includes(key);
    },
  };
});
