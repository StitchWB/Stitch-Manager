import type { ModelInfo } from '../types/generated';
import { API_BASE_URL } from '../lib/tauri/core/invoke';

export const ZAI_CHAT_COMPLETIONS_URL = `${API_BASE_URL}/api/v1/chat/completions`;
export const NATIVE_CHAT_COMPLETIONS_URL = `${API_BASE_URL}/api/v1/chat/completions`;

type ChatRouteModel = Pick<ModelInfo, 'id' | 'provider' | 'ownedBy'>;

export function isZaiChatModel(model: ChatRouteModel | undefined): boolean {
  return model?.provider.toLowerCase() === 'zai' || model?.ownedBy.toLowerCase() === 'zai';
}

export function isNativeChatModel(model: ChatRouteModel | undefined): boolean {
  return isZaiChatModel(model) || model?.provider.toLowerCase() === 'qoder';
}

export function resolveChatCompletionsUrl(model: ChatRouteModel | undefined, proxyPort: number): string {
  if (isNativeChatModel(model)) {
    return NATIVE_CHAT_COMPLETIONS_URL;
  }

  return `http://127.0.0.1:${proxyPort}/v1/chat/completions`;
}
