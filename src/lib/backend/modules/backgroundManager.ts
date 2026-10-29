import { safeInvoke } from '../core/invoke';

export interface RateLimitPolicy {
  provider: string;
  rpmLimit: number;
  rpmWindowSeconds: number;
  tpmLimit: number;
  tpmWindowSeconds: number;
}

export interface BackgroundManagerConfig {
  autoRegisterEnabled: boolean;
  registerIntervalMinutes: number;
  minAccountsThreshold: number;
  autoSwitchEnabled: boolean;
  switchOnZeroCredits: boolean;
  checkCreditsIntervalSeconds: number;
  autoRefreshQuotaEnabled: boolean;
  refreshQuotaIntervalSeconds: number;
  refreshQuotaMaxErrors: number;
  // Rotation strategy settings
  rotationStrategy: 'round-robin' | 'random' | 'least-used' | 'priority';
  providerPriority: string[]; // List of provider IDs in priority order
  // Health check settings
  healthCheckEnabled: boolean;
  healthCheckIntervalSeconds: number;
  healthCheckAutoDisable: boolean;
  healthCheckTestEndpoint: string;
  healthCheckCooldownSeconds: number;
  healthCheckExponentialBackoff: boolean;
  rateLimitEnabled: boolean;
  rateLimitReservePercent: number;
  rateLimitPolicies: RateLimitPolicy[];
}

export interface BackgroundManagerStatus {
  config: BackgroundManagerConfig;
  isRegistering: boolean;
  isSwitching: boolean;
  isRefreshingQuota: boolean;
  consecutiveErrors: number;
  lastRegisterCheck: string | null;
  lastSwitchCheck: string | null;
  lastQuotaRefreshCheck: string | null;
  quotaRefreshErrorCount: number;
  quotaTrackedAccounts: number;
}

export async function getBackgroundManagerConfig(): Promise<BackgroundManagerConfig> {
  return safeInvoke<BackgroundManagerConfig>('get_background_manager_config');
}

export async function updateBackgroundManagerConfig(
  config: BackgroundManagerConfig
): Promise<void> {
  return safeInvoke<void>('update_background_manager_config', { config });
}

export async function getBackgroundManagerStatus(): Promise<BackgroundManagerStatus> {
  return safeInvoke<BackgroundManagerStatus>('get_background_manager_status');
}
