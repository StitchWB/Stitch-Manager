import type { ProviderProfile } from './contracts';

export const PROVIDER_PROFILES = [
  {
    key: 'stitch',
    label: 'AI Proxy (ProxyStitch)',
    description: 'Recommended provider profile for Stitch AI Proxy',
    defaultApiKey: 'proxystitch-local',
  },
] satisfies ProviderProfile[];

export const DEFAULT_PROVIDER_PROFILE_KEY = 'stitch';

export function getProviderProfile(key: string): ProviderProfile {
  return PROVIDER_PROFILES.find(profile => profile.key === key) ?? PROVIDER_PROFILES[0];
}
