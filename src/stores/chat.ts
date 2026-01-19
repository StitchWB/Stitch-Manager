import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

interface ChatState {
  messages: ChatMessage[];
  model: string;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => string;
  updateMessage: (id: string, content: string) => void;
  appendToMessage: (id: string, text: string) => void;
  setMessageStreaming: (id: string, streaming: boolean) => void;
  removeMessage: (id: string) => void;
  clearMessages: () => void;
  setModel: (model: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

const generateId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      messages: [],
      model: 'auto',
      isLoading: false,
      error: null,

      addMessage: (message) => {
        const id = generateId();
        const newMessage: ChatMessage = {
          ...message,
          id,
          timestamp: Date.now(),
        };
        set((state) => ({
          messages: [...state.messages, newMessage],
        }));
        return id;
      },

      updateMessage: (id, content) => {
        set((state) => ({
          messages: state.messages.map((msg) =>
            msg.id === id ? { ...msg, content } : msg
          ),
        }));
      },

      appendToMessage: (id, text) => {
        set((state) => ({
          messages: state.messages.map((msg) =>
            msg.id === id ? { ...msg, content: msg.content + text } : msg
          ),
        }));
      },

      setMessageStreaming: (id, streaming) => {
        set((state) => ({
          messages: state.messages.map((msg) =>
            msg.id === id ? { ...msg, isStreaming: streaming } : msg
          ),
        }));
      },

      removeMessage: (id) => {
        set((state) => ({
          messages: state.messages.filter((msg) => msg.id !== id),
        }));
      },

      clearMessages: () => {
        set({ messages: [], error: null });
      },

      setModel: (model) => {
        set({ model });
      },

      setLoading: (loading) => {
        set({ isLoading: loading });
      },

      setError: (error) => {
        set({ error });
      },
    }),
    {
      name: 'stitch-chat-storage',
      partialize: (state) => ({
        messages: state.messages,
        model: state.model,
      }),
    }
  )
);
