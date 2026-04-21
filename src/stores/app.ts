import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { toast } from 'sonner';
import type { ProviderName, Theme, Provider } from '../types/ui';
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
  providers: Provider[];
  setProviders: (providers: Provider[]) => void;

  // UI State
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  // Notifications
  notifications: AppNotification[];
  addNotification: (notification: Omit<AppNotification, 'id' | 'timestamp'>) => void;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;
}

interface AppNotification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
  timestamp: number;
}

const DEFAULT_PROVIDERS: Provider[] = [
  {
    id: 'kiro',
    name: 'Kiro',
    version: 'v2.1',
    activeCount: 12,
    status: 'active',
    color: 'from-purple-500 to-indigo-600',
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    version: 'v1.4',
    activeCount: 4,
    status: 'active',
    color: 'from-cyan-400 to-blue-500',
  },
  {
    id: 'trae',
    name: 'Trae',
    version: 'v1.0',
    activeCount: 8,
    status: 'active',
    color: 'from-emerald-400 to-teal-600',
  },
];

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

      // Notifications - using Sonner toasts
      notifications: [],
      addNotification: notification => {
        const { type, title, message } = notification;

        if (type === 'success') {
          toast.success(title, { description: message });
        } else if (type === 'error') {
          toast.error(title, { description: message });
        } else if (type === 'warning') {
          toast.warning(title, { description: message });
        } else {
          toast.info(title, { description: message });
        }
      },
      removeNotification: _id => {
        // Sonner handles its own toast removal
      },
      clearNotifications: () => {
        toast.dismiss();
      },
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
