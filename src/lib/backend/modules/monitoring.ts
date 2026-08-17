/**
 * Monitoring module — Stitch services health snapshot.
 *
 * Talks to the FastAPI backend's /api/dist/monitoring proxy endpoint
 * (cookie-auth, admin-only). Uses `fetch` directly (not `safeInvoke`)
 * for the same reason as dist.ts: 4xx/5xx responses are expected
 * operational errors (403 non-admin, 502 upstream unreachable/rejected,
 * 503 disabled/not-configured) that must surface to the caller with their
 * status code intact, and must NOT trigger the global session-expiry
 * handler wired into `safeInvoke`.
 *
 * Cookies are HttpOnly and same-origin: the browser sends them
 * automatically on every request, so no token is stored in JS.
 */

import { getApiBaseUrl } from '../core/url';

// ── Types ───────────────────────────────────────────────────────────────────

export type ServiceStatus = 'up' | 'down' | 'unknown';
export type BotStatus = 'up' | 'stale' | 'unknown';

export interface ServerHealth {
  status: 'up';
  uptime_s: number;
  db_ok: boolean;
}

export interface ServiceHealth {
  status: ServiceStatus;
  latency_ms: number | null;
  last_check: string | null;
  detail: string | null;
}

export interface ExternalServiceHealth extends ServiceHealth {
  url: string;
}

export interface BotHealth {
  status: BotStatus;
  last_heartbeat: string | null;
  age_s: number | null;
  route: string | null;
  candidates: string[];
  polling_errors: number | null;
  uptime_s: number | null;
}

export interface ProxyHealth {
  url: string;
  status: ServiceStatus;
  latency_ms: number | null;
  last_check: string | null;
  detail: string | null;
}

export interface MonitoringSnapshot {
  generated_at: string;
  server: ServerHealth;
  web: ServiceHealth;
  external: ExternalServiceHealth;
  bot: BotHealth;
  proxies: ProxyHealth[];
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

function makeError(message: string, status: number, detail?: unknown): Error & { status: number } {
  const err = new Error(message) as Error & { status: number; detail?: unknown };
  err.status = status;
  if (detail !== undefined) err.detail = detail;
  return err;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * GET /api/dist/monitoring — Stitch services health snapshot (admin only).
 * @throws {Error} with `status` property = 401/403 on auth/permission failure,
 *   502 on upstream/network errors, 503 when monitoring is disabled or not
 *   configured.
 */
export async function getMonitoring(): Promise<MonitoringSnapshot> {
  const response = await fetch(`${getApiBaseUrl()}/api/dist/monitoring`, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });

  const data = (await parseJson(response)) as MonitoringSnapshot | { detail?: string } | null;

  if (!response.ok) {
    const detail = data && !Array.isArray(data) && 'detail' in data ? data.detail : undefined;
    throw makeError(detail ?? 'Failed to load monitoring snapshot', response.status, detail);
  }

  if (!data || !('server' in data)) {
    throw makeError('Failed to load monitoring snapshot', response.status);
  }

  return data;
}
