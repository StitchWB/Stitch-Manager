import type { ModelInfo } from '../types/generated';
import { API_BASE_URL } from '../lib/backend/core/invoke';

type ChatRouteModel = Pick<ModelInfo, 'id' | 'provider' | 'ownedBy'>;

export function isZaiChatModel(model: ChatRouteModel | undefined): boolean {
  return model?.provider.toLowerCase() === 'zai' || model?.ownedBy.toLowerCase() === 'zai';
}

export function resolveChatCompletionsUrl(model: ChatRouteModel | undefined, proxyPort: number): string {
  if (isZaiChatModel(model) || model?.provider.toLowerCase() === 'qoder') {
    return `${API_BASE_URL}/api/v1/chat/completions`;
  }

  return `http://127.0.0.1:${proxyPort}/v1/chat/completions`;
}
