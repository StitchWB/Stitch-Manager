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
  tagFilter: string;
  relationFilter: string;
  entityFilter: string;
  tableVisibleColumns: AccountsTableVisibleColumns;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
}

export interface AccountsTableVisibleColumns {
  lastLogin: boolean;
  proxy: boolean;
  tags: boolean;
}

interface LogsPagePreferences {
  levelFilter: string;
  sourceFilter: string[];
  channelFilter: string;
  searchQuery: string;
  selectedTab: 'stream' | 'grouped' | 'errors' | 'python';
  detailsPaneWidth: number;
  selectedLogId: string | null;
}

interface AutoRegPagePreferences {
  activeTab: 'identity' | 'engine' | 'network' | 'automation' | 'inbox';
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
  autoRegPage: AutoRegPagePreferences;

  // Actions for Accounts page
  setAccountsProviderFilter: (provider: string) => void;
  setAccountsStatusFilter: (status: string) => void;
  setAccountsQuotaFilter: (quota: string) => void;
  setAccountsSearchQuery: (query: string) => void;
  setAccountsTagFilter: (tag: string) => void;
  setAccountsRelationFilter: (relation: string) => void;
  setAccountsEntityFilter: (entity: string) => void;
  setAccountsVisibleColumns: (columns: Partial<AccountsTableVisibleColumns>) => void;
  setAccountsSorting: (field: string, direction: 'asc' | 'desc') => void;
  resetAccountsFilters: () => void;

  // Actions for Logs page
  setLogsLevelFilter: (level: string) => void;
  setLogsSourceFilter: (source: string[]) => void;
  setLogsChannelFilter: (channel: string) => void;
  setLogsSearchQuery: (query: string) => void;
  setLogsSelectedTab: (tab: 'stream' | 'grouped' | 'errors' | 'python') => void;
  setLogsDetailsPaneWidth: (width: number) => void;
  setLogsSelectedLogId: (logId: string | null) => void;
  resetLogsFilters: () => void;

  // Actions for AutoReg page
  setAutoRegTab: (tab: 'identity' | 'engine' | 'network' | 'automation' | 'inbox') => void;
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
  tagFilter: 'all',
  relationFilter: 'all',
  entityFilter: 'accounts',
  tableVisibleColumns: {
    lastLogin: true,
    proxy: true,
    tags: true,
  },
  sortField: 'email',
  sortDirection: 'asc',
};

const defaultLogsPreferences: LogsPagePreferences = {
  levelFilter: 'all',
  sourceFilter: [],
  channelFilter: 'all',
  searchQuery: '',
  selectedTab: 'grouped',
  detailsPaneWidth: 360,
  selectedLogId: null,
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

      setAccountsTagFilter: tag => {
        set(state => ({
          accountsPage: { ...state.accountsPage, tagFilter: tag },
        }));
      },

      setAccountsRelationFilter: relation => {
        set(state => ({
          accountsPage: { ...state.accountsPage, relationFilter: relation },
        }));
      },

      setAccountsEntityFilter: entity => {
        set(state => ({
          accountsPage: { ...state.accountsPage, entityFilter: entity },
        }));
      },

      setAccountsVisibleColumns: columns => {
        set(state => ({
          accountsPage: {
            ...state.accountsPage,
            tableVisibleColumns: {
              ...(state.accountsPage.tableVisibleColumns ??
                defaultAccountsPreferences.tableVisibleColumns),
              ...columns,
            },
          },
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

      setLogsChannelFilter: channel => {
        set(state => ({
          logsPage: { ...state.logsPage, channelFilter: channel },
        }));
      },

      setLogsSearchQuery: query => {
        set(state => ({
          logsPage: { ...state.logsPage, searchQuery: query },
        }));
      },

      setLogsSelectedTab: tab => {
        set(state => ({
          logsPage: { ...state.logsPage, selectedTab: tab },
        }));
      },

      setLogsDetailsPaneWidth: width => {
        set(state => ({
          logsPage: { ...state.logsPage, detailsPaneWidth: width },
        }));
      },

      setLogsSelectedLogId: logId => {
        set(state => ({
          logsPage: { ...state.logsPage, selectedLogId: logId },
        }));
      },

      resetLogsFilters: () => {
        set(state => ({
          logsPage: {
            ...state.logsPage,
            levelFilter: defaultLogsPreferences.levelFilter,
            sourceFilter: defaultLogsPreferences.sourceFilter,
            channelFilter: defaultLogsPreferences.channelFilter,
            searchQuery: defaultLogsPreferences.searchQuery,
          },
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
