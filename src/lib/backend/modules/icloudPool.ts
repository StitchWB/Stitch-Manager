/**
 * iCloud Hide My Email Pool — API module
 *
 * All calls go through safeInvoke → POST /api/<command>
 */

import { safeInvoke } from '../core';
import type { ICloudPoolEntry, ICloudPoolStats } from '@/types/generated';

// ── Stats ────────────────────────────────────────────────────────────────────

export async function getICloudPoolStats(): Promise<ICloudPoolStats> {
  return safeInvoke<ICloudPoolStats>('icloud_pool_get_stats', {});
}

// ── Fill pool ────────────────────────────────────────────────────────────────

export interface FillICloudPoolParams {
  count?: number;
  labelPrefix?: string;
}

export interface FillICloudPoolResult {
  created: number;
  entries: ICloudPoolEntry[];
}

export async function fillICloudPool(
  params: FillICloudPoolParams = {}
): Promise<FillICloudPoolResult> {
  return safeInvoke<FillICloudPoolResult>('icloud_pool_fill', params as Record<string, unknown>);
}

// ── Authenticate ──────────────────────────────────────────────────────────────

export interface AuthenticateICloudResult {
  status: 'ok' | '2fa_required';
  message?: string;
}

export async function authenticateICloud(
  verificationCode?: string
): Promise<AuthenticateICloudResult> {
  return safeInvoke<AuthenticateICloudResult>('icloud_pool_authenticate', {
    verificationCode: verificationCode ?? null,
  });
}

// ── Configure ─────────────────────────────────────────────────────────────────

export async function configureICloud(
  appleId: string,
  appPassword: string,
  cookieDirectory?: string
): Promise<{ ok: boolean; message: string }> {
  return safeInvoke('icloud_pool_configure', {
    appleId,
    appPassword,
    cookieDirectory: cookieDirectory ?? '',
  });
}
