/**
 * Auth store (zustand).
 *
 * Single source of truth for the auth session state. The App gate reads
 * {enabled, hasUsers, checked, user} to decide which surface to render:
 *
 *   !checked                       → themed loading splash
 *   enabled && !hasUsers           → <Setup/>   (first-run onboarding)
 *   enabled && hasUsers && !user    → <Login/>
 *   otherwise                       → the normal app
 *
 * init() is idempotent and safe to call from React StrictMode double-invoke:
 * it fetches /api/auth/status, then (when enabled) /api/auth/me. When auth
 * is disabled, the store stays in the "checked, no user, not enabled" state
 * and the app renders exactly as before — no login surface, no gate.
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
  loginUser,
  logoutUser,
  setupUser,
  type AuthUser,
} from '../lib/backend/modules/auth';
import { setAuthExpiredHandler } from '../lib/backend/core/invoke';

export type AuthRole = 'admin' | 'user';

interface AuthState {
  /** Whether the backend has auth enabled. False on desktop / unconfigured. */
  enabled: boolean;
  /** Whether any users exist (drives first-run setup vs. login). */
  hasUsers: boolean;
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

  // Actions
  init: () => Promise<void>;
  login: (username: string, password: string) => Promise<boolean>;
  setup: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
  /** Drop the user back to the login surface (called by the 401 hook). */
  clearSession: () => void;
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
    checked: false,
    user: null,
    busy: false,
    error: null,
    sessionExpired: false,

    init: async () => {
      // Dedupe concurrent init() calls (React StrictMode double-invoke).
      if (initInFlight) return initInFlight;
      initInFlight = (async () => {
        try {
          const status = await getAuthStatus();
          if (!status.enabled) {
            set({ enabled: false, hasUsers: false, checked: true, user: null });
            return;
          }
          // Auth enabled — probe the session.
          const user = await getCurrentUser();
          set({
            enabled: true,
            hasUsers: status.has_users,
            checked: true,
            user,
            sessionExpired: false,
          });
        } catch {
          // Network failure: fall open to the desktop (unauthenticated) path
          // so the user can still see the app rather than a hung gate.
          set({ enabled: false, hasUsers: false, checked: true, user: null });
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
        set({ user, busy: false, hasUsers: true, sessionExpired: false });
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

    setup: async (username, password) => {
      set({ busy: true, error: null, sessionExpired: false });
      try {
        const user = await setupUser(username, password);
        set({ user, busy: false, hasUsers: true, sessionExpired: false });
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
        set({ user: null, busy: false, sessionExpired: false });
      }
    },

    clearError: () => set({ error: null, sessionExpired: false }),

    clearSession: () => {
      set({ user: null, sessionExpired: true });
    },
  };
});
