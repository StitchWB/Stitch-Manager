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

interface AutoRegPagePreferences {
  activeTab: 'identity' | 'engine' | 'network' | 'automation';
  useRegistrationV2: boolean;

  isRunning: boolean; // Track if registration is in progress
  // Per-provider email settings
  providerEmailSettings: {
    [provider: string]: {
      emailStrategy: 'custom' | 'gmail' | 'addyio' | '33mail';
      addyioDomain?: string;
      thirtyThreeMailUsername?: string;
      gmailBase?: string;
    };
  };
}

interface UIPreferencesState {
  // Page-specific preferences
  accountsPage: AccountsPagePreferences;
  logsPage: LogsPagePreferences;
  serverPage: ServerPagePreferences;
  autoRegPage: AutoRegPagePreferences;

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

  // Actions for AutoReg page
  setAutoRegTab: (tab: 'identity' | 'engine' | 'network' | 'automation') => void;
  setAutoRegV2: (enabled: boolean) => void;

  setAutoRegRunning: (running: boolean) => void;
  setProviderEmailSettings: (
    provider: string,
    settings: Partial<AutoRegPagePreferences['providerEmailSettings'][string]>
  ) => void;
  resetAutoRegPreferences: () => void;

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

const defaultAutoRegPreferences: AutoRegPagePreferences = {
  activeTab: 'identity',
  useRegistrationV2: false,
  isRunning: false,
  providerEmailSettings: {},
};

// ============================================
// Store
// ============================================

export const useUIPreferencesStore = create<UIPreferencesState>()(
  persist(
    set => ({
      // Initial state
      accountsPage: defaultAccountsPreferences,
      logsPage: defaultLogsPreferences,
      serverPage: defaultServerPreferences,
      autoRegPage: defaultAutoRegPreferences,

      // ============================================
      // Accounts Page Actions
      // ============================================

      setAccountsProviderFilter: provider => {
        set(state => ({
          accountsPage: { ...state.accountsPage, providerFilter: provider },
        }));
      },

      setAccountsStatusFilter: status => {
        set(state => ({
          accountsPage: { ...state.accountsPage, statusFilter: status },
        }));
      },

      setAccountsQuotaFilter: quota => {
        set(state => ({
          accountsPage: { ...state.accountsPage, quotaFilter: quota },
        }));
      },

      setAccountsSearchQuery: query => {
        set(state => ({
          accountsPage: { ...state.accountsPage, searchQuery: query },
        }));
      },

      setAccountsSorting: (field, direction) => {
        set(state => ({
          accountsPage: { ...state.accountsPage, sortField: field, sortDirection: direction },
        }));
      },

      resetAccountsFilters: () => {
        set({ accountsPage: defaultAccountsPreferences });
      },

      // ============================================
      // Logs Page Actions
      // ============================================

      setLogsLevelFilter: level => {
        set(state => ({
          logsPage: { ...state.logsPage, levelFilter: level },
        }));
      },

      setLogsSourceFilter: source => {
        set(state => ({
          logsPage: { ...state.logsPage, sourceFilter: source },
        }));
      },

      setLogsSearchQuery: query => {
        set(state => ({
          logsPage: { ...state.logsPage, searchQuery: query },
        }));
      },

      resetLogsFilters: () => {
        set({ logsPage: defaultLogsPreferences });
      },

      // ============================================
      // Server Page Actions
      // ============================================

      setServerTab: tab => {
        set(state => ({
          serverPage: { ...state.serverPage, selectedTab: tab },
        }));
      },

      // ============================================
      // AutoReg Page Actions
      // ============================================

      setAutoRegTab: tab => {
        set(state => ({
          autoRegPage: { ...state.autoRegPage, activeTab: tab },
        }));
      },

      setAutoRegV2: enabled => {
        set(state => ({
          autoRegPage: { ...state.autoRegPage, useRegistrationV2: enabled },
        }));
      },

      setAutoRegRunning: running => {
        set(state => ({
          autoRegPage: { ...state.autoRegPage, isRunning: running },
        }));
      },

      setProviderEmailSettings: (provider, settings) => {
        set(state => ({
          autoRegPage: {
            ...state.autoRegPage,
            providerEmailSettings: {
              ...state.autoRegPage.providerEmailSettings,
              [provider]: {
                ...state.autoRegPage.providerEmailSettings[provider],
                ...settings,
              },
            },
          },
        }));
      },

      resetAutoRegPreferences: () => {
        set({ autoRegPage: defaultAutoRegPreferences });
      },

      // ============================================
      // Global Actions
      // ============================================

      resetAllPreferences: () => {
        set({
          accountsPage: defaultAccountsPreferences,
          logsPage: defaultLogsPreferences,
          serverPage: defaultServerPreferences,
          autoRegPage: defaultAutoRegPreferences,
        });
      },
    }),
    {
      name: 'ui-preferences-storage',
      version: 1,
    }
  )
);
