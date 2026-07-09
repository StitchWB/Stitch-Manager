import { useCallback, useRef } from 'react';
import { useChatStore, type ChatMessage, type ChatSession } from '../stores/chat';
import type { ContentBlock } from '../types/generated';

interface UseChatOptions {
  apiUrl?: string;
  model?: string;
  provider?: string;
  apiKey?: string;
  maxTokens?: number;
  temperature?: number;
}

interface UseChatReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  sendMessage: (content: string, attachments?: ContentBlock[]) => Promise<void>;
  clearMessages: () => void;
  stopGeneration: () => void;
}

// AI Proxy default port - Chat.tsx overrides this with dynamic port from settings.
// Unified Gateway: all models (sidecar, kiro-pool, freemodel-bridge) route through this endpoint.
const DEFAULT_API_URL = 'http://localhost:25583/v1/chat/completions';

/** Stable empty array to avoid creating a new [] on every selector call. */
const EMPTY_MESSAGES: ChatMessage[] = [];

/**
 * Hook for managing chat state and communication with the LLM API server.
 * Uses persistent store to preserve messages across page navigation.
 * Supports streaming responses via Server-Sent Events (SSE).
 */
export function useChat(options: UseChatOptions = {}): UseChatReturn {
  const {
    apiUrl = DEFAULT_API_URL,
    model: optionModel,
    provider,
    apiKey,
    maxTokens = 4096,
    temperature = 1.0,
  } = options;

  // Individual selectors with stable references.
  // - Primitives (isLoading, error) are compared by Object.is — safe.
  // - Functions from Zustand are stable by identity — safe.
  // - Computed selectors use useCallback to keep the selector function
  //   identity stable, which lets Zustand cache the result.
  const messages = useChatStore(
    useCallback(
      (state: { sessions: ChatSession[]; activeSessionId: string }) =>
        state.sessions.find(s => s.id === state.activeSessionId)?.messages ?? EMPTY_MESSAGES,
      []
    )
  );
  const storeModel = useChatStore(
    useCallback(
      (state: { sessions: ChatSession[]; activeSessionId: string }) =>
        state.sessions.find(s => s.id === state.activeSessionId)?.model ?? 'auto',
      []
    )
  );
  const isLoading = useChatStore(state => state.isLoading);
  const error = useChatStore(state => state.error);
  const addMessage = useChatStore(state => state.addMessage);
  const appendToMessage = useChatStore(state => state.appendToMessage);
  const setMessageStreaming = useChatStore(state => state.setMessageStreaming);
  const setMessageRouting = useChatStore(state => state.setMessageRouting);
  const removeMessage = useChatStore(state => state.removeMessage);
  const clearMessages = useChatStore(state => state.clearMessages);
  const setLoading = useChatStore(state => state.setLoading);
  const setError = useChatStore(state => state.setError);

  const model = optionModel || storeModel;
  const abortControllerRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (content: string, attachments: ContentBlock[] = []) => {
      if ((!content.trim() && attachments.length === 0) || isLoading) return;

      setError(null);
      setLoading(true);

      const trimmedContent = content.trim();
      const userBlocks: ContentBlock[] = [
        ...(trimmedContent ? [{ type: 'text' as const, text: trimmedContent }] : []),
        ...attachments,
      ];
      const userContent: string | ContentBlock[] =
        attachments.length > 0 ? userBlocks : trimmedContent;

      // Add user message
      addMessage({
        role: 'user',
        content: userContent,
      });

      // Create assistant message placeholder for streaming
      const assistantMessageId = addMessage({
        role: 'assistant',
        content: '',
        isStreaming: true,
      });

      // Create abort controller for this request
      abortControllerRef.current = new AbortController();

      // All models route through the unified gateway on port 25583.
      // The gateway inspects the model field and forwards to the correct upstream.
      const effectiveApiUrl = apiUrl;
      const effectiveApiKey = apiKey;

      try {
        // Build messages array for API
        const currentMessages = useChatStore.getState().messages();
        const apiMessages: Array<{ role: string; content: string | ContentBlock[] }> =
          currentMessages
            .filter(msg => msg.id !== assistantMessageId)
            .map(msg => ({
              role: msg.role,
              content: msg.content,
            }));

        const storeState = useChatStore.getState();
        const activeProfile =
          storeState.profiles.find(profile => profile.id === storeState.activeProfileId) ||
          storeState.profiles[0];

        const forceOverride = storeState.forceOverride;

        // Session-level system prompt takes precedence; fall back to profile.
        const activeSession = storeState.activeSession();
        const systemPrompt =
          activeSession?.systemPrompt?.trim() || activeProfile?.systemPrompt?.trim() || '';

        if (systemPrompt) {
          apiMessages.unshift({
            role: 'system',
            content: systemPrompt,
          });
        }

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };

        if (effectiveApiKey) {
          headers.Authorization = `Bearer ${effectiveApiKey}`;
        }

        if (forceOverride.enabled) {
          if (forceOverride.provider.trim()) {
            headers['X-Force-Provider'] = forceOverride.provider.trim();
          }
          if (forceOverride.modelId.trim()) {
            headers['X-Force-Model'] = forceOverride.modelId.trim();
          }
          if (forceOverride.accountId.trim()) {
            headers['X-Force-Account'] = forceOverride.accountId.trim();
          }
        }

        const requestBody: Record<string, unknown> = {
          model,
          messages: apiMessages,
          max_tokens: activeProfile?.maxTokens ?? maxTokens,
          temperature: activeProfile?.temperature ?? temperature,
          stream: true,
        };

        if (provider) {
          requestBody.provider = provider;
        }

        const hasImageContent = apiMessages.some(message =>
          Array.isArray(message.content)
            ? message.content.some(block => block.type === 'image')
            : false
        );
        if (hasImageContent) {
          requestBody.modalities = ['text', 'image'];
        }

        useChatStore.getState().setMessageDebug(assistantMessageId, {
          apiUrl: effectiveApiUrl,
          startedAt: Date.now(),
          requestHeaders: headers,
          requestBody,
          forceProvider: forceOverride.enabled ? forceOverride.provider || undefined : undefined,
          forceModelId: forceOverride.enabled ? forceOverride.modelId || undefined : undefined,
          forceAccountId: forceOverride.enabled ? forceOverride.accountId || undefined : undefined,
        });

        const response = await fetch(effectiveApiUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
          signal: abortControllerRef.current.signal,
        });

        const responseHeaders = Object.fromEntries(response.headers.entries());

        useChatStore.getState().setMessageDebug(assistantMessageId, {
          responseStatus: response.status,
          responseHeaders,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.detail?.error?.message ||
              errorData.error?.message ||
              (typeof errorData.error === 'string' ? errorData.error : null) ||
              errorData.message ||
              `HTTP ${response.status}: ${response.statusText}`
          );
        }

        const routedProvider = response.headers.get('x-routed-provider') || undefined;
        const routedModel = response.headers.get('x-routed-model') || undefined;
        const requestedModel = response.headers.get('x-requested-model') || model;

        setMessageRouting(assistantMessageId, {
          routedProvider,
          routedModel,
          requestedModel,
        });

        // Handle streaming response
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response body');
        }

        const decoder = new TextDecoder();
        let buffer = '';

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          // Process SSE events
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                break;
              }

              try {
                const event = JSON.parse(data);

                // Handle OpenAI-style streaming (choices[0].delta.content)
                if (event.choices?.[0]?.delta?.content) {
                  const text = event.choices[0].delta.content;
                  appendToMessage(assistantMessageId, text);
                }
                // Handle Anthropic-style streaming
                else if (
                  event.type === 'contentBlockDelta' ||
                  event.type === 'content_block_delta'
                ) {
                  const text = event.delta?.text || event.delta?.text_delta?.text || '';
                  if (text) {
                    appendToMessage(assistantMessageId, text);
                  }
                }
                // Handle direct text delta
                else if (event.delta?.text) {
                  appendToMessage(assistantMessageId, event.delta.text);
                }
                // Handle message stop
                else if (event.type === 'messageStop' || event.type === 'message_stop') {
                  setMessageStreaming(assistantMessageId, false);
                }
                // Handle usage metadata in final chunk
                if (event.usage || event['x-elapsed-ms'] != null) {
                  const usagePatch: Record<string, unknown> = {};
                  if (event.usage) {
                    usagePatch.promptTokens = event.usage.prompt_tokens || event.usage.inputTokenCount || 0;
                    usagePatch.completionTokens = event.usage.completion_tokens || event.usage.outputTokenCount || 0;
                    usagePatch.totalTokens = event.usage.total_tokens || event.usage.totalTokenCount || 0;
                  }
                  if (event['x-elapsed-ms'] != null) {
                    usagePatch.durationMs = event['x-elapsed-ms'];
                  }
                  if (event['x-context-usage-pct'] != null) {
                    usagePatch.contextUsagePct = event['x-context-usage-pct'];
                  }
                  useChatStore.getState().setMessageDebug(assistantMessageId, usagePatch as Partial<import('../stores/chat').ChatDebugInfo>);
                }
                // Handle error
                else if (event.type === 'error') {
                  throw new Error(event.error?.message || event.error || 'Stream error');
                }
              } catch {
                // Ignore parse errors for non-JSON lines
                if (data.trim() && !data.startsWith('event:')) {
                  console.warn('Failed to parse SSE data:', data);
                }
              }
            }
          }
        }

        // Mark streaming as complete
        setMessageStreaming(assistantMessageId, false);
        const completedAt = Date.now();
        useChatStore.getState().setMessageDebug(assistantMessageId, {
          completedAt,
          durationMs:
            completedAt -
            (useChatStore.getState().messages().find(m => m.id === assistantMessageId)?.debug
              ?.startedAt || completedAt),
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          // Request was cancelled
          const msg = useChatStore.getState().messages().find(m => m.id === assistantMessageId);
          if (msg && !msg.content) {
            removeMessage(assistantMessageId);
          } else {
            setMessageStreaming(assistantMessageId, false);
          }
        } else {
          const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
          setError(errorMessage);
          const completedAt = Date.now();
          useChatStore.getState().setMessageDebug(assistantMessageId, {
            error: errorMessage,
            completedAt,
            durationMs:
              completedAt -
              (useChatStore.getState().messages().find(m => m.id === assistantMessageId)?.debug
                ?.startedAt || completedAt),
          });

          // Remove the empty assistant message on error
          const msg = useChatStore.getState().messages().find(m => m.id === assistantMessageId);
          if (!msg?.content) {
            removeMessage(assistantMessageId);
          }
        }
      } finally {
        setLoading(false);
        abortControllerRef.current = null;
      }
    },
    [
      apiUrl,
      model,
      provider,
      apiKey,
      maxTokens,
      temperature,
      isLoading,
      addMessage,
      appendToMessage,
      setMessageStreaming,
      setMessageRouting,
      removeMessage,
      setError,
      setLoading,
    ]
  );

  const handleClearMessages = useCallback(() => {
    clearMessages();
  }, [clearMessages]);

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    clearMessages: handleClearMessages,
    stopGeneration,
  };
}
