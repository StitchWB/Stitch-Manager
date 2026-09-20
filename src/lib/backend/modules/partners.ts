/**
 * Partner channels module — admin CRUD + owner "my channel".
 *
 * Talks to the FastAPI backend's /api/partners endpoints (which proxy the
 * distribution server's /admin/partner-channels). Uses `fetch` directly
 * (not `safeInvoke`) for the same reason as dist.ts and auth.ts: 4xx
 * responses are expected operational errors (403 non-admin, 422 role cap
 * violation, 404 unknown channel) that must surface to the caller with
 * their status code intact, and must NOT trigger the global session-expiry
 * handler wired into `safeInvoke`.
 *
 * Cookies are HttpOnly and same-origin: the browser sends them
 * automatically on every request, so no token is stored in JS.
 */

import { getApiBaseUrl } from '../core/url';
import { detailToMessage } from '../../errorText';

// ── Types ───────────────────────────────────────────────────────────────────

export type PartnerChannelType = 'telegram' | 'discord' | 'github' | 'other';
export type PartnerBadge = 'friend' | 'partner' | 'official';

/**
 * Roles a partner owner may grant. The server hard-caps this set: 'admin'
 * (and 'elite') are NEVER accepted — channel create/update with 'admin' in
 * allowed_grant_roles returns 422.
 */
export type PartnerGrantRole = 'user' | 'vip' | 'premium';

export interface PartnerChannel {
  id: string;
  tg_chat_id: number | null;
  title: string;
  url: string;
  description: string | null;
  badge: PartnerBadge;
  type: PartnerChannelType;
  /** Owner bind: telegram id or @username, as stored/returned by the backend. */
  owner_telegram_id: string | null;
  allowed_grant_roles: PartnerGrantRole[];
  /** NULL = unlimited. */
  max_members: number | null;
  active: boolean;
  created_at?: string;
  /** Member count when the backend joins it in (admin list). */
  member_count?: number;
}

export interface PartnerChannelForm {
  title: string;
  url: string;
  description?: string | null;
  type: PartnerChannelType;
  badge: PartnerBadge;
  tg_chat_id?: number | null;
  owner_telegram_id?: string | null;
  allowed_grant_roles: PartnerGrantRole[];
  max_members?: number | null;
  active: boolean;
}

/** Channel subset returned by GET /api/partners/me. */
export interface MyPartnerChannel {
  id: string;
  tg_chat_id: number | null;
  title: string;
  url: string;
  badge: PartnerBadge;
  allowed_grant_roles: PartnerGrantRole[];
  max_members: number | null;
  active: boolean;
}

export interface MyPartnerInfo {
  channel: MyPartnerChannel | null;
  member_count: number;
  /** NULL = unlimited quota. */
  quota_left: number | null;
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

function extractDetail(data: unknown): string | undefined {
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as { detail?: string }).detail
    : undefined;
}

const BADGES: readonly PartnerBadge[] = ['friend', 'partner', 'official'];
const TYPES: readonly PartnerChannelType[] = ['telegram', 'discord', 'github', 'other'];
const GRANT_ROLES: readonly PartnerGrantRole[] = ['user', 'vip', 'premium'];

function normalizeChannel(raw: Record<string, unknown>): PartnerChannel {
  const badge = BADGES.includes(raw.badge as PartnerBadge)
    ? (raw.badge as PartnerBadge)
    : 'friend';
  const type = TYPES.includes(raw.type as PartnerChannelType)
    ? (raw.type as PartnerChannelType)
    : 'other';
  const roles = Array.isArray(raw.allowed_grant_roles)
    ? (raw.allowed_grant_roles as unknown[]).filter((r): r is PartnerGrantRole =>
        GRANT_ROLES.includes(r as PartnerGrantRole),
      )
    : [];
  const ownerRaw = raw.owner_telegram_id ?? raw.owner_tg_id ?? null;
  return {
    id: String(raw.id ?? ''),
    tg_chat_id: typeof raw.tg_chat_id === 'number' ? raw.tg_chat_id : null,
    title: String(raw.title ?? ''),
    url: String(raw.url ?? ''),
    description: typeof raw.description === 'string' ? raw.description : null,
    badge,
    type,
    owner_telegram_id:
      ownerRaw === null || ownerRaw === undefined ? null : String(ownerRaw),
    allowed_grant_roles: roles,
    max_members: typeof raw.max_members === 'number' ? raw.max_members : null,
    active: raw.active !== false,
    created_at: typeof raw.created_at === 'string' ? raw.created_at : undefined,
    member_count:
      typeof raw.member_count === 'number'
        ? raw.member_count
        : typeof raw.members_used === 'number'
          ? raw.members_used
          : undefined,
  };
}

/** Unwrap `{channels: [...]}` / `{items: [...]}` / bare-array list responses. */
function extractList(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === 'object') {
    const obj = data as { channels?: unknown; items?: unknown };
    if (Array.isArray(obj.channels)) return obj.channels as Record<string, unknown>[];
    if (Array.isArray(obj.items)) return obj.items as Record<string, unknown>[];
  }
  return [];
}

/** Unwrap `{channel: {...}}` / bare-object single-channel responses. */
function extractChannel(data: unknown): Record<string, unknown> | null {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as { channel?: unknown };
    if (obj.channel && typeof obj.channel === 'object') {
      return obj.channel as Record<string, unknown>;
    }
    return data as Record<string, unknown>;
  }
  return null;
}

/**
 * Map the UI form onto the server's request schema: the server binds the
 * owner by numeric Telegram id (``owner_tg_id``), used for the bot's
 * getChatMember liveness check — @usernames are not resolvable there.
 * @throws {Error} when owner is non-empty and non-numeric.
 */
function buildPayload(form: PartnerChannelForm): Record<string, unknown> {
  const { owner_telegram_id, ...rest } = form;
  let ownerTgId: number | null = null;
  const owner = (owner_telegram_id ?? '').trim().replace(/^@/, '');
  if (owner) {
    if (!/^\d+$/.test(owner)) {
      throw makeError('Owner must be a numeric Telegram id', 422);
    }
    ownerTgId = Number(owner);
  }
  return { ...rest, owner_tg_id: ownerTgId };
}

// ── Public API (admin) ───────────────────────────────────────────────────────

/**
 * GET /api/partners/channels — list partner channels (admin only).
 * @throws {Error} with `status` property = 401/403 on auth/permission failure,
 *   502/503 on upstream errors.
 */
export async function listPartnerChannels(): Promise<PartnerChannel[]> {
  const response = await fetch(`${getApiBaseUrl()}/api/partners/channels`, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });

  const data = await parseJson(response);

  if (!response.ok) {
    const detail = extractDetail(data);
    throw makeError(detailToMessage(detail, 'Failed to list partner channels'), response.status, detail);
  }

  return extractList(data).map(normalizeChannel);
}

/**
 * POST /api/partners/channels — create a partner channel (admin only).
 * @throws {Error} with `status` property = 422 when allowed_grant_roles
 *   contains 'admin' (server hard cap), 401/403 on auth/permission failure.
 */
export async function createPartnerChannel(form: PartnerChannelForm): Promise<PartnerChannel> {
  const response = await fetch(`${getApiBaseUrl()}/api/partners/channels`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(buildPayload(form)),
  });

  const data = await parseJson(response);

  if (!response.ok) {
    const detail = extractDetail(data);
    throw makeError(detailToMessage(detail, 'Failed to create partner channel'), response.status, detail);
  }

  const raw = extractChannel(data);
  if (!raw) throw makeError('Failed to create partner channel', response.status);
  return normalizeChannel(raw);
}

/**
 * PUT /api/partners/channels/{id} — update a partner channel (admin only).
 * @throws {Error} with `status` property = 404 unknown channel, 422 role cap
 *   violation, 401/403 on auth/permission failure.
 */
export async function updatePartnerChannel(
  id: string,
  form: PartnerChannelForm,
): Promise<PartnerChannel> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/partners/channels/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(buildPayload(form)),
    },
  );

  const data = await parseJson(response);

  if (!response.ok) {
    const detail = extractDetail(data);
    throw makeError(detailToMessage(detail, 'Failed to update partner channel'), response.status, detail);
  }

  const raw = extractChannel(data);
  if (!raw) throw makeError('Failed to update partner channel', response.status);
  return normalizeChannel(raw);
}

/**
 * DELETE /api/partners/channels/{id} — delete a partner channel (admin only).
 * @throws {Error} with `status` property = 404 unknown channel, 401/403 on
 *   auth/permission failure.
 */
export async function deletePartnerChannel(id: string): Promise<void> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/partners/channels/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    },
  );

  if (!response.ok) {
    const data = await parseJson(response);
    const detail = extractDetail(data);
    throw makeError(detailToMessage(detail, 'Failed to delete partner channel'), response.status, detail);
  }
}

// ── Public API (owner) ───────────────────────────────────────────────────────

/**
 * GET /api/partners/me — the channel owned by the current session's telegram
 * id, plus member count and quota left. Never throws: returns null when
 * unauthenticated, when the user owns no channel, or on network/backend
 * failure, so the Friends page degrades to the plain catalog.
 */
export async function getMyPartnerChannel(): Promise<MyPartnerInfo | null> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/partners/me`, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const data = (await parseJson(response)) as {
      channel?: Record<string, unknown> | null;
      member_count?: number;
      quota_left?: number | null;
    } | null;
    if (!data) return null;

    const rawChannel = extractChannel(data.channel ?? null);
    const full = rawChannel ? normalizeChannel(rawChannel) : null;
    const channel: MyPartnerChannel | null = full
      ? {
          id: full.id,
          tg_chat_id: full.tg_chat_id,
          title: full.title,
          url: full.url,
          badge: full.badge,
          allowed_grant_roles: full.allowed_grant_roles,
          max_members: full.max_members,
          active: full.active,
        }
      : null;

    return {
      channel,
      member_count: typeof data.member_count === 'number' ? data.member_count : 0,
      quota_left: typeof data.quota_left === 'number' ? data.quota_left : null,
    };
  } catch {
    return null;
  }
}
