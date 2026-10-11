import { AI_PROXY_PROVIDER_LIST } from '@/constants/providerRegistry';

const PREFIX_RULES: ReadonlyArray<{ prefix: string; provider: (typeof AI_PROXY_PROVIDER_LIST)[number] }> = [
  { prefix: 'sk-ant-', provider: 'anthropic' },
  { prefix: 'sk-proj-', provider: 'openai' },
  { prefix: 'sk-', provider: 'openai' },
  { prefix: 'AIza', provider: 'gemini' },
  { prefix: 'fw_', provider: 'fireworks' },
];

export function detectProvider(key: string): string | null {
  const trimmed = key.trim();
  if (!trimmed) return null;
  for (const rule of PREFIX_RULES) {
    if (trimmed.startsWith(rule.prefix)) return rule.provider;
  }
  return null;
}

const PROVIDER_DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com',
  fireworks: 'https://api.fireworks.ai/inference/v1',
  zai: 'https://api.z.ai/api/paas/v4',
};

export function defaultBaseUrlFor(provider: string): string {
  return PROVIDER_DEFAULT_BASE_URLS[provider] ?? '';
}
