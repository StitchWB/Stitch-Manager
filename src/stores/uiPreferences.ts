import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ============================================
// Types
// ============================================

interface AccountsPagePreferences {
  providerFilter: string;
  statusFilter: string;
  quotaFilter: string;
  searchQuery: string;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
}

interface LogsPagePreferences {
  levelFilter: string;
  sourceFilter: string;
  searchQuery: string;
}

interface ServerPagePreferences {
  selectedTab?: string;
}

interface UIPreferencesState {
  // Page-specific preferences
  accountsPage: AccountsPagePreferences;
  logsPage: LogsPagePreferences;
  serverPage: ServerPagePreferences;

  // Actions for Accounts page
  setAccountsProviderFilter: (provider: string) => void;
  setAccountsStatusFilter: (status: string) => void;
  setAccountsQuotaFilter: (quota: string) => void;
  setAccountsSearchQuery: (query: string) => void;
  setAccountsSorting: (field: string, direction: 'asc' | 'desc') => void;
  resetAccountsFilters: () => void;

  // Actions for Logs page
  setLogsLevelFilter: (level: string) => void;
  setLogsSourceFilter: (source: string) => void;
  setLogsSearchQuery: (query: string) => void;
  resetLogsFilters: () => void;

  // Actions for Server page
  setServerTab: (tab: string) => void;

  // Global reset
  resetAllPreferences: () => void;
}

// ============================================
// Default Values
// ============================================

const defaultAccountsPreferences: AccountsPagePreferences = {
  providerFilter: 'all',
  statusFilter: 'all',
  quotaFilter: 'any',
  searchQuery: '',
  sortField: 'email',
  sortDirection: 'asc',
};

const defaultLogsPreferences: LogsPagePreferences = {
  levelFilter: 'all',
  sourceFilter: 'all',
  searchQuery: '',
};

const defaultServerPreferences: ServerPagePreferences = {
  selectedTab: 'status',
};

// ============================================
// Store
// ============================================

export const useUIPreferencesStore = create<UIPreferencesState>()(
  persist(
    (set) => ({
      // Initial state
      accountsPage: defaultAccountsPreferences,
      logsPage: defaultLogsPreferences,
      serverPage: defaultServerPreferences,

      // ============================================
      // Accounts Page Actions
      // ============================================

      setAccountsProviderFilter: (provider) => {
        set((state) => ({
          accountsPage: { ...state.accountsPage, providerFilter: provider },
        }));
      },

      setAccountsStatusFilter: (status) => {
        set((state) => ({
          accountsPage: { ...state.accountsPage, statusFilter: status },
        }));
      },

      setAccountsQuotaFilter: (quota) => {
        set((state) => ({
          accountsPage: { ...state.accountsPage, quotaFilter: quota },
        }));
      },

      setAccountsSearchQuery: (query) => {
        set((state) => ({
          accountsPage: { ...state.accountsPage, searchQuery: query },
        }));
      },

      setAccountsSorting: (field, direction) => {
        set((state) => ({
          accountsPage: { ...state.accountsPage, sortField: field, sortDirection: direction },
        }));
      },

      resetAccountsFilters: () => {
        set({ accountsPage: defaultAccountsPreferences });
      },

      // ============================================
      // Logs Page Actions
      // ============================================

      setLogsLevelFilter: (level) => {
        set((state) => ({
          logsPage: { ...state.logsPage, levelFilter: level },
        }));
      },

      setLogsSourceFilter: (source) => {
        set((state) => ({
          logsPage: { ...state.logsPage, sourceFilter: source },
        }));
      },

      setLogsSearchQuery: (query) => {
        set((state) => ({
          logsPage: { ...state.logsPage, searchQuery: query },
        }));
      },

      resetLogsFilters: () => {
        set({ logsPage: defaultLogsPreferences });
      },

      // ============================================
      // Server Page Actions
      // ============================================

      setServerTab: (tab) => {
        set((state) => ({
          serverPage: { ...state.serverPage, selectedTab: tab },
        }));
      },

      // ============================================
      // Global Actions
      // ============================================

      resetAllPreferences: () => {
        set({
          accountsPage: defaultAccountsPreferences,
          logsPage: defaultLogsPreferences,
          serverPage: defaultServerPreferences,
        });
      },
    }),
    {
      name: 'ui-preferences-storage',
      version: 1,
    }
  )
);
