import { describe, expect, it } from '@jest/globals';
import {
  isWebBridgeChatModel,
  isZaiChatModel,
  resolveChatCompletionsUrl,
  resolveWebBridgeProvider,
  selectPreferredChatModel,
} from '../../pages/chatRouting';

describe('chat routing', () => {
  it.each(['anthropic/sonnet', 'deepseek/flash', 'moonshot/kimi', 'antigravity/argon'])(
    'uses native Messages for Velly model %s when advertised by the catalog', id => {
      const model = { id: `velly/${id}`, provider: 'velly', ownedBy: 'velly', protocol: 'messages' };
      expect(resolveChatCompletionsUrl(model, 25584)).toBe('/v1/messages');
    }
  );
  it('routes Velly models to the backend gateway independently of the legacy proxy port', () => {
    expect(resolveChatCompletionsUrl({
      id: 'velly/anthropic/claude-sonnet-5.5', provider: 'velly', ownedBy: 'velly',
    }, 25583)).toBe('/v1/chat/completions');
  });

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

  it('prefers a backend-routed model over an unavailable legacy-proxy default', () => {
    const models = [
      { id: 'gpt-4o-mini', provider: 'openai', ownedBy: 'openai' },
      { id: 'velly/anthropic/sonnet', provider: 'velly', ownedBy: 'velly' },
    ];

    expect(selectPreferredChatModel(models, false)).toBe('velly/anthropic/sonnet');
  });

  it('chooses a backend-routed model when the proxy is unavailable', () => {
    const models = [
      { id: 'gpt-4o-mini', provider: 'openai', ownedBy: 'openai' },
      { id: 'glm-4.5', provider: 'zai', ownedBy: 'zai' },
    ];

    expect(selectPreferredChatModel(models, false)).toBe('glm-4.5');
  });

  it('keeps legacy-proxy models eligible when the proxy is usable', () => {
    const models = [
      { id: 'gpt-4o-mini', provider: 'openai', ownedBy: 'openai' },
      { id: 'velly/anthropic/sonnet', provider: 'velly', ownedBy: 'velly' },
    ];

    expect(selectPreferredChatModel(models, true)).toBe('gpt-4o-mini');
  });

  it('returns no automatic selection when every model needs an unavailable legacy proxy', () => {
    const models = [{ id: 'gpt-4o-mini', provider: 'openai', ownedBy: 'openai' }];

    expect(selectPreferredChatModel(models, false)).toBeUndefined();
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
  it('routes rb/* roles to the embedded gateway and prefers them automatically', () => {
    const model = { id: 'rb/lead', provider: 'AI Gateway', ownedBy: 'gateway' };
    expect(resolveChatCompletionsUrl(model, 5580)).toBe('/v1/chat/completions');
    expect(selectPreferredChatModel([
      { id: 'gemini-3.7-flash', provider: 'google', ownedBy: 'google' },
      model,
    ], false)).toBe('rb/lead');
    expect(selectPreferredChatModel([model], false)).toBe('rb/lead');
  });

});
