import { act, renderHook } from '@testing-library/react';
import { TextDecoder } from 'util';
import { useChat } from '../../hooks/useChat';
import { useChatStore } from '../../stores/chat';

describe('chat failure diagnostics', () => {
  it('sends Anthropic system separately and reads native text and usage events', async () => {
    const previousDecoder = globalThis.TextDecoder;
    globalThis.TextDecoder = TextDecoder as typeof globalThis.TextDecoder;
    const profile = useChatStore.getState().profiles.find(p => p.id === useChatStore.getState().activeProfileId)!;
    const previousPrompt = profile.systemPrompt;
    useChatStore.getState().updateProfile(profile.id, { systemPrompt: 'Fixture system' });
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 7, output_tokens: 0 } } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'OK' } },
      { type: 'message_delta', usage: { output_tokens: 2 } },
      { type: 'message_stop' },
    ];
    const body = events.map(event => `data:${JSON.stringify(event)}\r\n\r\n`).join('');
    const read = jest.fn().mockResolvedValueOnce({ done: false, value: new Uint8Array(Buffer.from(body)) }).mockResolvedValue({ done: true });
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, headers: new Headers(), body: { getReader: () => ({ read }) } } as unknown as Response);
    try {
      const { result } = renderHook(() => useChat({ apiUrl: '/v1/messages', model: 'velly/anthropic/sonnet', protocol: 'messages' } as Parameters<typeof useChat>[0]));
      await act(async () => result.current.sendMessage('Hi', [{ type: 'image', source: { sourceType: 'base64', mediaType: 'image/png', data: 'ZmFrZQ==' } }]));
      const request = JSON.parse(fetch.mock.calls[0][1]?.body as string);
      expect(request.system).toBe('Fixture system');
      expect(request.messages.every((message: { role: string }) => message.role !== 'system')).toBe(true);
      expect(request.messages[0].content[1]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'ZmFrZQ==' } });
      expect(request.modalities).toBeUndefined();
      const reply = result.current.messages.find(message => message.role === 'assistant');
      expect(reply?.content).toBe('OK');
      expect(reply?.debug?.promptTokens).toBe(7);
      expect(reply?.debug?.completionTokens).toBe(2);
      expect(reply?.debug?.totalTokens).toBe(9);
    } finally {
      globalThis.TextDecoder = previousDecoder;
      useChatStore.getState().updateProfile(profile.id, { systemPrompt: previousPrompt });
    }
  });

  it('reads the last SSE text event even when the server closes without a final newline', async () => {
    const previousDecoder = globalThis.TextDecoder;
    globalThis.TextDecoder = TextDecoder as typeof globalThis.TextDecoder;
    const bytes = new Uint8Array(Buffer.from('data: {"type":"content_block_delta","delta":{"text":"OK"}}'));
    const read = jest.fn().mockResolvedValueOnce({ done: false, value: bytes }).mockResolvedValue({ done: true });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, headers: new Headers(), body: { getReader: () => ({ read }) } } as unknown as Response);
    try {
      const { result } = renderHook(() => useChat({ apiUrl: '/v1/messages', model: 'velly/anthropic/sonnet' }));
      await act(async () => result.current.sendMessage('Hi'));
      expect(result.current.messages.find(message => message.role === 'assistant')?.content).toBe('OK');
      expect(result.current.error).toBeNull();
    } finally { globalThis.TextDecoder = previousDecoder; }
  });

  it('reports an empty SSE stream as an error instead of a successful blank answer', async () => {
    const previousDecoder = globalThis.TextDecoder;
    globalThis.TextDecoder = TextDecoder as typeof globalThis.TextDecoder;
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, headers: new Headers(), body: { getReader: () => ({ read: async () => ({ done: true }) }) } } as unknown as Response);
    try {
      const { result } = renderHook(() => useChat({ apiUrl: '/v1/messages', model: 'velly/anthropic/sonnet' }));
      await act(async () => result.current.sendMessage('Hi'));
      expect(result.current.error).toBe('Модель завершила поток без текста ответа');
      expect(result.current.messages.find(message => message.role === 'assistant')?.debug?.responseStatus).toBe(200);
    } finally { globalThis.TextDecoder = previousDecoder; }
  });

  beforeEach(() => {
    useChatStore.getState().clearMessages();
    useChatStore.getState().setLoading(false);
    useChatStore.getState().setError(null);
  });

  afterEach(() => jest.restoreAllMocks());

  it('keeps the failed request for the inspector without storing its bearer token', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false, status: 503, statusText: 'Unavailable', headers: new Headers(),
      json: async () => ({ detail: { error: { message: 'Fixture route failed' } } }),
    } as Response);
    const { result } = renderHook(() => useChat({ apiUrl: '/v1/chat/completions', model: 'velly/sonnet', apiKey: 'fixture-secret' }));
    await act(async () => result.current.sendMessage('Hi'));
    const failed = result.current.messages.find(message => message.role === 'assistant');
    expect(failed?.debug?.responseStatus).toBe(503);
    expect(failed?.debug?.error).toBe('Fixture route failed');
    expect(failed?.isStreaming).toBe(false);
    expect(JSON.stringify(failed?.debug)).not.toContain('fixture-secret');
    expect(result.current.error).toBe('Fixture route failed');
  });

  it('reports an error event inside a 200 SSE response instead of swallowing it as a parse error', async () => {
    const previousDecoder = globalThis.TextDecoder;
    globalThis.TextDecoder = TextDecoder as typeof globalThis.TextDecoder;
    const read = jest.fn()
      .mockResolvedValueOnce({ done: false, value: new Uint8Array(Buffer.from('data: {"type":"error","error":{"message":"Fixture stream failed"}}\n\n')) })
      .mockResolvedValue({ done: true });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, status: 200, headers: new Headers(), body: { getReader: () => ({ read }) },
    } as unknown as Response);
    try {
      const { result } = renderHook(() => useChat({ apiUrl: '/v1/chat/completions', model: 'velly/sonnet' }));
      await act(async () => result.current.sendMessage('Hi'));
      expect(result.current.error).toBe('Fixture stream failed');
      const failed = result.current.messages.find(message => message.role === 'assistant');
      expect(failed?.debug?.responseStatus).toBe(200);
      expect(failed?.debug?.error).toBe('Fixture stream failed');
      expect(failed?.isStreaming).toBe(false);
    } finally {
      globalThis.TextDecoder = previousDecoder;
    }
  });
});
