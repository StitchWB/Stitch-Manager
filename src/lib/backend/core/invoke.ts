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
export async function safeInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const key = getRequestKey(command, args);
  
  // Check cache first (for sequential StrictMode calls)
  const cached = _responseCache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.data as T;
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
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(args || {}),
      });

      const data = await response.json();

      if (!response.ok) {
        throw data;
      }

      // If we were offline and now succeeded, mark online
      markBackendOnline();
      
      // Cache successful result for short TTL (dedupes sequential calls)
      _responseCache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });

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
      return await safeInvoke<T>(command, args);
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
