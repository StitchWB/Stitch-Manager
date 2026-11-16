import type {
  Credential,
  CredentialModelAccess,
  ProviderEndpoint,
  UpstreamModel,
} from '@/lib/backend/modules/aiGateway';

export interface CredStatusMeta {
  labelKey: string;
  dotClass: string;
  textClass: string;
}

const CRED_PROBLEM = new Set(['auth_failed', 'rate_limited', 'quota_exhausted', 'degraded']);

const CRED_STATUS_META: Record<string, CredStatusMeta> = {
  active: {
    labelKey: 'aiHub.credStatus.active',
    dotClass: 'bg-emerald-400',
    textClass: 'text-emerald-300',
  },
  unknown: {
    labelKey: 'aiHub.credStatus.unknown',
    dotClass: 'bg-slate-500',
    textClass: 'text-slate-400',
  },
  cooldown: {
    labelKey: 'aiHub.credStatus.cooldown',
    dotClass: 'bg-amber-400',
    textClass: 'text-amber-300',
  },
  rate_limited: {
    labelKey: 'aiHub.credStatus.rate_limited',
    dotClass: 'bg-amber-400',
    textClass: 'text-amber-300',
  },
  quota_exhausted: {
    labelKey: 'aiHub.credStatus.quota_exhausted',
    dotClass: 'bg-orange-400',
    textClass: 'text-orange-300',
  },
  auth_failed: {
    labelKey: 'aiHub.credStatus.auth_failed',
    dotClass: 'bg-red-400',
    textClass: 'text-red-300',
  },
  degraded: {
    labelKey: 'aiHub.credStatus.degraded',
    dotClass: 'bg-yellow-400',
    textClass: 'text-yellow-300',
  },
  disabled: {
    labelKey: 'aiHub.credStatus.disabled',
    dotClass: 'bg-slate-600',
    textClass: 'text-slate-500',
  },
};

export function credStatusMeta(status: string): CredStatusMeta {
  return CRED_STATUS_META[status] ?? CRED_STATUS_META.unknown;
}

export function isProblemStatus(status: string): boolean {
  return CRED_PROBLEM.has(status);
}

export function formatRemainingUsd(value: number | null | undefined): string | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return `$${value.toFixed(2)}`;
}

export function formatRemainingFreshness(
  checkedAt: string | null | undefined,
  nowMs: number = Date.now(),
  minutesLabel: string = 'мин'
): string | null {
  if (!checkedAt) return null;
  const date = new Date(checkedAt);
  const time = date.getTime();
  if (Number.isNaN(time)) return null;
  const diffMinutes = Math.max(0, Math.floor((nowMs - time) / 60000));
  if (diffMinutes >= 60) return `60+ ${minutesLabel}`;
  return `${diffMinutes} ${minutesLabel}`;
}

export function formatResetTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function isFutureReset(iso: string | null | undefined, nowMs: number = Date.now()): boolean {
  if (!iso) return false;
  const date = new Date(iso);
  const time = date.getTime();
  return !Number.isNaN(time) && time > nowMs;
}

export type ProviderHealth = 'healthy' | 'degraded' | 'broken' | 'off';

export const HEALTH_META: Record<ProviderHealth, { dotClass: string; labelKey: string }> = {
  healthy: { dotClass: 'bg-emerald-400', labelKey: 'aiHub.providersPage.health.healthy' },
  degraded: { dotClass: 'bg-amber-400', labelKey: 'aiHub.providersPage.health.degraded' },
  broken: { dotClass: 'bg-red-400', labelKey: 'aiHub.providersPage.health.broken' },
  off: { dotClass: 'bg-slate-600', labelKey: 'aiHub.providersPage.health.off' },
};

const CRED_HEALTH: Record<string, ProviderHealth> = {
  active: 'healthy',
  unknown: 'degraded',
  cooldown: 'degraded',
  rate_limited: 'degraded',
  quota_exhausted: 'degraded',
  degraded: 'degraded',
  auth_failed: 'broken',
  disabled: 'off',
};

const MODEL_ACCESS_HEALTH: Record<string, ProviderHealth> = {
  available: 'healthy',
  unknown: 'degraded',
  temporarily_unavailable: 'degraded',
  denied: 'broken',
};

function aggregateHealth(levels: ProviderHealth[]): ProviderHealth {
  if (levels.length === 0) return 'off';
  const broken = levels.filter(level => level === 'broken').length;
  const healthy = levels.filter(level => level === 'healthy').length;
  if (broken === levels.length) return 'broken';
  if (broken > 0 || healthy < levels.length) return 'degraded';
  return 'healthy';
}

export function deriveProviderHealth(
  credentials: Credential[],
  endpoint?: Pick<ProviderEndpoint, 'circuitState'> | null,
  modelAccess?: CredentialModelAccess[]
): ProviderHealth {
  if (endpoint?.circuitState === 'open') return 'broken';

  const enabled = credentials.filter(credential => credential.enabled);
  if (credentials.length === 0 || enabled.length === 0) return 'off';

  const levels = enabled.map(credential => CRED_HEALTH[credential.runtimeStatus] ?? 'degraded');
  if (modelAccess && modelAccess.length > 0) {
    levels.push(...modelAccess.map(access => MODEL_ACCESS_HEALTH[access.status] ?? 'degraded'));
  }

  const health = aggregateHealth(levels);
  if (health === 'healthy' && endpoint?.circuitState === 'half_open') return 'degraded';
  return health;
}

const LOGO_ALIASES: Array<[string, string]> = [
  ['openai', 'openai'],
  ['anthropic', 'claude'],
  ['claude', 'claude'],
  ['gemini', 'gemini'],
  ['google', 'gemini'],
  ['vertex', 'vertex'],
  ['kiro', 'kiro'],
  ['qwen', 'qwen'],
  ['glm', 'glm'],
  ['z.ai', 'glm'],
  ['zai', 'glm'],
  ['fireworks', 'fireworks'],
  ['trae', 'trae'],
  ['antigravity', 'antigravity'],
  ['copilot', 'copilot'],
  ['cursor', 'cursor'],
  ['warp', 'warp'],
  ['iflow', 'iflow'],
  ['bitbucket', 'bitbucket'],
];

export function logoKeyFor(endpoint: ProviderEndpoint): string {
  const name = endpoint.name.toLowerCase();
  for (const [needle, logo] of LOGO_ALIASES) {
    if (name.includes(needle)) return logo;
  }
  if (endpoint.adapterType === 'anthropic') return 'claude';
  if (endpoint.adapterType === 'gemini') return 'gemini';
  return 'cloud';
}

export interface ProviderRosterItem {
  endpoint: ProviderEndpoint;
  credentialCount: number;
  activeCount: number;
  problemCount: number;
  modelCount: number;
  health: ProviderHealth;
  logoKey: string;
}

export function buildRosterItem(
  endpoint: ProviderEndpoint,
  credentials: Credential[],
  models: UpstreamModel[]
): ProviderRosterItem {
  const forEndpoint = credentials.filter(credential => credential.providerEndpointId === endpoint.id);
  return {
    endpoint,
    credentialCount: forEndpoint.length,
    activeCount: forEndpoint.filter(
      credential => credential.enabled && credential.runtimeStatus === 'active'
    ).length,
    problemCount: forEndpoint.filter(
      credential => credential.enabled && isProblemStatus(credential.runtimeStatus)
    ).length,
    modelCount: models.filter(model => model.providerEndpointId === endpoint.id).length,
    health: deriveProviderHealth(forEndpoint, endpoint),
    logoKey: logoKeyFor(endpoint),
  };
}

export function credentialsForEndpoint(credentials: Credential[], endpointId: string): Credential[] {
  return credentials.filter(credential => credential.providerEndpointId === endpointId);
}

export function modelsForEndpoint(models: UpstreamModel[], endpointId: string): UpstreamModel[] {
  return models.filter(model => model.providerEndpointId === endpointId);
}