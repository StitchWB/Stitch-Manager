import type { MarketplaceCategory } from '@/lib/backend/modules/marketplace';

export const CATEGORY_ORDER: MarketplaceCategory[] = [
  'autoreg',
  'engine',
  'ide-integration',
  'ai-tools',
  'productivity',
  'security',
  'communication',
  'data',
];

export const CATEGORY_LABEL_KEYS: Record<MarketplaceCategory, string> = {
  autoreg: 'marketplace.categories.autoreg',
  engine: 'marketplace.categories.engine',
  'ide-integration': 'marketplace.categories.ideIntegration',
  'ai-tools': 'marketplace.categories.aiTools',
  productivity: 'marketplace.categories.productivity',
  security: 'marketplace.categories.security',
  communication: 'marketplace.categories.communication',
  data: 'marketplace.categories.data',
};
