import type { ProviderName } from '../types/ui';
import { PROVIDER_META, isValidProviderId, type ProviderMeta } from './providerIds';

export interface ProviderConfig {
  id: ProviderName;
  name: string;
  icon: string;
  color: string; // Tailwind classes for badges/buttons
  gradient: string; // Gradient classes for cards
  hexColor: string; // Hex color for charts
  disabled?: boolean; // Whether registration is disabled
  category?: 'ide' | 'cloud' | 'git' | 'ai'; // Provider category for unified UI
  /**
   * Web-session (web2api) provider: credentials are a browser cookie jar
   * (and optionally a token) instead of password/OAuth. Drives the
   * cookies field in AddAccountModal — components must NOT special-case
   * provider ids for this.
   */
  webSession?: boolean;
}

type ProviderUIDecoration = {
  icon: string;
  color: string;
  gradient: string;
  hexColor: string;
  disabled?: boolean;
  webSession?: boolean;
  // name/category only for providers missing from the Python registry (web-session adapters).
  name?: string;
  category?: ProviderConfig['category'];
};

const PROVIDER_UI = {
  kiro: {
    icon: 'K',
    color: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
    gradient: 'from-indigo-500/20 to-purple-500/20 text-indigo-400',
    hexColor: '#6366f1',
  },
  kiro_v2: {
    icon: 'K2',
    color: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
    gradient: 'from-violet-500/20 to-fuchsia-500/20 text-violet-400',
    hexColor: '#8b5cf6',
  },
  windsurf: {
    icon: 'W',
    color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
    gradient: 'from-cyan-500/20 to-blue-500/20 text-cyan-400',
    hexColor: '#8b5cf6',
  },
  trae: {
    icon: 'T',
    color: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    gradient: 'from-orange-500/20 to-amber-500/20 text-orange-400',
    hexColor: '#ec4899',
  },
  github: {
    icon: 'GH',
    color: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    gradient: 'from-gray-500/20 to-slate-500/20 text-gray-400',
    hexColor: '#64748b',
  },
  aws: {
    icon: 'AWS',
    color: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    gradient: 'from-orange-500/20 to-amber-500/20 text-orange-400',
    hexColor: '#f59e0b',
  },
  openai: {
    icon: 'AI',
    color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    gradient: 'from-emerald-500/20 to-teal-500/20 text-emerald-400',
    hexColor: '#10b981',
  },
  copilot: {
    icon: 'CP',
    color: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    gradient: 'from-gray-500/20 to-slate-500/20 text-gray-400',
    hexColor: '#6b7280',
    disabled: true,
  },
  fireworks: {
    icon: 'FW',
    color: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
    gradient: 'from-rose-500/20 to-orange-500/20 text-rose-400',
    hexColor: '#f43f5e',
  },
  qoder: {
    icon: 'Q',
    color: 'bg-teal-500/20 text-teal-400 border-teal-500/30',
    gradient: 'from-teal-500/20 to-cyan-500/20 text-teal-400',
    hexColor: '#14b8a6',
  },
  bitbucket: {
    icon: 'BB',
    color: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    gradient: 'from-blue-500/20 to-sky-500/20 text-blue-400',
    hexColor: '#2684ff',
  },
  v0_app: {
    icon: 'v0',
    color: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
    gradient: 'from-slate-500/20 to-zinc-500/20 text-slate-300',
    hexColor: '#94a3b8',
  },
  claude: {
    icon: 'C',
    color: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    gradient: 'from-amber-500/20 to-yellow-500/20 text-amber-400',
    hexColor: '#d97706',
  },
  gemini: {
    icon: 'G',
    color: 'bg-blue-600/20 text-blue-500 border-blue-600/30',
    gradient: 'from-blue-600/20 to-indigo-500/20 text-blue-500',
    hexColor: '#2563eb',
  },
  antigravity: {
    icon: 'AG',
    color: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    gradient: 'from-purple-500/20 to-pink-500/20 text-purple-400',
    hexColor: '#9333ea',
  },
  aws_builder_id: {
    icon: 'AWS',
    color: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    gradient: 'from-orange-500/20 to-amber-500/20 text-orange-400',
    hexColor: '#f59e0b',
  },
  'web-gemini': {
    icon: 'GW',
    color: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
    gradient: 'from-sky-500/20 to-blue-500/20 text-sky-400',
    hexColor: '#0ea5e9',
    webSession: true,
    name: 'Gemini Web',
    category: 'ai',
  },
  'web-deepseek': {
    icon: 'DS',
    color: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    gradient: 'from-blue-500/20 to-indigo-500/20 text-blue-400',
    hexColor: '#4d6bfe',
    webSession: true,
    name: 'DeepSeek Web',
    category: 'ai',
  },
  'web-qwen': {
    icon: 'QW',
    color: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
    gradient: 'from-indigo-500/20 to-purple-500/20 text-indigo-400',
    hexColor: '#6366f1',
    webSession: true,
    name: 'Qwen Web',
    category: 'ai',
  },
  'web-notebooklm': {
    icon: 'NL',
    color: 'bg-teal-500/20 text-teal-400 border-teal-500/30',
    gradient: 'from-teal-500/20 to-cyan-500/20 text-teal-400',
    hexColor: '#14b8a6',
    webSession: true,
    name: 'NotebookLM',
    category: 'ai',
  },
} satisfies Record<string, ProviderUIDecoration>;

export const PROVIDERS: ProviderConfig[] = (Object.keys(PROVIDER_UI) as (keyof typeof PROVIDER_UI)[]).map(id => {
  const ui: ProviderUIDecoration = PROVIDER_UI[id];
  const meta: ProviderMeta | undefined = isValidProviderId(id) ? PROVIDER_META[id] : undefined;
  return {
    id,
    name: meta?.displayName ?? ui.name ?? id,
    icon: ui.icon,
    color: ui.color,
    gradient: ui.gradient,
    hexColor: ui.hexColor,
    disabled: ui.disabled ?? false,
    category: meta?.category ?? ui.category,
    ...(ui.webSession ? { webSession: true } : {}),
  };
});

export const PROVIDER_ICONS: Record<ProviderName, string> = Object.fromEntries(
  PROVIDERS.map(p => [p.id, p.icon])
) as Record<ProviderName, string>;

export const PROVIDER_COLORS: Record<ProviderName, string> = Object.fromEntries(
  PROVIDERS.map(p => [p.id, p.color])
) as Record<ProviderName, string>;

export const PROVIDER_GRADIENTS: Record<ProviderName, string> = Object.fromEntries(
  PROVIDERS.map(p => [p.id, p.gradient])
) as Record<ProviderName, string>;

export const PROVIDER_HEX_COLORS: Record<ProviderName, string> = Object.fromEntries(
  PROVIDERS.map(p => [p.id, p.hexColor])
) as Record<ProviderName, string>;

export const SUPPORTED_PROVIDERS: ProviderName[] = PROVIDERS.map(p => p.id);

export function getProvider(id: ProviderName): ProviderConfig | undefined {
  return PROVIDERS.find(p => p.id === id);
}

export function getEnabledProviders(): ProviderConfig[] {
  return PROVIDERS.filter(p => !p.disabled);
}
