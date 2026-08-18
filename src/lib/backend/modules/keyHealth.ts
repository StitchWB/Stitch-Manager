import { safeInvoke } from '../core/invoke';

export type KeyHealthStatus = 'healthy' | 'flaky' | 'broken' | 'expired' | 'unknown';

export interface KeyHealthRecord {
  id: number;
  providerId: string;
  keyHash: string;
  status: KeyHealthStatus;
  lastCheckedAt: string | null;
  lastTestedAt: string | null;
  successRate: number;
  avgLatency: number | null;
  totalRequests: number;
  totalErrors: number;
  modelsAvailable: string[] | null;
  cooldownUntil: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface KeyHealthResponse {
  records: KeyHealthRecord[];
}

export interface KeyModelsResponse {
  key_hash: string;
  models: string[];
}

export interface HealthSettings {
  enabled: boolean;
  interval_seconds: number;
}

export interface TestProviderKeysResult {
  tested: number;
  healthy: number;
  flaky: number;
  broken: number;
  expired: number;
  details: KeyHealthRecord[];
}

export async function getKeyHealth(provider?: string): Promise<KeyHealthResponse> {
  const result = await safeInvoke<KeyHealthRecord[]>('get_key_health', provider ? { providerId: provider } : {});
  // Backend returns array directly, wrap in response object
  return { records: Array.isArray(result) ? result : [] };
}

export async function testProviderKeys(provider: string): Promise<TestProviderKeysResult> {
  return safeInvoke<TestProviderKeysResult>('test_provider_keys', { providerId: provider });
}

export async function getKeyModels(keyHash: string): Promise<KeyModelsResponse> {
  return safeInvoke<KeyModelsResponse>('get_key_models', { key_hash: keyHash });
}

export async function updateKeyHealthSettings(settings: HealthSettings): Promise<{ success: boolean }> {
  return safeInvoke<{ success: boolean }>('update_key_health_settings', {
    enabled: settings.enabled,
    interval_seconds: settings.interval_seconds,
  });
}