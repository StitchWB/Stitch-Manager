import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { t } from '../lib/i18n';
import type { ContentBlock } from '../types/generated';

export type ChatMessageContent = string | ContentBlock[];

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: ChatMessageContent;
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
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  contextUsagePct?: number;
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

/** A single chat session with its own messages, model, and system prompt. */
export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  model: string;
  systemPrompt: string;
  createdAt: number;
  updatedAt: number;
}

interface ChatState {
  // ─── Session data ────────────────────────────────────────────────
  sessions: ChatSession[];
  activeSessionId: string;

  // ─── Transient (non-persisted) state ────────────────────────────
  isLoading: boolean;
  error: string | null;

  // ─── Global settings (persisted) ────────────────────────────────
  profiles: ChatProfile[];
  activeProfileId: string;
  forceOverride: ForceRoutingOverride;
  inspectorOpen: boolean;

  // ─── Convenience selectors ───────────────────────────────────────
  activeSession: () => ChatSession | undefined;
  messages: () => ChatMessage[];
  model: () => string;

  // ─── Session actions ─────────────────────────────────────────────
  createSession: (title?: string) => string;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  setSessionModel: (model: string) => void;
  setSessionSystemPrompt: (prompt: string) => void;

  // ─── Message actions (operate on active session) ────────────────
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => string;
  updateMessage: (id: string, content: ChatMessageContent) => void;
  appendToMessage: (id: string, text: string) => void;
  setMessageStreaming: (id: string, streaming: boolean) => void;
  setMessageRouting: (
    id: string,
    routing: { routedProvider?: string; routedModel?: string; requestedModel?: string }
  ) => void;
  setMessageDebug: (id: string, debugPatch: Partial<ChatDebugInfo>) => void;
  removeMessage: (id: string) => void;
  clearMessages: () => void;

  // ─── Global settings actions ─────────────────────────────────────
  createProfile: (name?: string) => string;
  updateProfile: (id: string, patch: Partial<Omit<ChatProfile, 'id'>>) => void;
  deleteProfile: (id: string) => void;
  setActiveProfile: (id: string) => void;
  setForceOverride: (patch: Partial<ForceRoutingOverride>) => void;
  resetForceOverride: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setInspectorOpen: (open: boolean) => void;
}

const generateId = (prefix = 'msg') => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

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

function makeDefaultSession(): ChatSession {
  const id = generateId('ses');
  return {
    id,
    title: t('chat.newChatDefault'),
    messages: [],
    model: 'auto',
    systemPrompt: '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/** Helper: map over messages of the active session, returning a new sessions array. */
function patchActiveSessionMessages(
  sessions: ChatSession[],
  activeSessionId: string,
  fn: (msgs: ChatMessage[]) => ChatMessage[]
): ChatSession[] {
  return sessions.map(s =>
    s.id === activeSessionId ? { ...s, messages: fn(s.messages), updatedAt: Date.now() } : s
  );
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => {
      const firstSession = makeDefaultSession();

      return {
        sessions: [firstSession],
        activeSessionId: firstSession.id,
        isLoading: false,
        error: null,
        profiles: [DEFAULT_PROFILE],
        activeProfileId: DEFAULT_PROFILE.id,
        forceOverride: DEFAULT_FORCE_OVERRIDE,
        inspectorOpen: true,

        // ─── Convenience selectors ───────────────────────────────────
        activeSession: () => {
          const { sessions, activeSessionId } = get();
          return sessions.find(s => s.id === activeSessionId);
        },
        messages: () => {
          const session = get().activeSession();
          return session?.messages ?? [];
        },
        model: () => {
          const session = get().activeSession();
          return session?.model ?? 'auto';
        },

        // ─── Session actions ──────────────────────────────────────────
        createSession: (title?: string) => {
          const session = makeDefaultSession();
          if (title) session.title = title;
          set(state => ({
            sessions: [session, ...state.sessions],
            activeSessionId: session.id,
          }));
          return session.id;
        },

        switchSession: (id: string) => {
          const { sessions } = get();
          if (sessions.some(s => s.id === id)) {
            set({ activeSessionId: id });
          }
        },

        deleteSession: (id: string) => {
          set(state => {
            if (state.sessions.length <= 1) return state;
            const remaining = state.sessions.filter(s => s.id !== id);
            const nextActiveId =
              state.activeSessionId === id
                ? remaining[0]?.id ?? state.activeSessionId
                : state.activeSessionId;
            return { sessions: remaining, activeSessionId: nextActiveId };
          });
        },

        renameSession: (id: string, title: string) => {
          set(state => ({
            sessions: state.sessions.map(s =>
              s.id === id ? { ...s, title, updatedAt: Date.now() } : s
            ),
          }));
        },

        setSessionModel: (model: string) => {
          set(state => ({
            sessions: state.sessions.map(s =>
              s.id === state.activeSessionId ? { ...s, model, updatedAt: Date.now() } : s
            ),
          }));
        },

        setSessionSystemPrompt: (prompt: string) => {
          set(state => ({
            sessions: state.sessions.map(s =>
              s.id === state.activeSessionId
                ? { ...s, systemPrompt: prompt, updatedAt: Date.now() }
                : s
            ),
          }));
        },

        // ─── Message actions ──────────────────────────────────────────
        addMessage: message => {
          const id = generateId('msg');
          const newMessage: ChatMessage = { ...message, id, timestamp: Date.now() };
          set(state => ({
            sessions: patchActiveSessionMessages(state.sessions, state.activeSessionId, msgs => [
              ...msgs,
              newMessage,
            ]),
          }));
          return id;
        },

        updateMessage: (id, content) => {
          set(state => ({
            sessions: patchActiveSessionMessages(state.sessions, state.activeSessionId, msgs =>
              msgs.map(msg => (msg.id === id ? { ...msg, content } : msg))
            ),
          }));
        },

        appendToMessage: (id, text) => {
          set(state => ({
            sessions: patchActiveSessionMessages(state.sessions, state.activeSessionId, msgs =>
              msgs.map(msg =>
                msg.id === id
                  ? {
                      ...msg,
                      content:
                        typeof msg.content === 'string'
                          ? msg.content + text
                          : [...msg.content, { type: 'text' as const, text }],
                    }
                  : msg
              )
            ),
          }));
        },

        setMessageStreaming: (id, streaming) => {
          set(state => ({
            sessions: patchActiveSessionMessages(state.sessions, state.activeSessionId, msgs =>
              msgs.map(msg => (msg.id === id ? { ...msg, isStreaming: streaming } : msg))
            ),
          }));
        },

        setMessageRouting: (id, routing) => {
          set(state => ({
            sessions: patchActiveSessionMessages(state.sessions, state.activeSessionId, msgs =>
              msgs.map(msg => (msg.id === id ? { ...msg, ...routing } : msg))
            ),
          }));
        },

        setMessageDebug: (id, debugPatch) => {
          set(state => ({
            sessions: patchActiveSessionMessages(state.sessions, state.activeSessionId, msgs =>
              msgs.map(msg =>
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
              )
            ),
          }));
        },

        removeMessage: id => {
          set(state => ({
            sessions: patchActiveSessionMessages(state.sessions, state.activeSessionId, msgs =>
              msgs.filter(msg => msg.id !== id)
            ),
          }));
        },

        clearMessages: () => {
          set(state => ({
            sessions: patchActiveSessionMessages(state.sessions, state.activeSessionId, () => []),
            error: null,
          }));
        },

        // ─── Global settings actions ──────────────────────────────────
        createProfile: name => {
          const id = generateId('profile');
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
              profile.id === id ? { ...profile, ...patch } : profile
            ),
          }));
        },

        deleteProfile: id => {
          set(state => {
            if (state.profiles.length <= 1) return state;

            const remaining = state.profiles.filter(profile => profile.id !== id);
            const nextActiveId =
              state.activeProfileId === id
                ? remaining[0]?.id ?? DEFAULT_PROFILE.id
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
            forceOverride: { ...state.forceOverride, ...patch },
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

        setInspectorOpen: open => {
          set({ inspectorOpen: open });
        },
      };
    },
    {
      name: 'stitch-chat-storage',
      version: 1,
      /** Migrate from the old flat schema (messages[] at root) to sessions. */
      migrate: (persisted, version) => {
        const data = persisted as Record<string, unknown> | null;
        if (version === 0 && data && 'messages' in data && !('sessions' in data)) {
          const oldMessages = (data.messages ?? []) as ChatMessage[];
          const oldModel = (data.model ?? 'auto') as string;
          const migratedSession: ChatSession = {
            id: generateId('ses'),
            title: 'Migrated Chat',
            messages: oldMessages,
            model: oldModel,
            systemPrompt: '',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          return {
            ...data,
            sessions: [migratedSession],
            activeSessionId: migratedSession.id,
            inspectorOpen: true,
          };
        }
        return persisted;
      },
      partialize: state => ({
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
        profiles: state.profiles,
        activeProfileId: state.activeProfileId,
        forceOverride: state.forceOverride,
        inspectorOpen: state.inspectorOpen,
      }),
      merge: (persisted, current) => {
        const persistedState = (typeof persisted === 'object' && persisted !== null) ? persisted : {};
        const merged = { ...current, ...persistedState } as ChatState;
        // activeSessionId might point to a deleted session after
        // partialization changes. Fall back to the first stored session.
        const sessionExists = merged.sessions.some(s => s.id === merged.activeSessionId);
        if (!sessionExists && merged.sessions.length > 0) {
          merged.activeSessionId = merged.sessions[0].id;
        }
        return merged;
      },
    }
  )
);
