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

export function buildManualEnvPayload(endpoint: string, providerKey: string): string {
  const profile = getProviderProfile(providerKey);
  return openAiLikeAdapter.getManualEnvPayload({ endpoint, provider: profile });
}
