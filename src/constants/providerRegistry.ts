export type ProviderBadgeColors = {
  bg: string;
  text: string;
  border: string;
};

/**
 * Provider registry used across UI surfaces.
 *
 * Notes:
 * - `accounts.matchProviders` lists raw `Account.provider` values that should match this UI provider.
 * - `aiProxy` marks providers shown in AI Proxy UI.
 */
export type ProviderRegistryId =
  | 'kiro'
  | 'windsurf'
  | 'trae'
  | 'github'
  | 'aws'
  | 'openai'
  | 'claude'
  | 'gemini'
  | 'antigravity'
  | 'fireworks';

export type ProviderRegistryEntry = {
  id: ProviderRegistryId;
  label: string;
  badge: ProviderBadgeColors;
  accounts?: {
    matchProviders: readonly string[];
  };
  aiProxy?: {
    enabled: boolean;
  };
};

export const PROVIDER_REGISTRY: Record<ProviderRegistryId, ProviderRegistryEntry> = {
  // Accounts providers
  kiro: {
    id: 'kiro',
    label: 'Kiro',
    badge: {
      bg: 'bg-indigo-500/10',
      text: 'text-indigo-400',
      border: 'border-indigo-500/20',
    },
    accounts: { matchProviders: ['kiro', 'kiro_v2'] },
    aiProxy: { enabled: true },
  },
  windsurf: {
    id: 'windsurf',
    label: 'Windsurf',
    badge: {
      bg: 'bg-cyan-500/10',
      text: 'text-cyan-400',
      border: 'border-cyan-500/20',
    },
    accounts: { matchProviders: ['windsurf'] },
  },
  trae: {
    id: 'trae',
    label: 'Trae',
    badge: {
      bg: 'bg-orange-500/10',
      text: 'text-orange-400',
      border: 'border-orange-500/20',
    },
    accounts: { matchProviders: ['trae'] },
  },
  aws: {
    id: 'aws',
    label: 'AWS Builder ID',
    badge: {
      bg: 'bg-amber-500/10',
      text: 'text-amber-400',
      border: 'border-amber-500/20',
    },
    // Historically stored as aws_builder_id in Account.provider
    accounts: { matchProviders: ['aws_builder_id', 'aws'] },
  },
  github: {
    id: 'github',
    label: 'GitHub',
    badge: {
      bg: 'bg-slate-500/10',
      text: 'text-slate-400',
      border: 'border-slate-500/20',
    },
    accounts: { matchProviders: ['github'] },
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    badge: {
      bg: 'bg-emerald-500/10',
      text: 'text-emerald-400',
      border: 'border-emerald-500/20',
    },
    accounts: { matchProviders: ['openai'] },
    aiProxy: { enabled: true },
  },

  // AI Proxy-only providers
  claude: {
    id: 'claude',
    label: 'Claude',
    badge: {
      bg: 'bg-purple-500/10',
      text: 'text-purple-400',
      border: 'border-purple-500/20',
    },
    aiProxy: { enabled: true },
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    badge: {
      bg: 'bg-blue-500/10',
      text: 'text-blue-400',
      border: 'border-blue-500/20',
    },
    aiProxy: { enabled: true },
  },
  antigravity: {
    id: 'antigravity',
    label: 'Antigravity',
    badge: {
      bg: 'bg-pink-500/10',
      text: 'text-pink-400',
      border: 'border-pink-500/20',
    },
    aiProxy: { enabled: true },
  },
  fireworks: {
    id: 'fireworks',
    label: 'Fireworks',
    badge: {
      bg: 'bg-rose-500/10',
      text: 'text-rose-400',
      border: 'border-rose-500/20',
    },
    accounts: { matchProviders: ['fireworks'] },
    aiProxy: { enabled: true },
  },
};

// =============================
// Accounts filters
// =============================

export const ACCOUNT_PROVIDER_FILTER_IDS = [
  'kiro',
  'windsurf',
  'trae',
  'aws',
  'github',
  'openai',
] as const;

export type AccountProviderFilterId = (typeof ACCOUNT_PROVIDER_FILTER_IDS)[number];

export const ACCOUNT_PROVIDER_FILTERS: Array<{ id: AccountProviderFilterId; label: string }> =
  ACCOUNT_PROVIDER_FILTER_IDS.map(id => ({ id, label: PROVIDER_REGISTRY[id].label }));

export function normalizeAccountProviderFilter(value: string): 'all' | AccountProviderFilterId {
  if (value === 'aws_builder_id') return 'aws';
  if ((ACCOUNT_PROVIDER_FILTER_IDS as readonly string[]).includes(value)) {
    return value as AccountProviderFilterId;
  }
  return 'all';
}

export function getAccountProviderMatchProviders(
  provider: AccountProviderFilterId
): readonly string[] {
  return PROVIDER_REGISTRY[provider].accounts?.matchProviders ?? [provider];
}

// =============================
// AI Proxy provider meta
// =============================

export const AI_PROXY_PROVIDER_LIST = [
  'openai',
  'claude',
  'gemini',
  'kiro',
  'antigravity',
  'fireworks',
] as const;

export type AiProxyProviderName = (typeof AI_PROXY_PROVIDER_LIST)[number];

export const AI_PROXY_PROVIDER_FILTERS: Array<{ id: 'all' | AiProxyProviderName; label: string }> =
  [
    { id: 'all', label: 'All Providers' },
    ...AI_PROXY_PROVIDER_LIST.map(id => ({ id, label: PROVIDER_REGISTRY[id].label })),
  ];

export const AI_PROXY_PROVIDER_COLORS: Record<string, ProviderBadgeColors> = Object.fromEntries(
  AI_PROXY_PROVIDER_LIST.map(id => [id, PROVIDER_REGISTRY[id].badge])
) as Record<string, ProviderBadgeColors>;
