import { safeInvoke } from '../core/invoke';
import type { OpenAIApiKey } from '../../../types/generated';

export interface CustomProvider {
  id: string;
  name: string;
  base_url: string;
  litellm_model: string;
}

export async function getCustomProviders(): Promise<CustomProvider[]> {
  return safeInvoke<CustomProvider[]>('get_custom_providers');
}

export async function addCustomProvider(
  name: string,
  baseUrl: string,
  litellmModel: string = 'openai/*'
): Promise<{ success: boolean; provider?: CustomProvider; error?: string }> {
  return safeInvoke('add_custom_provider', { name, baseUrl, litellmModel });
}

export async function removeCustomProvider(id: string): Promise<{ success: boolean }> {
  return safeInvoke('remove_custom_provider', { id });
}

export async function getCustomProviderKeys(providerId: string): Promise<OpenAIApiKey[]> {
  return safeInvoke<OpenAIApiKey[]>('get_custom_provider_keys', { providerId });
}

export async function setCustomProviderKeys(
  providerId: string,
  keys: OpenAIApiKey[]
): Promise<void> {
  return safeInvoke<void>('set_custom_provider_keys', { providerId, keys });
}