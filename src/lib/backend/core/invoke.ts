/**
 * Core API invoke wrapper with error handling (Python/FastAPI version)
 */

import { BackendError } from './types';
import { getApiBaseUrl } from './url';

export const API_BASE_URL = getApiBaseUrl();

// ── Request deduplication ───────────────────────────────────────────────────
// Prevents duplicate concurrent requests (e.g., from React StrictMode double-render)
const _inFlightRequests = new Map<string, Promise<unknown>>();

// ── Response cache ──────────────────────────────────────────────────────────
// Short-lived cache (50ms TTL) to dedupe sequential requests (e.g., StrictMode mount → cleanup → mount)
const _responseCache = new Map<string, { data: unknown; expires: number }>();
const CACHE_TTL_MS = 50;

function getRequestKey(command: string, args?: Record<string, unknown>): string {
  return `${command}:${JSON.stringify(args || {})}`;
}

// ── Backend connectivity tracking ─────────────────────────────────────────
let _backendOffline = false;
let _offlineToastId: string | number | null = null;

// ── Auth session-expiry hook ────────────────────────────────────────────────
// When auth is enabled and a regular /api/* call (via safeInvoke) comes back
// 401, the session cookie has expired or been revoked. The auth store
// registers a handler here during init() so the app can drop the user back
// to the login page without a hard refresh. Auth endpoints (/api/auth/*)
// do NOT go through safeInvoke — they use fetch directly in
// src/lib/backend/modules/auth.ts — so their expected 401s (bad credentials,
// no session) never reach this handler.
let _onAuthExpired: (() => void) | null = null;

/**
 * Register (or clear) the global auth-expired callback. Called when a
 * non-auth /api/* request returns 401 while the user is logged in.
 */
export function setAuthExpiredHandler(handler: (() => void) | null): void {
  _onAuthExpired = handler;
}

function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('err_connection_refused') ||
    msg.includes('err_connection_reset') ||
    msg.includes('err_name_not_resolved') ||
    msg.includes('err_internet_disconnected') ||
    msg.includes('load failed') ||
    (msg.includes('fetch') && msg.includes('abort'))
  );
}

function markBackendOffline() {
  if (_backendOffline) return; // already shown
  _backendOffline = true;
  // Dynamic import to avoid circular deps — toast is optional
  import('sonner').then(({ toast }) => {
    _offlineToastId = toast.error('Backend is offline', {
      id: 'backend-offline',
      duration: Infinity,
      description: 'Stitch Manager backend is not reachable. Check that the backend process is running.',
    });
  }).catch(() => { /* toast not available */ });
}

function markBackendOnline() {
  if (!_backendOffline) return;
  _backendOffline = false;
  import('sonner').then(({ toast }) => {
    if (_offlineToastId !== null) {
      toast.dismiss(_offlineToastId);
      _offlineToastId = null;
    }
    toast.success('Backend is back online');
  }).catch(() => { /* toast not available */ });
}

function extractInvokeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (!error || typeof error !== 'object') {
    return '';
  }

  const record = error as Record<string, unknown>;

  // Common API error shape: { message: "..." }
  if (typeof record.message === 'string' && record.message.trim()) {
    return record.message;
  }

  // FastAPI error shape: { detail: "..." } or { detail: [{ msg: "..." }] }
  const detail = record.detail;
  if (typeof detail === 'string' && detail.trim()) {
    return detail;
  }
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0];
    if (first && typeof first === 'object') {
      const msg = (first as Record<string, unknown>).msg;
      if (typeof msg === 'string' && msg.trim()) {
        return msg;
      }
    }
  }

  // Nested wrapper shape: { error: { message: "..." } }
  const nestedError = record.error;
  if (nestedError && typeof nestedError === 'object') {
    const nestedMessage = (nestedError as Record<string, unknown>).message;
    if (typeof nestedMessage === 'string' && nestedMessage.trim()) {
      return nestedMessage;
    }
  }

  // Fallback: preserve structured payload for easier debugging.
  try {
    const serialized = JSON.stringify(error);
    return serialized && serialized !== '{}' ? serialized : '';
  } catch {
    return '';
  }
}

/**
 * Wrapper for API invoke with standardized error handling
 *
 * @param command - The API command to invoke (mapped to /api/command)
 * @param args - Optional arguments to pass to the command
 * @returns Promise resolving to the command result
 * @throws {BackendError} When the command fails
 *
 * @example
 * ```typescript
 * const accounts = await safeInvoke<Account[]>('list_accounts', { provider: 'kiro' });
 * ```
 */
export async function safeInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
  opts?: { noCache?: boolean; _suppressAuthExpired?: boolean },
): Promise<T> {
  const key = getRequestKey(command, args);

  // noCache: secrets must not linger in the renderer response cache
  // (security review: expired entries were never evicted from the Map).
  if (!opts?.noCache) {
    // Check cache first (for sequential StrictMode calls)
    const cached = _responseCache.get(key);
    if (cached && cached.expires > Date.now()) {
      return cached.data as T;
    }
  }
  
  // Check if identical request is already in flight
  const existing = _inFlightRequests.get(key);
  if (existing) {
    return existing as Promise<T>;
  }
  
  // Create new request promise
  const promise = (async (): Promise<T> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/${command}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(args || {}),
      });

      // Guard the JSON parse — a 401 from a non-FastAPI source (dev proxy,
      // gateway, cold-start error page) may carry a non-JSON body that would
      // throw on .json() and mask the real status.
      const data = await response.json().catch(() => ({} as Record<string, unknown>));

      // Session expired on a regular API call → drop the user back to login.
      // Fire ONLY on a genuine session-expiry 401 from the FastAPI auth
      // middleware (JSON body {"detail": "Not authenticated"}). Other 401s
      // (permission errors, transient proxy 401s) must NOT force a logout —
      // this was the root cause of spurious session drops.
      const contentType = response.headers?.get('content-type') ?? '';
      const detail = (data as { detail?: unknown })?.detail;
      const isSessionExpired401 =
        response.status === 401 &&
        contentType.includes('application/json') &&
        detail === 'Not authenticated';
      if (isSessionExpired401 && _onAuthExpired && !opts?._suppressAuthExpired) {
        _onAuthExpired();
      }

      if (!response.ok) {
        throw data;
      }

      // If we were offline and now succeeded, mark online
      markBackendOnline();
      
      // Cache successful result for short TTL (dedupes sequential calls)
      if (!opts?.noCache) {
        _responseCache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
      }

      return data as T;
    } catch (error) {
      // Detect connection errors (backend offline)
      if (isConnectionError(error)) {
        markBackendOffline();
        throw new BackendError(
          'Backend is offline — connection refused',
          'BACKEND_OFFLINE',
          { command, args, error }
        );
      }
      const message = extractInvokeErrorMessage(error) || 'Unknown error occurred';
      throw new BackendError(message, 'INVOKE_ERROR', { command, args, error });
    } finally {
      // Remove from in-flight map when done (success or error)
      _inFlightRequests.delete(key);
    }
  })();
  
  // Store promise in map
  _inFlightRequests.set(key, promise);
  
  return promise;
}

/**
 * Invoke an API command with automatic retry on failure
 *
 * @param command - The API command to invoke
 * @param args - Optional arguments to pass to the command
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @param retryDelay - Delay between retries in milliseconds (default: 1000)
 * @returns Promise resolving to the command result
 * @throws {BackendError} When all retry attempts fail
 */
export async function safeInvokeWithRetry<T>(
  command: string,
  args?: Record<string, unknown>,
  maxRetries: number = 3,
  retryDelay: number = 1000
): Promise<T> {
  let lastError: BackendError | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Suppress the session-expiry side-effect on non-final attempts so a
      // transient 401 mid-retry doesn't log the user out; only the final
      // attempt may fire the handler (and only for a genuine expiry, per
      // safeInvoke's discrimination above).
      return await safeInvoke<T>(command, args, {
        _suppressAuthExpired: attempt < maxRetries,
      });
    } catch (error) {
      lastError =
        error instanceof BackendError
          ? error
          : new BackendError(
              error instanceof Error ? error.message : 'Unknown error',
              'RETRY_FAILED',
              { command, args, attempt }
            );

      // Don't delay after the last attempt
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }

  throw lastError;
}

/**
 * Batch invoke multiple API commands in parallel
 *
 * @param commands - Array of command configurations
 * @returns Promise resolving to array of results
 * @throws {BackendError} When any command fails
 */
export async function batchInvoke<T>(
  commands: Array<{ command: string; args?: Record<string, unknown> }>
): Promise<T[]> {
  const promises = commands.map(({ command, args }) => safeInvoke<T>(command, args));
  return Promise.all(promises);
}
