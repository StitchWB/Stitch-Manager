export type {
  ProviderKey,
  ProviderProfile,
  ManualEnvBuildInput,
  IdeProviderAdapter,
} from './contracts';
export { PROVIDER_PROFILES, DEFAULT_PROVIDER_PROFILE_KEY, getProviderProfile } from './profiles';
export { openAiLikeAdapter } from './adapters/openaiLike';
import { getProviderProfile } from './profiles';
import { openAiLikeAdapter } from './adapters/openaiLike';

export function buildManualEnvPayload(endpoint: string, providerKey: string, apiKey?: string): string {
  const profile = getProviderProfile(providerKey);
  const resolved = apiKey ? { ...profile, defaultApiKey: apiKey } : profile;
  return openAiLikeAdapter.getManualEnvPayload({ endpoint, provider: resolved });
}
