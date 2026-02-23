import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  routedProvider?: string;
  routedModel?: string;
  requestedModel?: string;
  debug?: ChatDebugInfo;
}

export interface ChatDebugInfo {
  apiUrl: string;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  requestHeaders: Record<string, string>;
  requestBody: Record<string, unknown>;
  responseStatus?: number;
  responseHeaders?: Record<string, string>;
  error?: string;
  forceProvider?: string;
  forceModelId?: string;
  forceAccountId?: string;
}

export interface ChatProfile {
  id: string;
  name: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
}

export interface ForceRoutingOverride {
  enabled: boolean;
  provider: string;
  modelId: string;
  accountId: string;
}

interface ChatState {
  messages: ChatMessage[];
  model: string;
  isLoading: boolean;
  error: string | null;
  profiles: ChatProfile[];
  activeProfileId: string;
  forceOverride: ForceRoutingOverride;

  // Actions
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => string;
  updateMessage: (id: string, content: string) => void;
  appendToMessage: (id: string, text: string) => void;
  setMessageStreaming: (id: string, streaming: boolean) => void;
  setMessageRouting: (
    id: string,
    routing: { routedProvider?: string; routedModel?: string; requestedModel?: string }
  ) => void;
  setMessageDebug: (id: string, debugPatch: Partial<ChatDebugInfo>) => void;
  removeMessage: (id: string) => void;
  clearMessages: () => void;
  setModel: (model: string) => void;
  createProfile: (name?: string) => string;
  updateProfile: (id: string, patch: Partial<Omit<ChatProfile, 'id'>>) => void;
  deleteProfile: (id: string) => void;
  setActiveProfile: (id: string) => void;
  setForceOverride: (patch: Partial<ForceRoutingOverride>) => void;
  resetForceOverride: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

const generateId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

const DEFAULT_PROFILE: ChatProfile = {
  id: 'profile_default',
  name: 'Default Debug',
  systemPrompt: '',
  temperature: 1,
  maxTokens: 4096,
};

const DEFAULT_FORCE_OVERRIDE: ForceRoutingOverride = {
  enabled: false,
  provider: '',
  modelId: '',
  accountId: '',
};

export const useChatStore = create<ChatState>()(
  persist(
    set => ({
      messages: [],
      model: 'auto',
      isLoading: false,
      error: null,
      profiles: [DEFAULT_PROFILE],
      activeProfileId: DEFAULT_PROFILE.id,
      forceOverride: DEFAULT_FORCE_OVERRIDE,

      addMessage: message => {
        const id = generateId();
        const newMessage: ChatMessage = {
          ...message,
          id,
          timestamp: Date.now(),
        };
        set(state => ({
          messages: [...state.messages, newMessage],
        }));
        return id;
      },

      updateMessage: (id, content) => {
        set(state => ({
          messages: state.messages.map(msg => (msg.id === id ? { ...msg, content } : msg)),
        }));
      },

      appendToMessage: (id, text) => {
        set(state => ({
          messages: state.messages.map(msg =>
            msg.id === id ? { ...msg, content: msg.content + text } : msg
          ),
        }));
      },

      setMessageStreaming: (id, streaming) => {
        set(state => ({
          messages: state.messages.map(msg =>
            msg.id === id ? { ...msg, isStreaming: streaming } : msg
          ),
        }));
      },

      setMessageRouting: (id, routing) => {
        set(state => ({
          messages: state.messages.map(msg => (msg.id === id ? { ...msg, ...routing } : msg)),
        }));
      },

      setMessageDebug: (id, debugPatch) => {
        set(state => ({
          messages: state.messages.map(msg =>
            msg.id === id
              ? {
                  ...msg,
                  debug: {
                    ...(msg.debug || {
                      apiUrl: '',
                      startedAt: Date.now(),
                      requestHeaders: {},
                      requestBody: {},
                    }),
                    ...debugPatch,
                  },
                }
              : msg
          ),
        }));
      },

      removeMessage: id => {
        set(state => ({
          messages: state.messages.filter(msg => msg.id !== id),
        }));
      },

      clearMessages: () => {
        set({ messages: [], error: null });
      },

      setModel: model => {
        set({ model });
      },

      createProfile: name => {
        const id = `profile_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const profile: ChatProfile = {
          id,
          name: name?.trim() || `Profile ${new Date().toLocaleTimeString()}`,
          systemPrompt: '',
          temperature: 1,
          maxTokens: 4096,
        };

        set(state => ({
          profiles: [...state.profiles, profile],
          activeProfileId: id,
        }));

        return id;
      },

      updateProfile: (id, patch) => {
        set(state => ({
          profiles: state.profiles.map(profile =>
            profile.id === id
              ? {
                  ...profile,
                  ...patch,
                }
              : profile
          ),
        }));
      },

      deleteProfile: id => {
        set(state => {
          if (state.profiles.length <= 1) {
            return state;
          }

          const remaining = state.profiles.filter(profile => profile.id !== id);
          const nextActiveId =
            state.activeProfileId === id
              ? (remaining[0]?.id ?? DEFAULT_PROFILE.id)
              : state.activeProfileId;

          return {
            profiles: remaining,
            activeProfileId: nextActiveId,
          };
        });
      },

      setActiveProfile: id => {
        set({ activeProfileId: id });
      },

      setForceOverride: patch => {
        set(state => ({
          forceOverride: {
            ...state.forceOverride,
            ...patch,
          },
        }));
      },

      resetForceOverride: () => {
        set({ forceOverride: DEFAULT_FORCE_OVERRIDE });
      },

      setLoading: loading => {
        set({ isLoading: loading });
      },

      setError: error => {
        set({ error });
      },
    }),
    {
      name: 'stitch-chat-storage',
      partialize: state => ({
        messages: state.messages,
        model: state.model,
        profiles: state.profiles,
        activeProfileId: state.activeProfileId,
        forceOverride: state.forceOverride,
      }),
    }
  )
);
