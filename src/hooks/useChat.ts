import { useCallback, useRef } from 'react';
import { useChatStore, type ChatMessage } from '../stores/chat';

interface UseChatOptions {
  apiUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

interface UseChatReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
  stopGeneration: () => void;
}

const DEFAULT_API_URL = 'http://localhost:8765/v1/chat/completions';

/**
 * Hook for managing chat state and communication with the LLM API server.
 * Uses persistent store to preserve messages across page navigation.
 * Supports streaming responses via Server-Sent Events (SSE).
 */
export function useChat(options: UseChatOptions = {}): UseChatReturn {
  const {
    apiUrl = DEFAULT_API_URL,
    model: optionModel,
    maxTokens = 4096,
    temperature = 1.0,
  } = options;

  const {
    messages,
    model: storeModel,
    isLoading,
    error,
    addMessage,
    appendToMessage,
    setMessageStreaming,
    removeMessage,
    clearMessages,
    setLoading,
    setError,
  } = useChatStore();

  const model = optionModel || storeModel;
  const abortControllerRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) return;

    setError(null);
    setLoading(true);

    // Add user message
    addMessage({
      role: 'user',
      content: content.trim(),
    });

    // Create assistant message placeholder for streaming
    const assistantMessageId = addMessage({
      role: 'assistant',
      content: '',
      isStreaming: true,
    });

    // Create abort controller for this request
    abortControllerRef.current = new AbortController();

    try {
      // Build messages array for API
      const currentMessages = useChatStore.getState().messages;
      const apiMessages = currentMessages
        .filter(msg => msg.id !== assistantMessageId)
        .map(msg => ({
          role: msg.role,
          content: msg.content,
        }));

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer local-dev-token',
        },
        body: JSON.stringify({
          model,
          messages: apiMessages,
          max_tokens: maxTokens,
          temperature,
          stream: true,
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail?.error?.message || errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

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
              else if (event.type === 'contentBlockDelta' || event.type === 'content_block_delta') {
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

    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Request was cancelled
        const msg = useChatStore.getState().messages.find(m => m.id === assistantMessageId);
        if (msg && !msg.content) {
          removeMessage(assistantMessageId);
        } else {
          setMessageStreaming(assistantMessageId, false);
        }
      } else {
        const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
        setError(errorMessage);
        
        // Remove the empty assistant message on error
        const msg = useChatStore.getState().messages.find(m => m.id === assistantMessageId);
        if (!msg?.content) {
          removeMessage(assistantMessageId);
        }
      }
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  }, [apiUrl, model, maxTokens, temperature, isLoading, addMessage, appendToMessage, setMessageStreaming, removeMessage, setError, setLoading]);

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
