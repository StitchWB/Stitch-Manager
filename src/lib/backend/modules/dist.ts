/**
 * Distribution admin module — activation codes proxy.
 *
 * Talks to the FastAPI backend's /api/dist/* proxy endpoints (which in
 * turn talk to the distribution server).  Uses `fetch` directly (not
 * `safeInvoke`) for the same reason as auth.ts: 4xx responses are
 * expected operational errors (404 unknown code, 409 already used) that
 * must surface to the caller with their status code intact, and must NOT
 * trigger the global session-expiry handler wired into `safeInvoke`.
 *
 * Cookies are HttpOnly and same-origin: the browser sends them
 * automatically on every request, so no token is stored in JS.
 */

import { getApiBaseUrl } from '../core/url';

// ── Types ───────────────────────────────────────────────────────────────────

export interface DistCodeInfo {
  id: number;
  code_hash_prefix: string;
  entitlements: string[];
  used: boolean;
  used_at: string | null;
  token_id: number | null;
  created_at: string;
  expires_at: string | null;
  revoked: boolean;
  tg_user_id: number | null;
  label: string | null;
}

export interface DistIssueParams {
  entitlements?: string[];
  count?: number;
  ttl_minutes?: number | null;
  label?: string | null;
}

export interface DistIssueResult {
  codes: string[];
  entitlements: string[];
}

export interface DistRevokeResult {
  code_id: number;
  revoked: boolean;
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
 * GET /api/dist/codes — list activation codes (admin only).
 * @param unusedOnly When true, the backend filters to unused codes only.
 * @throws {Error} with `status` property = 401/403 on auth/permission failure,
 *   502 on upstream/network errors, 503 when the distribution server is
 *   disabled or the admin key is not configured.
 */
export async function listDistCodes(unusedOnly?: boolean): Promise<DistCodeInfo[]> {
  const url = new URL(`${getApiBaseUrl()}/api/dist/codes`, window.location.origin);
  if (unusedOnly) url.searchParams.set('unused_only', 'true');

  const response = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });

  const data = (await parseJson(response)) as { codes?: DistCodeInfo[]; detail?: string } | null;

  if (!response.ok) {
    const detail = data && !Array.isArray(data) ? data.detail : undefined;
    throw makeError(detail ?? 'Failed to list codes', response.status, detail);
  }

  if (!data || !Array.isArray(data.codes)) return [];
  return data.codes;
}

/**
 * POST /api/dist/issue-code — issue new activation codes (admin only).
 * @throws {Error} with `status` property on failure.
 */
export async function issueDistCode(params: DistIssueParams): Promise<DistIssueResult> {
  const response = await fetch(`${getApiBaseUrl()}/api/dist/issue-code`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(params),
  });

  const data = (await parseJson(response)) as { codes?: string[]; entitlements?: string[]; detail?: string } | null;

  if (!response.ok) {
    const detail = data && !Array.isArray(data) ? data.detail : undefined;
    throw makeError(detail ?? 'Failed to issue code', response.status, detail);
  }

  if (!data?.codes) {
    throw makeError('Failed to issue code', response.status);
  }

  return {
    codes: data.codes,
    entitlements: data.entitlements ?? [],
  };
}

/**
 * POST /api/dist/revoke-code — revoke an activation code (admin only).
 * @throws {Error} with `status` property = 404 unknown code, 409 already used.
 */
export async function revokeDistCode(codeId: number): Promise<DistRevokeResult> {
  const response = await fetch(`${getApiBaseUrl()}/api/dist/revoke-code`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ code_id: codeId }),
  });

  const data = (await parseJson(response)) as { code_id?: number; revoked?: boolean; detail?: string } | null;

  if (!response.ok) {
    const detail = data && !Array.isArray(data) ? data.detail : undefined;
    throw makeError(detail ?? 'Failed to revoke code', response.status, detail);
  }

  return {
    code_id: data?.code_id ?? codeId,
    revoked: Boolean(data?.revoked),
  };
}
