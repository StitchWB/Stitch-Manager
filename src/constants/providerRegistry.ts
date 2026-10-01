import { PROVIDER_META, isValidProviderId, type ProviderMeta } from './providerIds';

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
  | 'anthropic'
  | 'gemini'
  | 'antigravity'
  | 'fireworks'
  | 'zai'
  | 'freemodel'
  | 'custom'
  | 'qoder'
  | 'v0_app'
  | 'web-gemini'
  | 'web-deepseek'
  | 'web-qwen'
  | 'web-notebooklm';

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

type ProviderUIEntry = {
  badge: ProviderBadgeColors;
  matchProviders?: readonly string[];
  // label/aiProxy only for ids missing from the Python registry (freemodel/custom/web-*).
  label?: string;
  aiProxy?: boolean;
};

const PROVIDER_UI: Record<ProviderRegistryId, ProviderUIEntry> = {
  kiro: {
    badge: {
      bg: 'bg-indigo-500/10',
      text: 'text-indigo-400',
      border: 'border-indigo-500/20',
    },
    matchProviders: ['kiro', 'kiro_v2'],
  },
  windsurf: {
    badge: {
      bg: 'bg-cyan-500/10',
      text: 'text-cyan-400',
      border: 'border-cyan-500/20',
    },
    matchProviders: ['windsurf'],
  },
  trae: {
    badge: {
      bg: 'bg-orange-500/10',
      text: 'text-orange-400',
      border: 'border-orange-500/20',
    },
    matchProviders: ['trae'],
  },
  aws: {
    badge: {
      bg: 'bg-amber-500/10',
      text: 'text-amber-400',
      border: 'border-amber-500/20',
    },
    // Historically stored as aws_builder_id in Account.provider
    matchProviders: ['aws_builder_id', 'aws'],
  },
  github: {
    badge: {
      bg: 'bg-slate-500/10',
      text: 'text-slate-400',
      border: 'border-slate-500/20',
    },
    matchProviders: ['github'],
  },
  openai: {
    badge: {
      bg: 'bg-emerald-500/10',
      text: 'text-emerald-400',
      border: 'border-emerald-500/20',
    },
    matchProviders: ['openai'],
  },
  claude: {
    badge: {
      bg: 'bg-purple-500/10',
      text: 'text-purple-400',
      border: 'border-purple-500/20',
    },
  },
  anthropic: {
    badge: {
      bg: 'bg-violet-500/10',
      text: 'text-violet-400',
      border: 'border-violet-500/20',
    },
  },
  gemini: {
    badge: {
      bg: 'bg-blue-500/10',
      text: 'text-blue-400',
      border: 'border-blue-500/20',
    },
  },
  antigravity: {
    badge: {
      bg: 'bg-pink-500/10',
      text: 'text-pink-400',
      border: 'border-pink-500/20',
    },
  },
  fireworks: {
    badge: {
      bg: 'bg-rose-500/10',
      text: 'text-rose-400',
      border: 'border-rose-500/20',
    },
    matchProviders: ['fireworks'],
  },
  zai: {
    badge: {
      bg: 'bg-cyan-500/10',
      text: 'text-cyan-400',
      border: 'border-cyan-500/20',
    },
    matchProviders: ['zai'],
  },
  freemodel: {
    badge: {
      bg: 'bg-emerald-500/10',
      text: 'text-emerald-400',
      border: 'border-emerald-500/20',
    },
    label: 'FreeModel',
    aiProxy: true,
  },
  custom: {
    badge: {
      bg: 'bg-slate-500/10',
      text: 'text-slate-400',
      border: 'border-slate-500/20',
    },
    label: 'Custom',
    aiProxy: true,
  },
  qoder: {
    badge: {
      bg: 'bg-teal-500/10',
      text: 'text-teal-400',
      border: 'border-teal-500/20',
    },
    matchProviders: ['qoder'],
  },
  v0_app: {
    badge: {
      bg: 'bg-slate-500/10',
      text: 'text-slate-300',
      border: 'border-slate-500/20',
    },
    matchProviders: ['v0_app'],
  },
  'web-gemini': {
    badge: {
      bg: 'bg-sky-500/10',
      text: 'text-sky-400',
      border: 'border-sky-500/20',
    },
    matchProviders: ['web-gemini'],
    label: 'Gemini Web',
    aiProxy: true,
  },
  'web-deepseek': {
    badge: {
      bg: 'bg-blue-500/10',
      text: 'text-blue-400',
      border: 'border-blue-500/20',
    },
    matchProviders: ['web-deepseek'],
    label: 'DeepSeek Web',
    aiProxy: true,
  },
  'web-qwen': {
    badge: {
      bg: 'bg-indigo-500/10',
      text: 'text-indigo-400',
      border: 'border-indigo-500/20',
    },
    matchProviders: ['web-qwen'],
    label: 'Qwen Web',
    aiProxy: true,
  },
  'web-notebooklm': {
    badge: {
      bg: 'bg-teal-500/10',
      text: 'text-teal-400',
      border: 'border-teal-500/20',
    },
    matchProviders: ['web-notebooklm'],
    label: 'NotebookLM',
  },
};

function buildEntry(id: ProviderRegistryId): ProviderRegistryEntry {
  const ui = PROVIDER_UI[id];
  const meta: ProviderMeta | undefined = isValidProviderId(id) ? PROVIDER_META[id] : undefined;
  const aiProxy = meta ? meta.isAiProxy : (ui.aiProxy ?? false);
  return {
    id,
    label: meta?.displayName ?? ui.label ?? id,
    badge: ui.badge,
    ...(ui.matchProviders ? { accounts: { matchProviders: ui.matchProviders } } : {}),
    ...(aiProxy ? { aiProxy: { enabled: true } } : {}),
  };
}

export const PROVIDER_REGISTRY = Object.fromEntries(
  (Object.keys(PROVIDER_UI) as ProviderRegistryId[]).map(id => [id, buildEntry(id)])
) as Record<ProviderRegistryId, ProviderRegistryEntry>;

export const ACCOUNT_PROVIDER_FILTER_IDS = [
  'kiro',
  'windsurf',
  'trae',
  'aws',
  'github',
  'openai',
  'qoder',
  'v0_app',
  'web-gemini',
  'web-deepseek',
  'web-qwen',
  'web-notebooklm',
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
  return PROVIDER_REGISTRY[provider]?.accounts?.matchProviders ?? [provider];
}

export const AI_PROXY_PROVIDER_LIST = [
  'openai',
  'claude',
  'anthropic',
  'gemini',
  'kiro',
  'antigravity',
  'fireworks',
  'zai',
  'freemodel',
  'custom',
  'web-gemini',
  'web-deepseek',
  'web-qwen',
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
