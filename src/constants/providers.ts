import type { ProviderName } from '../types/ui';

// ============================================
// Unified Provider Configuration
// ============================================

export interface ProviderConfig {
  id: ProviderName;
  name: string;
  icon: string;
  color: string; // Tailwind classes for badges/buttons
  gradient: string; // Gradient classes for cards
  hexColor: string; // Hex color for charts
  disabled?: boolean; // Whether registration is disabled
  category?: 'ide' | 'cloud' | 'git' | 'ai'; // Provider category for unified UI
}

export const PROVIDERS: ProviderConfig[] = [
  {
    id: 'kiro',
    name: 'Kiro',
    icon: 'K',
    color: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
    gradient: 'from-indigo-500/20 to-purple-500/20 text-indigo-400',
    hexColor: '#6366f1',
    disabled: false,
    category: 'ide',
  },
  {
    id: 'kiro_v2',
    name: 'Kiro v2',
    icon: 'K2',
    color: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
    gradient: 'from-violet-500/20 to-fuchsia-500/20 text-violet-400',
    hexColor: '#8b5cf6',
    disabled: false,
    category: 'ide',
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    icon: 'W',
    color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
    gradient: 'from-cyan-500/20 to-blue-500/20 text-cyan-400',
    hexColor: '#8b5cf6',
    disabled: false,
    category: 'ide',
  },
  {
    id: 'trae',
    name: 'Trae',
    icon: 'T',
    color: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    gradient: 'from-orange-500/20 to-amber-500/20 text-orange-400',
    hexColor: '#ec4899',
    disabled: false,
    category: 'ide',
  },
  {
    id: 'github',
    name: 'GitHub',
    icon: 'GH',
    color: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    gradient: 'from-gray-500/20 to-slate-500/20 text-gray-400',
    hexColor: '#64748b',
    disabled: false,
    category: 'git',
  },
  {
    id: 'aws',
    name: 'AWS',
    icon: 'AWS',
    color: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    gradient: 'from-orange-500/20 to-amber-500/20 text-orange-400',
    hexColor: '#f59e0b',
    disabled: false,
    category: 'cloud',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    icon: 'AI',
    color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    gradient: 'from-emerald-500/20 to-teal-500/20 text-emerald-400',
    hexColor: '#10b981',
    disabled: false,
    category: 'ai',
  },
  {
    id: 'copilot',
    name: 'Copilot',
    icon: 'CP',
    color: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    gradient: 'from-gray-500/20 to-slate-500/20 text-gray-400',
    hexColor: '#6b7280',
    disabled: true,
    category: 'ai',
  },
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    icon: 'FW',
    color: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
    gradient: 'from-rose-500/20 to-orange-500/20 text-rose-400',
    hexColor: '#f43f5e',
    disabled: false,
    category: 'ai',
  },
  {
    id: 'bitbucket',
    name: 'Bitbucket',
    icon: 'BB',
    color: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    gradient: 'from-blue-500/20 to-sky-500/20 text-blue-400',
    hexColor: '#2684ff',
    disabled: false,
    category: 'git',
  },
] as const;

// ============================================
// Helper Maps (derived from PROVIDERS)
// ============================================

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

// ============================================
// Helper Functions
// ============================================

export function getProvider(id: ProviderName): ProviderConfig | undefined {
  return PROVIDERS.find(p => p.id === id);
}

export function getEnabledProviders(): ProviderConfig[] {
  return PROVIDERS.filter(p => !p.disabled);
}
