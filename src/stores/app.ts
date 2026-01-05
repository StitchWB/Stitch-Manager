import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProviderName, Theme, Provider, LLMServerStatus } from '../types';

// Track notification timeouts to allow proper cleanup when notifications are removed
const notificationTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

interface AppState {
  // Theme
  theme: Theme;
  setTheme: (theme: Theme) => void;

  // Selected Provider
  selectedProvider: ProviderName | null;
  setSelectedProvider: (provider: ProviderName | null) => void;

  // Providers list
  providers: Provider[];
  setProviders: (providers: Provider[]) => void;

  // Server status
  serverStatus: LLMServerStatus | null;
  setServerStatus: (status: LLMServerStatus | null) => void;

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
  { id: 'kiro', name: 'Kiro', version: 'v2.1', activeCount: 12, status: 'active', color: 'from-purple-500 to-indigo-600' },
  { id: 'windsurf', name: 'Windsurf', version: 'v1.4', activeCount: 4, status: 'active', color: 'from-cyan-400 to-blue-500' },
  { id: 'trae', name: 'Trae', version: 'v1.0', activeCount: 8, status: 'active', color: 'from-emerald-400 to-teal-600' },
  { id: 'qoder', name: 'Qoder', version: 'v0.8', activeCount: 0, status: 'down', color: 'from-slate-600 to-slate-700' },
  { id: 'cursor', name: 'Cursor', version: 'v0.9', activeCount: 22, status: 'active', color: 'from-slate-100 to-slate-300' },
];

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Theme
      theme: 'dark',
      setTheme: (theme) => {
        set({ theme });
        // Apply theme to document
        if (theme === 'dark') {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
      },

      // Selected Provider
      selectedProvider: null,
      setSelectedProvider: (provider) => set({ selectedProvider: provider }),

      // Providers
      providers: DEFAULT_PROVIDERS,
      setProviders: (providers) => set({ providers }),

      // Server status
      serverStatus: null,
      setServerStatus: (status) => set({ serverStatus: status }),

      // UI State
      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      // Notifications
      notifications: [],
      addNotification: (notification) => {
        const id = crypto.randomUUID();
        set((state) => ({
          notifications: [
            ...state.notifications,
            { ...notification, id, timestamp: Date.now() },
          ],
        }));
        // Auto-remove after 5 seconds with proper timeout tracking
        const timeoutId = setTimeout(() => {
          get().removeNotification(id);
        }, 5000);
        notificationTimeouts.set(id, timeoutId);
      },
      removeNotification: (id) => {
        // Clear the timeout if it exists to prevent memory leaks
        const timeoutId = notificationTimeouts.get(id);
        if (timeoutId) {
          clearTimeout(timeoutId);
          notificationTimeouts.delete(id);
        }
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        }));
      },
      clearNotifications: () => {
        // Clear all pending timeouts before clearing notifications
        notificationTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
        notificationTimeouts.clear();
        set({ notifications: [] });
      },
    }),
    {
      name: 'stitch-app-storage',
      partialize: (state) => ({
        theme: state.theme,
        selectedProvider: state.selectedProvider,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    }
  )
);
