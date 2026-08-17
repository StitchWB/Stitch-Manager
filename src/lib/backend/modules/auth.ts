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
  role: 'admin' | 'user';
}

export interface AuthStatus {
  enabled: boolean;
  has_users: boolean;
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
 * GET /api/auth/status — whether auth is enabled and any users exist.
 * Never throws: returns { enabled: false } on network failure so the app
 * falls open to the desktop (unauthenticated) path instead of hanging.
 */
export async function getAuthStatus(): Promise<AuthStatus> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/auth/status`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return { enabled: false, has_users: false };
    const data = (await parseJson(response)) as Partial<AuthStatus> | null;
    return {
      enabled: Boolean(data?.enabled),
      has_users: Boolean(data?.has_users),
    };
  } catch {
    return { enabled: false, has_users: false };
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
      role: data.role === 'admin' ? 'admin' : 'user',
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
    role: u.role === 'admin' ? 'admin' : 'user',
  }));
}

/**
 * POST /api/auth/users — create a new user (admin only).
 * @throws {Error} with `status` property = 409 on duplicate username, 400 on validation, 401/403 on auth.
 */
export async function createUser(username: string, password: string, role: 'admin' | 'user'): Promise<AuthUser> {
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
