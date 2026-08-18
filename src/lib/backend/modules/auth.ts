/**
 * Auth Module
 *
 * Cookie-based auth against the FastAPI backend. Uses `fetch` directly
 * (not `safeInvoke`) because:
 *  - auth endpoints live under /api/auth/* (not /api/{command})
 *  - 401s on these endpoints are expected (bad credentials, no session)
 *    and must NOT trigger the global session-expiry handler wired into
 *    `safeInvoke` (see src/lib/backend/core/invoke.ts).
 *
 * Cookies are HttpOnly and same-origin: the browser sends them automatically
 * on every request, so no token is stored in JS / localStorage.
 */

import { getApiBaseUrl } from '../core/url';

// ── Types ───────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string | number;
  username: string;
  role: 'admin' | 'user' | 'vip' | 'premium' | 'elite';
}

export interface TelegramLoginResult {
  success: boolean;
  user?: AuthUser;
  entitlements?: unknown[];
  error?: string;
}

export interface AuthStatus {
  enabled: boolean;
  has_users: boolean;
  /**
   * True when the backend requires authentication
   * (server env flag OR (has_users AND enforce_login)).
   * When false, all /api/* work without a session and the frontend offers a
   * "continue without login" guest path.
   */
  required: boolean;
  /**
   * Admin-controllable login-enforcement toggle.  When false, a device
   * with users does NOT require login (admin opted out).  Defaults to
   * true when the backend omits the field (older backends).
   */
  enforce_login: boolean;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * GET /api/auth/status — whether auth is enabled, any users exist, and whether
 * a session is required. Never throws: returns { enabled: false } on network
 * failure so the app falls open to the desktop (unauthenticated) path instead
 * of hanging.
 */
export async function getAuthStatus(): Promise<AuthStatus> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/auth/status`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return { enabled: false, has_users: false, required: false, enforce_login: true };
    const data = (await parseJson(response)) as Partial<AuthStatus> | null;
    const enabled = Boolean(data?.enabled);
    const hasUsers = Boolean(data?.has_users);
    // Per backend contract: required = server env flag OR (has_users AND
    // enforce_login).  Default to enabled || hasUsers when the field is
    // missing (older backends) so existing VDS deployments with users
    // stay mandatory.
    const required =
      typeof data?.required === 'boolean' ? data.required : enabled || hasUsers;
    const enforceLogin =
      typeof data?.enforce_login === 'boolean' ? data.enforce_login : true;
    return { enabled, has_users: hasUsers, required, enforce_login: enforceLogin };
  } catch {
    return { enabled: false, has_users: false, required: false, enforce_login: true };
  }
}

/**
 * POST /api/auth/login — exchange credentials for a session cookie.
 * @throws {Error} with `status` property = 401 on bad credentials.
 */
export async function loginUser(username: string, password: string): Promise<AuthUser> {
  const response = await fetch(`${getApiBaseUrl()}/api/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  const data = (await parseJson(response)) as { user?: AuthUser; detail?: string } | null;

  if (!response.ok) {
    const err = new Error(data?.detail ?? 'Login failed') as Error & { status: number };
    err.status = response.status;
    throw err;
  }

  if (!data?.user) {
    const err = new Error('Login failed') as Error & { status: number };
    err.status = response.status;
    throw err;
  }

  return data.user;
}

/**
 * POST /api/auth/logout — invalidate the session cookie.
 * Never throws: best-effort.
 */
export async function logoutUser(): Promise<void> {
  try {
    await fetch(`${getApiBaseUrl()}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
  } catch {
    // best-effort — the cookie is cleared server-side; if the call fails
    // the user still drops back to the login page client-side.
  }
}

/**
 * GET /api/auth/me — the current session user, or null if not authenticated.
 * Never throws: returns null on network failure or 401.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/auth/me`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const data = (await parseJson(response)) as Partial<AuthUser> | null;
    if (!data?.username || !data?.role) return null;
    return {
      id: data.id ?? data.username,
      username: data.username,
      role: data.role,
    };
  } catch {
    return null;
  }
}

/**
 * POST /api/auth/setup — create the first admin user.
 * Only succeeds when has_users=false; otherwise the backend returns 403.
 * @throws {Error} with `status` property = 403 if users already exist, 400 on validation.
 */
export async function setupUser(username: string, password: string): Promise<AuthUser> {
  const response = await fetch(`${getApiBaseUrl()}/api/auth/setup`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  const data = (await parseJson(response)) as { user?: AuthUser; detail?: string } | null;

  if (!response.ok) {
    const err = new Error(data?.detail ?? 'Setup failed') as Error & { status: number };
    err.status = response.status;
    throw err;
  }

  if (!data?.user) {
    const err = new Error('Setup failed') as Error & { status: number };
    err.status = response.status;
    throw err;
  }

  return data.user;
}

/**
 * GET /api/auth/users — list all users (admin only).
 * @throws {Error} with `status` property = 401/403 on auth/permission failure.
 */
export async function listUsers(): Promise<AuthUser[]> {
  const response = await fetch(`${getApiBaseUrl()}/api/auth/users`, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });

  const data = (await parseJson(response)) as AuthUser[] | { detail?: string } | null;

  if (!response.ok) {
    const detail = Array.isArray(data) ? 'Failed to list users' : (data as { detail?: string })?.detail;
    const err = new Error(detail ?? 'Failed to list users') as Error & { status: number };
    err.status = response.status;
    throw err;
  }

  if (!Array.isArray(data)) return [];
  return data.map(u => ({
    id: u.id,
    username: u.username,
    role: u.role,
  }));
}

/**
 * POST /api/auth/users — create a new user (admin only).
 * @throws {Error} with `status` property = 409 on duplicate username, 400 on validation, 401/403 on auth.
 */
export async function createUser(username: string, password: string, role: AuthUser['role']): Promise<AuthUser> {
  const response = await fetch(`${getApiBaseUrl()}/api/auth/users`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username, password, role }),
  });

  const data = (await parseJson(response)) as { user?: AuthUser; detail?: string } | null;

  if (!response.ok) {
    const err = new Error(data?.detail ?? 'Failed to create user') as Error & { status: number };
    err.status = response.status;
    throw err;
  }

  if (!data?.user) {
    const err = new Error('Failed to create user') as Error & { status: number };
    err.status = response.status;
    throw err;
  }

  return data.user;
}

/**
 * PUT /api/auth/users/{id}/role — update a user's role (admin only).
 * @throws {Error} with `status` property = 400 on validation (e.g. last-admin guard), 401/403 on auth.
 */
export async function updateUserRole(id: string | number, role: string): Promise<AuthUser> {
  const response = await fetch(`${getApiBaseUrl()}/api/auth/users/${id}/role`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ role }),
  });

  const data = (await parseJson(response)) as { user?: AuthUser; detail?: string } | null;

  if (!response.ok) {
    const err = new Error(data?.detail ?? 'Failed to update role') as Error & { status: number };
    err.status = response.status;
    throw err;
  }

  if (!data?.user) {
    const err = new Error('Failed to update role') as Error & { status: number };
    err.status = response.status;
    throw err;
  }

  return data.user;
}

/**
 * DELETE /api/auth/users/{id} — delete a user (admin only).
 * @throws {Error} with `status` property = 400 on self-delete or last-admin delete, 404 not found.
 */
export async function deleteUser(id: string | number): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/api/auth/users/${id}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    const data = (await parseJson(response)) as { detail?: string } | null;
    const err = new Error(data?.detail ?? 'Failed to delete user') as Error & { status: number };
    err.status = response.status;
    throw err;
  }
}

/**
 * POST /api/auth/policy — persist the enforce_login login-enforcement toggle.
 * Admin-only; returns the persisted value.
 * @throws {Error} with `status` property = 401 (unauthenticated) or 403 (non-admin).
 */
export async function setLoginPolicy(enforceLogin: boolean): Promise<boolean> {
  const response = await fetch(`${getApiBaseUrl()}/api/auth/policy`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ enforce_login: enforceLogin }),
  });

  const data = (await parseJson(response)) as { enforce_login?: boolean; detail?: string } | null;

  if (!response.ok) {
    const err = new Error(data?.detail ?? 'Failed to update login policy') as Error & { status: number };
    err.status = response.status;
    throw err;
  }

  return Boolean(data?.enforce_login);
}

/**
 * POST /api/auth/login_telegram — exchange a one-time Telegram code for a
 * session cookie. Direct fetch like the other auth wrappers: a 401 on a bad
 * code is expected and must NOT trip the safeInvoke session-expiry hook.
 * On success the backend sets the HttpOnly session cookie and the caller
 * (auth store) re-runs init() so the gate closes.
 */
export async function loginTelegram(code: string): Promise<TelegramLoginResult> {
  const response = await fetch(`${getApiBaseUrl()}/api/auth/login_telegram`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ code }),
  });

  const data = (await parseJson(response)) as
    | (TelegramLoginResult & { detail?: string })
    | null;

  if (!response.ok) {
    throw new Error(data?.detail ?? data?.error ?? 'Telegram login failed');
  }
  return (data ?? { success: false }) as TelegramLoginResult;
}
