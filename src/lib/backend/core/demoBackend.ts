/* eslint-disable i18next/no-literal-string -- Static demo showcase data. */

import type { Account, SettingsData } from '../../../types/generated';
import type { BackgroundManagerConfig } from '../modules/backgroundManager';

let enabled = false;

export function enableDemoBackend(): void {
  enabled = true;
}

export function disableDemoBackend(): void {
  enabled = false;
}

export function isDemoBackend(): boolean {
  return enabled;
}

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

interface DemoAccountSeed {
  provider: string;
  email: string;
  used: number;
  limit: number;
  status: string;
  useCount: number;
  loginCount: number;
  errorCount: number;
  successRate: number;
  lastError?: string;
  tags?: string;
}

const DEMO_ACCOUNT_SEEDS: readonly DemoAccountSeed[] = [
  { provider: 'kiro', email: 'kiro.fleet01@stitch.dev', used: 156, limit: 200, status: 'active', useCount: 214, loginCount: 198, errorCount: 2, successRate: 98.4, tags: 'core' },
  { provider: 'kiro', email: 'kiro.fleet02@stitch.dev', used: 52, limit: 80, status: 'active', useCount: 101, loginCount: 97, errorCount: 1, successRate: 97.1 },
  { provider: 'kiro', email: 'kiro.fleet03@stitch.dev', used: 12, limit: 100, status: 'active', useCount: 34, loginCount: 33, errorCount: 0, successRate: 100 },
  { provider: 'windsurf', email: 'ws.fleet01@stitch.dev', used: 320, limit: 500, status: 'active', useCount: 187, loginCount: 176, errorCount: 3, successRate: 96.2 },
  { provider: 'windsurf', email: 'ws.fleet02@stitch.dev', used: 91, limit: 100, status: 'active', useCount: 142, loginCount: 138, errorCount: 1, successRate: 98.6, tags: 'hot' },
  { provider: 'windsurf', email: 'ws.fleet03@stitch.dev', used: 8, limit: 50, status: 'expired', useCount: 58, loginCount: 54, errorCount: 4, successRate: 91.5, lastError: 'Token expired' },
  { provider: 'trae', email: 'trae.fleet01@stitch.dev', used: 24, limit: 200, status: 'active', useCount: 76, loginCount: 74, errorCount: 0, successRate: 100 },
  { provider: 'trae', email: 'trae.fleet02@stitch.dev', used: 178, limit: 200, status: 'active', useCount: 95, loginCount: 90, errorCount: 2, successRate: 95.7 },
  { provider: 'openai', email: 'oai.fleet01@stitch.dev', used: 456, limit: 500, status: 'active', useCount: 163, loginCount: 159, errorCount: 1, successRate: 98.8, tags: 'hot' },
  { provider: 'openai', email: 'oai.fleet02@stitch.dev', used: 121, limit: 350, status: 'active', useCount: 88, loginCount: 85, errorCount: 1, successRate: 97.7 },
  { provider: 'claude', email: 'claude.fleet01@stitch.dev', used: 74, limit: 200, status: 'active', useCount: 129, loginCount: 124, errorCount: 2, successRate: 96.9 },
  { provider: 'claude', email: 'claude.fleet02@stitch.dev', used: 171, limit: 200, status: 'limit_hit', useCount: 110, loginCount: 104, errorCount: 6, successRate: 92.3, lastError: 'Rate limit reached' },
];

function demoAccount(id: number, seed: DemoAccountSeed): Account {
  const createdAt = isoDaysFromNow(-(45 - id * 2));
  const lastUsedAt = isoHoursAgo(id * 3 + 1);
  return {
    id,
    provider: seed.provider,
    email: seed.email,
    token: `demo-token-${seed.provider}-${id}`,
    refreshToken: null,
    quota: { used: seed.used, limit: seed.limit },
    status: seed.status,
    expiresAt: seed.status === 'expired' ? isoDaysFromNow(-2) : isoDaysFromNow(45),
    lastUsedAt,
    createdAt,
    updatedAt: lastUsedAt,
    metadata: null,
    providerType: null,
    providerSubtype: null,
    providerMetadata: null,
    machineId: `demo-machine-${id}`,
    patchConfig: null,
    patchAppliedAt: null,
    registrationPassword: null,
    registrationDate: createdAt,
    registrationMethod: 'auto',
    registrationMetadata: null,
    browserProfilePath: null,
    cookies: null,
    sessionData: null,
    useCount: seed.useCount,
    lastError: seed.lastError ?? null,
    errorCount: seed.errorCount,
    successRate: seed.successRate,
    notes: null,
    tags: seed.tags ?? null,
    lastLoginAt: lastUsedAt,
    loginCount: seed.loginCount,
    accountRegion: null,
    proxyId: null,
  };
}

const DEMO_ACCOUNTS: Account[] = DEMO_ACCOUNT_SEEDS.map((seed, i) =>
  demoAccount(i + 1, seed)
);

const DEMO_SETTINGS: SettingsData = {
  theme: 'dark',
  minActiveKiro: 4,
  minActiveWindsurf: 4,
  minActiveTrae: 2,
  autoReplenishEnabled: true,
  autoRotateEnabled: true,
  uiScale: 1,
};

const DEMO_BG_CONFIG: BackgroundManagerConfig = {
  autoRegisterEnabled: true,
  registerIntervalMinutes: 30,
  minAccountsThreshold: 2,
  autoSwitchEnabled: true,
  switchOnZeroCredits: true,
  checkCreditsIntervalSeconds: 300,
  autoRefreshQuotaEnabled: true,
  refreshQuotaIntervalSeconds: 900,
  refreshQuotaMaxErrors: 3,
  rotationStrategy: 'least-used',
  providerPriority: ['kiro', 'windsurf', 'trae'],
  healthCheckEnabled: true,
  healthCheckIntervalSeconds: 600,
  healthCheckAutoDisable: true,
  healthCheckTestEndpoint: '/v1/models',
  healthCheckCooldownSeconds: 120,
  healthCheckExponentialBackoff: true,
  rateLimitEnabled: true,
  rateLimitReservePercent: 10,
  rateLimitPolicies: [],
};

const COMMAND_MAP: Record<string, unknown> = {
  list_accounts: DEMO_ACCOUNTS,
  get_accounts: DEMO_ACCOUNTS,
  get_settings: DEMO_SETTINGS,
  get_background_manager_config: DEMO_BG_CONFIG,
  get_dashboard_stats: {
    totalAccounts: 12,
    activeTokens: 10,
    quotaUsage: 52,
    quotaUsed: 1613,
    quotaLimit: 2580,
    accountsByProvider: { kiro: 3, windsurf: 3, trae: 2, openai: 2, claude: 2 },
  },
  get_proxy_status: {
    running: true,
    port: 8900,
    uptimeSeconds: 3600,
    mode: 'gateway',
    managedByApp: true,
    networkReachable: true,
  },
  get_proxy_settings: {
    appMode: 'gateway',
    proxyPort: 8900,
    autoStart: true,
    routingStrategy: 'round-robin',
    managementKey: 'demo',
  },
  get_scheduler_status: false,
  get_scheduled_tasks: [],
  get_scheduler_templates: [],
  get_task_executions: [],
  get_registration_jobs: [],
  get_registration_status: 'idle',
  get_logs: { logs: [], total: 0, hasMore: false },
  get_active_accounts: {},
  list_profiles_rust: [],
  get_browser_engines: { engines: [] },
  list_totp_keys: [],
  get_providers: { providers: [] },
  get_ai_proxy_accounts: [],
  get_enabled_models: [],
  get_provider_capabilities: [],
  get_provider_model_mappings: [],
  get_proxy_debug_logs: [],
  get_marketplace: { plugins: [] },
  list_service_plugins: [],
};

export function demoInvoke(command: string): Promise<unknown> {
  return Promise.resolve(COMMAND_MAP[command] ?? null);
}
