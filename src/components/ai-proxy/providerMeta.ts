import type { AiProxyProviderName } from '../../constants/providerRegistry';

export {
  AI_PROXY_PROVIDER_LIST,
  AI_PROXY_PROVIDER_FILTERS,
  AI_PROXY_PROVIDER_COLORS,
  type AiProxyProviderName,
} from '../../constants/providerRegistry';

export type AuthMechanism = 'api_key' | 'oauth' | 'web' | 'local';

export const PROVIDER_AUTH_MECHANISM: Record<AiProxyProviderName, AuthMechanism> = {
  openai: 'api_key',
  claude: 'oauth',
  anthropic: 'api_key',
  gemini: 'api_key',
  kiro: 'oauth',
  antigravity: 'oauth',
  fireworks: 'api_key',
  zai: 'api_key',
  freemodel: 'local',
  custom: 'api_key',
  'web-gemini': 'web',
  'web-deepseek': 'web',
  'web-qwen': 'web',
};
