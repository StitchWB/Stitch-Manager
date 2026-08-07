/**
 * Centralized backend URL resolution.
 *
 * Dev:  Vite dev server on :5174 proxies /api → http://127.0.0.1:25584
 *       (same-origin, no CORS preflight).
 * Prod: FastAPI serves the built dist/ on the same origin as the API
 *       (pywebview loads http://127.0.0.1:25584 — same-origin, no CORS).
 * file:// fallback: if the webview ever loads from file://, talk to the
 *       backend directly at http://localhost:25584.
 */

const FILE_PROTOCOL = 'file:';
const FALLBACK_API_BASE = 'http://localhost:25584';
const FALLBACK_WS_URL = 'ws://localhost:25584/api/events';

/**
 * Returns the API base URL for fetch calls.
 *
 * - http(s) origin (dev via Vite proxy, prod same-origin): '' (relative)
 * - file:// origin: 'http://localhost:25584'
 */
export function getApiBaseUrl(): string {
  if (typeof window === 'undefined') return FALLBACK_API_BASE;
  if (window.location.protocol === FILE_PROTOCOL) return FALLBACK_API_BASE;
  return '';
}

/**
 * Returns the WebSocket URL for the /api/events endpoint.
 *
 * - http(s) origin: ws(s)://${window.location.host}/api/events
 *   (dev goes through Vite proxy with ws:true; prod same-origin)
 * - file:// origin: ws://localhost:25584/api/events
 */
export function getWsUrl(): string {
  if (typeof window === 'undefined') return FALLBACK_WS_URL;
  const { protocol, host } = window.location;
  if (protocol === FILE_PROTOCOL) return FALLBACK_WS_URL;
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${host}/api/events`;
}
