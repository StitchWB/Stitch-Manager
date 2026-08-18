import { describe, it, expect, beforeEach } from '@jest/globals';
import { useChatStore } from '../../stores/chat';

describe('chat store', () => {
  beforeEach(() => {
    useChatStore.getState().clearMessages();
    useChatStore.getState().setSessionModel('auto');
    useChatStore.getState().setError(null);
    useChatStore.getState().setLoading(false);
  });

  it('setMessageRouting updates routed metadata for assistant message', () => {
    const id = useChatStore.getState().addMessage({
      role: 'assistant',
      content: '',
      isStreaming: true,
    });

    useChatStore.getState().setMessageRouting(id, {
      routedProvider: 'openai',
      routedModel: 'gpt-4-turbo',
      requestedModel: 'gpt-4-turbo',
    });

    const msg = useChatStore.getState().messages().find(m => m.id === id);
    expect(msg).toBeTruthy();
    expect(msg?.routedProvider).toBe('openai');
    expect(msg?.routedModel).toBe('gpt-4-turbo');
    expect(msg?.requestedModel).toBe('gpt-4-turbo');
  });
});
