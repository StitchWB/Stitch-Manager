import type { ProviderName } from '../types';

export const PROVIDER_ICONS: Record<ProviderName, string> = {
  kiro: 'K',
  windsurf: 'W',
  trae: 'T',
  copilot: 'CP',
};

export const PROVIDER_COLORS: Record<ProviderName, string> = {
  kiro: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  windsurf: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  trae: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  copilot: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

// Hex colors for charts
export const PROVIDER_HEX_COLORS: Record<ProviderName, string> = {
  kiro: '#8b5cf6',
  windsurf: '#06b6d4',
  trae: '#f97316',
  copilot: '#6b7280',
};

export const SUPPORTED_PROVIDERS: ProviderName[] = [
  'kiro', 'windsurf', 'trae', 'copilot'
];
