import type { ModelInfo } from '../types/generated';
import { API_BASE_URL } from '../lib/backend/core/invoke';

type ChatRouteModel = Pick<ModelInfo, 'id' | 'provider' | 'ownedBy'>;

export function isZaiChatModel(model: ChatRouteModel | undefined): boolean {
  return model?.provider.toLowerCase() === 'zai' || model?.ownedBy.toLowerCase() === 'zai';
}

/**
 * Web-bridge (web2api) family: providers whose ids start with ``web-``
 * (web-gemini, web-deepseek, ...). Models may also arrive with the
 * ``web-<provider>/<model>`` id prefix when the provider field is absent.
 */
export function isWebBridgeChatModel(model: ChatRouteModel | undefined): boolean {
  return resolveWebBridgeProvider(model) !== undefined;
}

/** Resolve the concrete web-bridge provider id for a model, if any. */
export function resolveWebBridgeProvider(model: ChatRouteModel | undefined): string | undefined {
  const provider = (model?.provider ?? '').toLowerCase();
  if (provider.startsWith('web-')) return provider;
  const id = (model?.id ?? '').toLowerCase();
  if (id.startsWith('web-') && id.includes('/')) return id.split('/')[0];
  return undefined;
}

export function resolveChatCompletionsUrl(model: ChatRouteModel | undefined, proxyPort: number): string {
  if (
    isZaiChatModel(model) ||
    model?.provider.toLowerCase() === 'qoder' ||
    isWebBridgeChatModel(model)
  ) {
    return `${API_BASE_URL}/api/v1/chat/completions`;
  }

  return `http://127.0.0.1:${proxyPort}/v1/chat/completions`;
}
