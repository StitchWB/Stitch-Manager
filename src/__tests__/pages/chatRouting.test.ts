import { describe, expect, it } from '@jest/globals';
import { isZaiChatModel, resolveChatCompletionsUrl } from '../../pages/chatRouting';

describe('chat routing', () => {
  it('routes Z.AI provider models to the FastAPI chat endpoint', () => {
    const model = {
      id: 'glm-4.5',
      provider: 'zai',
      ownedBy: 'zai',
      source: 'aiProxy',
    };

    expect(isZaiChatModel(model)).toBe(true);
    expect(resolveChatCompletionsUrl(model, 25583)).toBe('http://localhost:25584/api/v1/chat/completions');
  });

  it('keeps non-Z.AI models on the OmniRoute sidecar endpoint', () => {
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

  it('keeps unknown or auto routing on the OmniRoute sidecar endpoint', () => {
    expect(resolveChatCompletionsUrl(undefined, 25585)).toBe(
      'http://127.0.0.1:25585/v1/chat/completions'
    );
  });
});
