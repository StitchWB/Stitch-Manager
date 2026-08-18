/**
 * Found Keys Module
 *
 * Typed wrappers for the backend commands proxying AiApiRadar's
 * admin-gated found-keys endpoints:
 * - get_found_keys       → masked list (shared radar endpoint)
 * - get_found_key_secret → one decrypted key (VDS-only radar endpoint)
 *
 * Secrets are never persisted client-side: the copy flow fetches the key
 * and writes it straight to the clipboard.
 */

import { safeInvoke } from '../core';

export interface FoundKey {
  id: number;
  rule_id: string;
  provider: string;
  tier: string;
  key_hash: string;
  key_masked: string;
  status: string;
  verify_status: string | null;
  /** Never contains key material (see radar keyverify.classify). */
  verify_detail?: string | null;
  verified_at: string | null;
  author?: string | null;
  meta?: string | null;
  source_platform: string | null;
  source_url: string | null;
  repo: string | null;
  file_path: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

export interface FoundKeysResponse {
  count: number;
  items: FoundKey[];
}

export interface GetFoundKeysParams {
  provider?: string;
  tier?: string;
  status?: string;
  platform?: string;
  /** verify_status filter, e.g. "live" for probe-confirmed keys */
  verify?: string;
  limit?: number;
  offset?: number;
}

/**
 * Fetch the masked found-keys list from AiApiRadar.
 */
export async function getFoundKeys(params?: GetFoundKeysParams): Promise<FoundKeysResponse> {
  return safeInvoke<FoundKeysResponse>('get_found_keys', { ...params });
}

/**
 * Fetch one decrypted key (copied to clipboard by the caller, never stored).
 * noCache: the plaintext must not sit in the renderer response cache.
 */
export async function getFoundKeySecret(id: number): Promise<{ id: number; key: string }> {
  return safeInvoke<{ id: number; key: string }>(
    'get_found_key_secret', { id }, { noCache: true },
  );
}
