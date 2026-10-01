import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProviderName, Theme, ProviderInfo } from '../types/ui';
import { ALL_PROVIDER_IDS, PROVIDER_META } from '../constants/providerIds';
import { PROVIDER_GRADIENTS } from '../constants/providers';
import { setLocale } from '../lib/i18n';

export type Language = 'en' | 'ru' | 'zh';

// Initialize locale from localStorage or system preference
const initializeLocale = (): Language => {
  // Try to get from localStorage first (persisted state)
  try {
    const stored = localStorage.getItem('stitch-app-storage');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.state?.language) {
        setLocale(parsed.state.language);
        return parsed.state.language;
      }
    }
  } catch {
    /* Ignore localStorage errors */
  }

  // Fall back to system preference
  const systemLang = navigator.language.split('-')[0];
  const supportedLang = ['en', 'ru'].includes(systemLang) ? (systemLang as Language) : 'en';
  setLocale(supportedLang);
  return supportedLang;
};

const initialLanguage = initializeLocale();

interface AppState {
  // Theme
  theme: Theme;
  setTheme: (theme: Theme) => void;

  // Language
  language: Language;
  setLanguage: (language: Language) => void;

  // Selected Provider
  selectedProvider: ProviderName | null;
  setSelectedProvider: (provider: ProviderName | null) => void;

  // Providers list
  providers: ProviderInfo[];
  setProviders: (providers: ProviderInfo[]) => void;

  // UI State
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

const DEFAULT_PROVIDERS: ProviderInfo[] = ALL_PROVIDER_IDS.map(id => ({
  // The Specta-generated Provider union lags the Python registry (no zai/anthropic).
  id: id as ProviderName,
  name: PROVIDER_META[id].displayName,
  version: '',
  activeCount: 0,
  status: 'inactive',
  color: (PROVIDER_GRADIENTS as Partial<Record<string, string>>)[id] ?? 'from-slate-600 to-slate-700',
}));

export const useAppStore = create<AppState>()(
  persist(
    set => ({
      // Theme
      theme: 'dark',
      setTheme: theme => {
        set({ theme });
        // Apply theme to document
        if (theme === 'dark') {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      },

      // Language
      language: initialLanguage,
      setLanguage: language => {
        setLocale(language);
        set({ language });
      },

      // Selected Provider
      selectedProvider: null,
      setSelectedProvider: provider => set({ selectedProvider: provider }),

      // Providers
      providers: DEFAULT_PROVIDERS,
      setProviders: providers => set({ providers }),

      // UI State
      sidebarCollapsed: false,
      toggleSidebar: () => set(state => ({ sidebarCollapsed: !state.sidebarCollapsed })),
    }),
    {
      name: 'stitch-app-storage',
      partialize: state => ({
        theme: state.theme,
        language: state.language,
        selectedProvider: state.selectedProvider,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    }
  )
);
