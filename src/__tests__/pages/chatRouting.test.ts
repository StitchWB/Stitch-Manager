import { describe, expect, it } from '@jest/globals';
import {
  isWebBridgeChatModel,
  isZaiChatModel,
  resolveChatCompletionsUrl,
  resolveWebBridgeProvider,
} from '../../pages/chatRouting';

describe('chat routing', () => {
  it('routes Z.AI provider models to the FastAPI chat endpoint', () => {
    const model = {
      id: 'glm-4.5',
      provider: 'zai',
      ownedBy: 'zai',
      source: 'aiProxy',
    };

    expect(isZaiChatModel(model)).toBe(true);
    expect(resolveChatCompletionsUrl(model, 25583)).toBe('/api/v1/chat/completions');
  });

  it('routes Qoder models to the native Stitch endpoint', () => {
    const model = {
      id: 'qwen3-coder-plus',
      provider: 'qoder',
      ownedBy: 'qoder',
      source: 'aiProxy',
    };

    expect(resolveChatCompletionsUrl(model, 25584)).toBe('/api/v1/chat/completions');
  });

  it('routes web-gemini models to the FastAPI chat endpoint', () => {
    const model = {
      id: 'gemini-3.6-flash',
      provider: 'web-gemini',
      ownedBy: 'web-gemini',
      source: 'aiProxy',
    };

    expect(isWebBridgeChatModel(model)).toBe(true);
    expect(resolveWebBridgeProvider(model)).toBe('web-gemini');
    expect(resolveChatCompletionsUrl(model, 25584)).toBe('/api/v1/chat/completions');
  });

  it('routes web-deepseek models to the FastAPI chat endpoint', () => {
    const model = {
      id: 'deepseek-chat',
      provider: 'web-deepseek',
      ownedBy: 'web-deepseek',
      source: 'aiProxy',
    };

    expect(isWebBridgeChatModel(model)).toBe(true);
    expect(resolveWebBridgeProvider(model)).toBe('web-deepseek');
    expect(resolveChatCompletionsUrl(model, 25584)).toBe('/api/v1/chat/completions');
  });

  it('recognizes web-bridge models by id prefix', () => {
    const model = {
      id: 'web-gemini/gemini-3.6-flash',
      provider: 'unknown',
      ownedBy: 'unknown',
      source: 'aiProxy',
    };

    expect(isWebBridgeChatModel(model)).toBe(true);
    expect(resolveWebBridgeProvider(model)).toBe('web-gemini');
    expect(resolveChatCompletionsUrl(model, 25584)).toBe('/api/v1/chat/completions');
  });

  it('routes other models via the unified gateway', () => {
    const model = {
      id: 'gpt-4o-mini',
      provider: 'openai',
      ownedBy: 'openai',
      source: 'aiProxy',
    };

    expect(isZaiChatModel(model)).toBe(false);
    expect(resolveChatCompletionsUrl(model, 25584)).toBe(
      'http://127.0.0.1:25584/v1/chat/completions'
    );
  });
});
