import type { ProviderProfile } from './contracts';

export const PROVIDER_PROFILES = [
  {
    key: 'stitch',
    label: 'AI Proxy (ProxyStitch)',
    description: 'Recommended provider profile for Stitch AI Proxy',
    defaultApiKey: 'proxystitch-local',
  },
  {
    key: 'freemodel-claude',
    label: 'FreeModel (Claude Bridge)',
    description: 'Claude models via FreeModel bridge on port 3456. Models: FM-claude-opus-4-8, FM-claude-opus-4-7, FM-claude-opus-4-6, FM-claude-sonnet-4-6, FM-claude-haiku-4-5-20251001',
    defaultApiKey: 'freemodel-local',
  },
  {
    key: 'freemodel-openai',
    label: 'FreeModel (OpenAI Direct)',
    description: 'OpenAI models directly via FreeModel endpoint',
    defaultApiKey: 'freemodel-local',
  },
] satisfies ProviderProfile[];

export const DEFAULT_PROVIDER_PROFILE_KEY = 'stitch';

export function getProviderProfile(key: string): ProviderProfile {
  return PROVIDER_PROFILES.find(profile => profile.key === key) ?? PROVIDER_PROFILES[0];
}
