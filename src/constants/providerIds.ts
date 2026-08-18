/**
 * Provider ID registry — single source of truth for the TypeScript side.
 *
 * KEEP IN SYNC WITH: python/autoreg/providers/base.py  (ProviderId enum)
 *                    python/autoreg/providers/registry.py (ProviderMeta)
 *
 * Rules:
 *  - Every string literal here must match the Python ProviderId.value exactly.
 *  - Import `ProviderId` everywhere instead of using raw string literals.
 *  - `PROVIDER_META` is the single registry — don't duplicate metadata elsewhere.
 */

// ---------------------------------------------------------------------------
// Canonical string IDs  (mirrors Python ProviderId enum values)
// ---------------------------------------------------------------------------

export const ProviderId = {
  // IDE providers
  KIRO:          'kiro',
  KIRO_V2:       'kiro_v2',
  WINDSURF:      'windsurf',
  TRAE:          'trae',

  // Git / auth
  GITHUB:        'github',
  BITBUCKET:     'bitbucket',

  // Cloud
  AWS:           'aws',
  AWS_BUILDER_ID:'aws_builder_id',

  // AI / API
  OPENAI:        'openai',
  COPILOT:       'copilot',
  CLAUDE:        'claude',
  ANTHROPIC:     'anthropic',
  GEMINI:        'gemini',
  ANTIGRAVITY:   'antigravity',
  ZAI:           'zai',
  FIREWORKS:     'fireworks',
  QODER:         'qoder',
  V0_APP:        'v0_app',

  // Web-session (web2api) providers
  WEB_GEMINI:    'web-gemini',
  WEB_DEEPSEEK:  'web-deepseek',
  WEB_QWEN:      'web-qwen',
  WEB_NOTEBOOKLM: 'web-notebooklm',
} as const;

/** Union of all valid provider ID strings. */
export type ProviderId = (typeof ProviderId)[keyof typeof ProviderId];

/** Category groups. */
export type ProviderCategory = 'ide' | 'git' | 'cloud' | 'ai';

// ---------------------------------------------------------------------------
// Per-provider metadata
// ---------------------------------------------------------------------------

export interface ProviderMeta {
  id: ProviderId;
  displayName: string;
  category: ProviderCategory;
  /** True if there is a working browser autoreg flow. */
  hasAutoreg: boolean;
  /** True if this provider can be used in the AI proxy pool. */
  isAiProxy: boolean;
  /**
   * Additional DB `provider` values that map to this provider.
   * e.g. 'kiro_v2' is stored in DB as-is but belongs to the Kiro UI group.
   */
  aliases?: readonly ProviderId[];
}

export const PROVIDER_META: Record<ProviderId, ProviderMeta> = {
  // ── IDE ──────────────────────────────────────────────────────────────────
  [ProviderId.KIRO]: {
    id: ProviderId.KIRO,
    displayName: 'Kiro',
    category: 'ide',
    hasAutoreg: true,
    isAiProxy: true,
    aliases: [ProviderId.KIRO_V2],
  },
  [ProviderId.KIRO_V2]: {
    id: ProviderId.KIRO_V2,
    displayName: 'Kiro v2',
    category: 'ide',
    hasAutoreg: true,
    isAiProxy: true,
  },
  [ProviderId.WINDSURF]: {
    id: ProviderId.WINDSURF,
    displayName: 'Windsurf',
    category: 'ide',
    hasAutoreg: true,
    isAiProxy: true,
  },
  [ProviderId.TRAE]: {
    id: ProviderId.TRAE,
    displayName: 'Trae',
    category: 'ide',
    hasAutoreg: true,
    isAiProxy: false,
  },

  // ── Git / auth ────────────────────────────────────────────────────────────
  [ProviderId.GITHUB]: {
    id: ProviderId.GITHUB,
    displayName: 'GitHub',
    category: 'git',
    hasAutoreg: false,
    isAiProxy: false,
  },
  [ProviderId.BITBUCKET]: {
    id: ProviderId.BITBUCKET,
    displayName: 'Bitbucket',
    category: 'git',
    hasAutoreg: false,
    isAiProxy: false,
  },

  // ── Cloud ─────────────────────────────────────────────────────────────────
  [ProviderId.AWS]: {
    id: ProviderId.AWS,
    displayName: 'AWS',
    category: 'cloud',
    hasAutoreg: false,
    isAiProxy: false,
    aliases: [ProviderId.AWS_BUILDER_ID],
  },
  [ProviderId.AWS_BUILDER_ID]: {
    id: ProviderId.AWS_BUILDER_ID,
    displayName: 'AWS Builder ID',
    category: 'cloud',
    hasAutoreg: false,
    isAiProxy: false,
    aliases: [ProviderId.AWS],
  },

  // ── AI / API ──────────────────────────────────────────────────────────────
  [ProviderId.OPENAI]: {
    id: ProviderId.OPENAI,
    displayName: 'OpenAI',
    category: 'ai',
    hasAutoreg: false,
    isAiProxy: true,
  },
  [ProviderId.COPILOT]: {
    id: ProviderId.COPILOT,
    displayName: 'Copilot',
    category: 'ai',
    hasAutoreg: false,
    isAiProxy: true,
  },
  [ProviderId.CLAUDE]: {
    id: ProviderId.CLAUDE,
    displayName: 'Claude',
    category: 'ai',
    hasAutoreg: false,
    isAiProxy: true,
  },
  [ProviderId.ANTHROPIC]: {
    id: ProviderId.ANTHROPIC,
    displayName: 'Anthropic',
    category: 'ai',
    hasAutoreg: false,
    isAiProxy: true,
  },
  [ProviderId.GEMINI]: {
    id: ProviderId.GEMINI,
    displayName: 'Gemini',
    category: 'ai',
    hasAutoreg: false,
    isAiProxy: true,
  },
  [ProviderId.ANTIGRAVITY]: {
    id: ProviderId.ANTIGRAVITY,
    displayName: 'Antigravity',
    category: 'ai',
    hasAutoreg: false,
    isAiProxy: true,
  },
  [ProviderId.ZAI]: {
    id: ProviderId.ZAI,
    displayName: 'Z.AI',
    category: 'ai',
    hasAutoreg: false,
    isAiProxy: true,
  },
  [ProviderId.FIREWORKS]: {
    id: ProviderId.FIREWORKS,
    displayName: 'Fireworks',
    category: 'ai',
    hasAutoreg: true,
    isAiProxy: true,
  },
  [ProviderId.QODER]: {
    id: ProviderId.QODER,
    displayName: 'Qoder',
    category: 'ide',
    hasAutoreg: true,
    isAiProxy: false,
  },
  [ProviderId.V0_APP]: {
    id: ProviderId.V0_APP,
    displayName: 'v0.dev',
    category: 'ai',
    hasAutoreg: true,
    isAiProxy: false,
  },
  [ProviderId.WEB_GEMINI]: {
    id: ProviderId.WEB_GEMINI,
    displayName: 'Gemini Web',
    category: 'ai',
    hasAutoreg: false,
    isAiProxy: true,
  },
  [ProviderId.WEB_DEEPSEEK]: {
    id: ProviderId.WEB_DEEPSEEK,
    displayName: 'DeepSeek Web',
    category: 'ai',
    hasAutoreg: false,
    isAiProxy: true,
  },
  [ProviderId.WEB_QWEN]: {
    id: ProviderId.WEB_QWEN,
    displayName: 'Qwen Web',
    category: 'ai',
    hasAutoreg: false,
    isAiProxy: true,
  },
  [ProviderId.WEB_NOTEBOOKLM]: {
    id: ProviderId.WEB_NOTEBOOKLM,
    displayName: 'NotebookLM',
    category: 'ai',
    hasAutoreg: false,
    isAiProxy: false, // own surface, not the chat proxy hub
  },
};

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

/** All provider IDs as a readonly array. */
export const ALL_PROVIDER_IDS = Object.values(ProviderId) as ProviderId[];

/** Providers that have a working autoreg flow. */
export const AUTOREG_PROVIDERS = ALL_PROVIDER_IDS.filter(
  id => PROVIDER_META[id].hasAutoreg
);

/** Providers shown in the AI proxy pool UI. */
export const AI_PROXY_PROVIDERS = ALL_PROVIDER_IDS.filter(
  id => PROVIDER_META[id].isAiProxy
);

/** Providers grouped by category. */
export const PROVIDERS_BY_CATEGORY = Object.entries(PROVIDER_META).reduce(
  (acc, [, meta]) => {
    if (!acc[meta.category]) acc[meta.category] = [];
    acc[meta.category].push(meta.id);
    return acc;
  },
  {} as Record<ProviderCategory, ProviderId[]>
);

/**
 * Check if a string is a valid ProviderId at runtime.
 * Useful for validating data coming from the backend.
 */
export function isValidProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && value in PROVIDER_META;
}
