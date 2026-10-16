/**
 * Public plugin catalog module.
 *
 * Talks to the raw same-origin ``/catalog`` proxy (the backend forwards it
 * verbatim to the distribution server's public listing — metadata only,
 * downloads stay gated). Uses `fetch` directly (not `safeInvoke`) for the
 * same reason as dist.ts: the endpoint is unauthenticated, so no session
 * semantics apply, and error payloads must surface with their status code
 * intact.
 */

import { getApiBaseUrl } from '../core/url';
import { detailToMessage } from '../../errorText';

// ── Types ───────────────────────────────────────────────────────────────────

/** Localized description from the plugin manifest (stitch.plugin/v2). */
export type CatalogI18nText = {
  ru?: string;
  en?: string;
};

/**
 * One entry of the public catalog feed. Community-approved submissions
 * carry the extra `source` pointer and `badges` fields; official entries
 * omit them.
 */
export interface CatalogEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  description_i18n: CatalogI18nText | null;
  category: string | null;
  status: string | null;
  /** Single emoji from the plugin manifest. */
  icon: string | null;
  features: Array<{ title: string | CatalogI18nText; status: string }> | null;
  changelog: Array<{ version: string; date: string; changes: Array<string | CatalogI18nText> }> | null;
  homepage: string | null;
  repository: string | null;
  /** Present only on community-approved entries. */
  source?: { type: string; url: string; sha256: string };
  badges?: string[];
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
 * GET /catalog — public plugin listing (no auth).
 * @throws {Error} with `status` property = 503 when the distribution server
 *   is disabled or unreachable; other statuses pass through from upstream.
 */
export async function getCatalog(): Promise<CatalogEntry[]> {
  const response = await fetch(`${getApiBaseUrl()}/catalog`, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });

  const data = (await parseJson(response)) as { plugins?: CatalogEntry[]; detail?: string } | null;

  if (!response.ok) {
    const detail = data && !Array.isArray(data) ? data.detail : undefined;
    throw makeError(detailToMessage(detail, 'Failed to load the catalog'), response.status, detail);
  }

  if (!data || !Array.isArray(data.plugins)) return [];
  return data.plugins;
}
