/**
 * WebSocket Event Adapter — connects to the Python EventBus.
 *
 * Connects to the Python EventBus via the WebSocket URL resolved by getWsUrl()
 * and exposes a `listen()` / `emit()` API for frontend components.
 *
 * Python EventBus payload format:
 *   { "event": "account.token_refreshed", "data": { ... }, "timestamp": "..." }
 *
 * Frontend Backend-style:
 *   listen("account-created", (event) => { event.payload })
 */

import { safeInvoke } from '@/lib/backend/core/invoke';
import { getWsUrl } from '@/lib/backend/core/url';

// ── Types ────────────────────────────────────────────────────────────────────

export type UnlistenFn = () => void;

interface Event<T = unknown> {
  payload: T;
  event: string;
}

type EventHandler<T = unknown> = (event: Event<T>) => void;

interface WSMessage {
  event: string;
  data: unknown;
  timestamp?: string;
}

// ── Event name mapping ───────────────────────────────────────────────────────
// Python EventBus names (dot.case) → frontend names the code currently listens to.
// Only add entries where the names differ.  If a frontend component already
// listens with the Python name (e.g. "obs:event"), no mapping is needed.

const PYTHON_TO_FRONTEND: Record<string, string> = {
  // Registration domain
  'registration.completed': 'REGISTRATION_COMPLETE',
  'registration.failed': 'REGISTRATION_ERROR',
  'registration.progress': 'REGISTRATION_PROGRESS',
  'registration.account_added': 'ACCOUNT_ADDED',

  // Account domain
  'account.created': 'account-created',
  'account.quota_updated': 'account:quota-updated',
  'account.token_refreshed': 'account:token-refreshed',
  'account.deleted': 'account:deleted',

  // Log domain
  'logs.new': 'logs:new',
  'logs.cleared': 'logs:cleared',

  // Settings
  'settings.updated': 'SETTINGS_UPDATED',
  'proxy.config_updated': 'PROXY_CONFIG_UPDATED',

  // Pipeline
  'pipeline.config': 'registration:pipeline_config',
  'pipeline.step_started': 'registration:step_started',
  'pipeline.step_completed': 'registration:step_completed',
  'pipeline.step_failed': 'registration:step_failed',
  'pipeline.step_skipped': 'registration:step_skipped',
  'pipeline.step_waiting': 'registration:step_waiting',
  'pipeline.resumed': 'registration:pipeline_resumed',
  'pipeline.manual_entered': 'registration:manual_mode_entered',
  'pipeline.manual_exited': 'registration:manual_mode_exited',
  'pipeline.aborted': 'registration:pipeline_aborted',

  // Stage tracking
  'stage.changed': 'stage-changed',
  'stage.progress': 'stage-progress',
  'stage.complete': 'stage-complete',

  // Observability (passed through as-is — frontend already uses 'obs:event')
  'obs:event': 'obs:event',
};

// ── Singleton WebSocket connection ───────────────────────────────────────────

const WS_URL = getWsUrl();
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const MAX_LISTENERS_PER_EVENT = 500;

/** Map: frontend event name → Set of handlers */
const listeners = new Map<string, Set<EventHandler>>();

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelayMs = RECONNECT_BASE_MS;
let disposed = false;

function getOrCreateListenerSet(eventName: string): Set<EventHandler> {
  let set = listeners.get(eventName);
  if (!set) {
    set = new Set();
    listeners.set(eventName, set);
  }
  return set;
}

function dispatchToHandlers(eventName: string, payload: unknown): void {
  const set = listeners.get(eventName);
  if (!set) return;
  const event: Event = { payload, event: eventName };
  for (const handler of set) {
    try {
      handler(event);
    } catch (err) {
      console.error(`[WS-Events] Handler error for "${eventName}":`, err);
    }
  }
}

function handleMessage(raw: string): void {
  let msg: WSMessage;
  try {
    msg = JSON.parse(raw);
  } catch {
    console.warn('[WS-Events] Non-JSON message received:', raw);
    return;
  }

  const pythonName = msg.event;
  const data = msg.data;

  // Dispatch to listeners using the Python name directly
  dispatchToHandlers(pythonName, data);

  // Also dispatch using the mapped frontend name (if different)
  const frontendName = PYTHON_TO_FRONTEND[pythonName];
  if (frontendName && frontendName !== pythonName) {
    dispatchToHandlers(frontendName, data);
  }
}

function connect(): void {
  if (disposed) return;
  // Short-circuit if a socket is already OPEN *or* still CONNECTING.
  // Without the CONNECTING guard, every listen() call during startup
  // (App.tsx subscribeToLogs + useEventListeners, etc.) spawns ANOTHER
  // socket before the first reaches OPEN. Each extra socket registers as a
  // separate WS client on the backend, so every event is delivered N times
  // (the classic "logs appear 3x" bug).
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    ws = new WebSocket(WS_URL);
  } catch (err) {
    console.warn('[WS-Events] Failed to create WebSocket:', err);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    reconnectDelayMs = RECONNECT_BASE_MS;
    console.debug('[WS-Events] Connected');
  };

  ws.onmessage = (ev) => handleMessage(ev.data as string);

  ws.onclose = () => {
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose will fire after onerror; reconnect is handled there
  };
}

function scheduleReconnect(): void {
  if (disposed) return;
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, RECONNECT_MAX_MS);
    connect();
  }, reconnectDelayMs);
}

// Start connection eagerly (module load)
connect();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Listen for a named event. Returns a promise that resolves to an unlisten
 * function.
 *
 * @example
 * ```ts
 * const unlisten = await listen<MyPayload>('account-created', (event) => {
 *   console.log(event.payload);
 * });
 * // later:
 * unlisten();
 * ```
 */
export async function listen<T = unknown>(
  eventName: string,
  handler: EventHandler<T>,
): Promise<UnlistenFn> {
  const set = getOrCreateListenerSet(eventName);
  if (set.size >= MAX_LISTENERS_PER_EVENT) {
    console.warn(
      `[WS-Events] Listener limit reached for "${eventName}" — possible leak.`,
    );
  }
  set.add(handler as EventHandler);

  // Ensure connection is alive when a listener is added. connect() itself
  // guards against OPEN/CONNECTING, so this won't spawn duplicate sockets.
  connect();

  return () => {
    set.delete(handler as EventHandler);
    if (set.size === 0) {
      listeners.delete(eventName);
    }
  };
}

/**
 * Emit an event to the backend.
 *
 * For `SETTINGS_UPDATED` and `PROXY_CONFIG_UPDATED` this sends an HTTP
 * command so other frontend components can sync.  Pure backend events
 * are routed through the EventBus command.
 */
export async function emit<T = unknown>(eventName: string, payload?: T): Promise<void> {
  // Frontend-to-frontend events (settings sync) are dispatched locally
  // AND posted to backend so WS-connected tabs also see them.
  dispatchToHandlers(eventName, payload);

  // Forward to backend via HTTP command
  try {
    await safeInvoke('emit_event', { event: eventName, data: payload ?? {} });
  } catch {
    // Non-fatal: the local dispatch already happened
    console.warn(`[WS-Events] Failed to forward emit "${eventName}" to backend`);
  }
}

/**
 * Disconnect and stop reconnecting.  Call on app teardown.
 */
export function dispose(): void {
  disposed = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  ws?.close();
  ws = null;
  listeners.clear();
}
