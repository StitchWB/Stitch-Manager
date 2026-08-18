import { safeInvoke } from '../core/invoke';
import type { GeminiApiKey, OpenAIApiKey, AnthropicApiKey, AntigravityApiKey } from '../../../types/generated';

export type ZaiApiKey = {
  apiKey: string;
  baseUrl?: string | null;
  prefix?: string | null;
};

/**
 * Get Gemini API keys
 */
export async function getGeminiApiKeys(): Promise<GeminiApiKey[]> {
  return safeInvoke<GeminiApiKey[]>('get_gemini_api_keys');
}

/**
 * Set Gemini API keys
 */
export async function setGeminiApiKeys(keys: GeminiApiKey[]): Promise<void> {
  return safeInvoke<void>('set_gemini_api_keys', { keys });
}

/**
 * Get OpenAI API keys
 */
export async function getOpenAIApiKeys(): Promise<OpenAIApiKey[]> {
  return safeInvoke<OpenAIApiKey[]>('get_openai_api_keys');
}

/**
 * Set OpenAI API keys
 */
export async function setOpenAIApiKeys(keys: OpenAIApiKey[]): Promise<void> {
  return safeInvoke<void>('set_openai_api_keys', { keys });
}

/**
 * Get Anthropic API keys
 */
export async function getAnthropicApiKeys(): Promise<AnthropicApiKey[]> {
  return safeInvoke<AnthropicApiKey[]>('get_anthropic_api_keys');
}

/**
 * Set Anthropic API keys
 */
export async function setAnthropicApiKeys(keys: AnthropicApiKey[]): Promise<void> {
  return safeInvoke<void>('set_anthropic_api_keys', { keys });
}

/**
 * Get Antigravity API keys
 */
export async function getAntigravityApiKeys(): Promise<AntigravityApiKey[]> {
  return safeInvoke<AntigravityApiKey[]>('get_antigravity_api_keys');
}

/**
 * Set Antigravity API keys
 */
export async function setAntigravityApiKeys(keys: AntigravityApiKey[]): Promise<void> {
  return safeInvoke<void>('set_antigravity_api_keys', { keys });
}

/**
 * Get configured Z.AI / GLM API keys.
 */
export async function getZaiApiKeys(): Promise<ZaiApiKey[]> {
  return safeInvoke<ZaiApiKey[]>('get_zai_api_keys');
}

/**
 * Persist configured Z.AI / GLM API keys.
 */
export async function setZaiApiKeys(keys: ZaiApiKey[]): Promise<void> {
  return safeInvoke<void>('set_zai_api_keys', { keys });
}
