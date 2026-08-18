import { create } from 'zustand';

// ============================================
// Types
// ============================================

interface PageSessionState {
  [key: string]: unknown;
}

interface ComponentSessionState {
  [key: string]: unknown;
}

export interface UISessionState {
  // Per-page ephemeral state (resets on app restart)
  pageStates: Record<string, PageSessionState>;
  setPageState: (page: string, key: string, value: unknown) => void;
  getPageState: <T>(page: string, key: string, defaultValue: T) => T;
  clearPageState: (page: string) => void;

  // Per-component ephemeral state by unique key
  componentStates: Record<string, ComponentSessionState>;
  setComponentState: (componentKey: string, value: unknown) => void;
  getComponentState: <T>(componentKey: string, defaultValue: T) => T;
  clearComponentState: (componentKey: string) => void;

  // Global ephemeral flags
  isCommandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;

  // Global reset
  resetSession: () => void;
}

const DEFAULT_STATE = {
  pageStates: {},
  componentStates: {},
  isCommandPaletteOpen: false,
};

// ============================================
// Store
// ============================================

export const useUISessionStore = create<UISessionState>()(set => ({
  ...DEFAULT_STATE,

  setPageState: (page, key, value) =>
    set(state => ({
      pageStates: {
        ...state.pageStates,
        [page]: {
          ...(state.pageStates[page] ?? {}),
          [key]: value,
        },
      },
    })),

  getPageState: <T,>(page: string, key: string, defaultValue: T): T => {
    const state = useUISessionStore.getState();
    const pageState = state.pageStates[page];
    if (!pageState || !(key in pageState)) return defaultValue;
    return pageState[key] as T;
  },

  clearPageState: page =>
    set(state => {
      const next = { ...state.pageStates };
      delete next[page];
      return { pageStates: next };
    }),

  setComponentState: (componentKey: string, value: unknown) =>
    set(state => ({
      componentStates: {
        ...state.componentStates,
        [componentKey]: value as ComponentSessionState,
      },
    })),

  getComponentState: <T,>(componentKey: string, defaultValue: T): T => {
    const state = useUISessionStore.getState();
    if (!(componentKey in state.componentStates)) return defaultValue;
    return state.componentStates[componentKey] as T;
  },

  clearComponentState: componentKey =>
    set(state => {
      const next = { ...state.componentStates };
      delete next[componentKey];
      return { componentStates: next };
    }),

  setCommandPaletteOpen: open => set({ isCommandPaletteOpen: open }),

  resetSession: () => set(DEFAULT_STATE),
}));
