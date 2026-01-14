import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { Account, ProviderName } from '../types';
import {
  listAccounts,
  addAccount,
  deleteAccount,
  refreshAccountQuota,
  validateAccount,
  setActiveAccount as setActiveAccountTauri,
  getActiveAccounts as getActiveAccountsTauri,
  // Note: These functions are defined in tauri.ts but not yet implemented in Rust backend
  // importAccounts,
  // exportAccounts,
  TauriError,
} from '../lib/tauri';

// ============================================
// Types
// ============================================

interface AccountsState {
  // State
  accounts: Account[];
  loading: boolean;
  error: string | null;
  selectedProvider: ProviderName | null;
  selectedIds: Set<number>;
  searchQuery: string;
  
  // Active accounts per provider (provider -> accountId)
  activeAccountIds: Record<string, number | null>;
  
  // Actions
  fetchAccounts: (provider?: ProviderName) => Promise<void>;
  addAccount: (provider: ProviderName, email: string, password: string) => Promise<Account>;
  deleteAccount: (accountId: number) => Promise<void>;
  deleteAccounts: (accountIds: number[]) => Promise<void>;
  refreshAccount: (accountId: number) => Promise<Account>;
  refreshAllAccounts: () => Promise<void>;
  validateAccount: (accountId: number) => Promise<boolean>;
  
  // Active account management
  setActiveAccount: (provider: string, accountId: number | null) => Promise<void>;
  getActiveAccount: (provider: string) => Account | undefined;
  loadActiveAccounts: () => Promise<void>;
  
  // Import/Export
  importFromFile: (filePath: string) => Promise<Account[]>;
  exportToFile: (filePath: string, format?: 'json' | 'csv') => Promise<void>;
  
  // Selection
  toggleSelection: (accountId: number) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setSelectedIds: (ids: Set<number>) => void;
  
  // Filters
  setSelectedProvider: (provider: ProviderName | null) => void;
  setSearchQuery: (query: string) => void;
  
  // Computed helpers
  getFilteredAccounts: () => Account[];
  getAccountById: (id: number) => Account | undefined;
  getAccountsByProvider: (provider: ProviderName) => Account[];
  getActiveAccounts: () => Account[];
  getAccountStats: () => AccountStats;
  
  // Error handling
  clearError: () => void;
  setError: (error: string | null) => void;
}

interface AccountStats {
  total: number;
  active: number;
  banned: number;
  limitHit: number;
  expired: number;
  byProvider: Record<ProviderName, number>;
}

// ============================================
// Store
// ============================================

export const useAccountsStore = create<AccountsState>()(
  devtools(
    persist(
      (set, get) => ({
        // Initial state
        accounts: [],
        loading: false,
        error: null,
        selectedProvider: null,
        selectedIds: new Set(),
        searchQuery: '',
        activeAccountIds: {},

        // ============================================
        // Core Actions
        // ============================================

        fetchAccounts: async (provider) => {
          set({ loading: true, error: null });
          try {
            const accounts = await listAccounts({ provider });
            set({ accounts, loading: false });
            // Load active accounts after fetching
            await get().loadActiveAccounts();
          } catch (error) {
            const message = error instanceof TauriError ? error.message : String(error);
            set({ error: message, loading: false });
            throw error;
          }
        },

      addAccount: async (provider, email, password) => {
        set({ loading: true, error: null });
        try {
          const newAccount = await addAccount({ provider, email, password });
          set((state) => ({
            accounts: [...state.accounts, newAccount],
            loading: false,
          }));
          return newAccount;
        } catch (error) {
          const message = error instanceof TauriError ? error.message : String(error);
          set({ error: message, loading: false });
          throw error;
        }
      },

      deleteAccount: async (accountId) => {
        const previousAccounts = get().accounts;
        
        // Optimistic update
        set((state) => ({
          accounts: state.accounts.filter((a) => a.id !== accountId),
          selectedIds: new Set([...state.selectedIds].filter((id) => id !== accountId)),
        }));

        try {
          await deleteAccount({ accountId });
        } catch (error) {
          // Rollback on error
          set({ accounts: previousAccounts });
          const message = error instanceof TauriError ? error.message : String(error);
          set({ error: message });
          throw error;
        }
      },

      deleteAccounts: async (accountIds) => {
        const previousAccounts = get().accounts;
        
        // Optimistic update
        set((state) => ({
          accounts: state.accounts.filter((a) => !accountIds.includes(a.id)),
          selectedIds: new Set([...state.selectedIds].filter((id) => !accountIds.includes(id))),
        }));

        try {
          // Delete accounts in parallel
          await Promise.all(accountIds.map((id) => deleteAccount({ accountId: id })));
        } catch (error) {
          // Rollback on error
          set({ accounts: previousAccounts });
          const message = error instanceof TauriError ? error.message : String(error);
          set({ error: message });
          throw error;
        }
      },

      refreshAccount: async (accountId) => {
        try {
          const updatedAccount = await refreshAccountQuota({ accountId });
          set((state) => ({
            accounts: state.accounts.map((a) =>
              a.id === accountId ? updatedAccount : a
            ),
          }));
          
          return updatedAccount;
        } catch (error) {
          const message = error instanceof TauriError ? error.message : String(error);
          set({ error: message });
          throw error;
        }
      },

      refreshAllAccounts: async () => {
        const { accounts } = get();
        set({ loading: true, error: null });
        
        try {
          const results = await Promise.allSettled(
            accounts.map((account) => refreshAccountQuota({ accountId: account.id }))
          );
          
          const updatedAccounts = accounts.map((account, index) => {
            const result = results[index];
            if (result.status === 'fulfilled') {
              return result.value;
            }
            return account;
          });
          
          set({ accounts: updatedAccounts, loading: false });
        } catch (error) {
          const message = error instanceof TauriError ? error.message : String(error);
          set({ error: message, loading: false });
          throw error;
        }
      },

      validateAccount: async (accountId) => {
        try {
          return await validateAccount({ accountId });
        } catch (error) {
          const message = error instanceof TauriError ? error.message : String(error);
          set({ error: message });
          throw error;
        }
      },

      // ============================================
      // Active Account Management
      // ============================================

      setActiveAccount: async (provider, accountId) => {
        try {
          // Call backend to persist and apply the active account
          const result = await setActiveAccountTauri({ provider, accountId });
          
          // Update local state
          set((state) => ({
            activeAccountIds: {
              ...state.activeAccountIds,
              [provider]: accountId,
            },
          }));
          
          // Log result for debugging
          if (result.success) {
            console.log(`[AccountsStore] Token written to: ${result.token_path}`);
            if (result.client_path) {
              console.log(`[AccountsStore] Client credentials written to: ${result.client_path}`);
            }
          }
        } catch (error) {
          const message = error instanceof TauriError ? error.message : String(error);
          set({ error: message });
          throw error;
        }
      },

      getActiveAccount: (provider) => {
        const { accounts, activeAccountIds } = get();
        const activeId = activeAccountIds[provider];
        if (activeId === null || activeId === undefined) return undefined;
        return accounts.find((a) => a.id === activeId);
      },

      loadActiveAccounts: async () => {
        try {
          const activeAccounts = await getActiveAccountsTauri();
          // activeAccounts is Record<string, number | null>
          set({ activeAccountIds: activeAccounts });
        } catch (error) {
          // Silently fail - active accounts are optional
          console.warn('Failed to load active accounts:', error);
        }
      },

      // ============================================
      // Import/Export
      // ============================================

      // Note: importAccounts not yet implemented in Rust backend
      // Would require file format specification and validation logic
      importFromFile: async (_filePath) => {
        // set({ loading: true, error: null });
        // try {
        //   const importedAccounts = await importAccounts({ filePath });
        //   set((state) => ({
        //     accounts: [...state.accounts, ...importedAccounts],
        //     loading: false,
        //   }));
        //   return importedAccounts;
        // } catch (error) {
        //   const message = error instanceof TauriError ? error.message : String(error);
        //   set({ error: message, loading: false });
        //   throw error;
        // }
        throw new Error('importFromFile: Rust command not implemented');
      },

      // Note: exportAccounts not yet implemented in Rust backend
      // Would require export format implementation (JSON/CSV)
      exportToFile: async (_filePath, _format = 'json') => {
        // const { selectedProvider } = get();
        // try {
        //   await exportAccounts({ filePath, provider: selectedProvider ?? undefined, format });
        // } catch (error) {
        //   const message = error instanceof TauriError ? error.message : String(error);
        //   set({ error: message });
        //   throw error;
        // }
        throw new Error('exportToFile: Rust command not implemented');
      },

      // ============================================
      // Selection
      // ============================================

      toggleSelection: (accountId) => {
        set((state) => {
          const newSelected = new Set(state.selectedIds);
          if (newSelected.has(accountId)) {
            newSelected.delete(accountId);
          } else {
            newSelected.add(accountId);
          }
          return { selectedIds: newSelected };
        });
      },

      selectAll: () => {
        const filtered = get().getFilteredAccounts();
        set({ selectedIds: new Set(filtered.map((a) => a.id)) });
      },

      clearSelection: () => {
        set({ selectedIds: new Set() });
      },

      setSelectedIds: (ids) => {
        set({ selectedIds: ids });
      },

      // ============================================
      // Filters
      // ============================================

      setSelectedProvider: (provider) => {
        set({ selectedProvider: provider, selectedIds: new Set() });
      },

      setSearchQuery: (query) => {
        set({ searchQuery: query });
      },

      // ============================================
      // Computed Helpers
      // ============================================

      getFilteredAccounts: () => {
        const { accounts, selectedProvider, searchQuery } = get();
        return accounts.filter((account) => {
          // Filter by provider
          if (selectedProvider && account.provider !== selectedProvider) {
            return false;
          }
          // Filter by search query
          if (searchQuery) {
            const query = searchQuery.toLowerCase();
            return (
              account.email.toLowerCase().includes(query) ||
              (account.token?.toLowerCase().includes(query) ?? false) ||
              String(account.id).includes(query) ||
              account.provider.toLowerCase().includes(query)
            );
          }
          return true;
        });
      },

      getAccountById: (id) => {
        return get().accounts.find((a) => a.id === id);
      },

      getAccountsByProvider: (provider) => {
        return get().accounts.filter((a) => a.provider === provider);
      },

      getActiveAccounts: () => {
        return get().accounts.filter((a) => a.status === 'active');
      },

      getAccountStats: () => {
        const { accounts } = get();
        const stats: AccountStats = {
          total: accounts.length,
          active: 0,
          banned: 0,
          limitHit: 0,
          expired: 0,
          byProvider: {} as Record<ProviderName, number>,
        };

        for (const account of accounts) {
          // Count by status
          switch (account.status) {
            case 'active':
              stats.active++;
              break;
            case 'banned':
              stats.banned++;
              break;
            case 'limit_hit':
              stats.limitHit++;
              break;
            case 'expired':
              stats.expired++;
              break;
          }

          // Count by provider
          stats.byProvider[account.provider] = (stats.byProvider[account.provider] || 0) + 1;
        }

        return stats;
      },

      // ============================================
      // Error Handling
      // ============================================

      clearError: () => {
        set({ error: null });
      },

      setError: (error) => {
        set({ error });
      },
    }),
    { 
      name: 'accounts-store',
      partialize: (state) => ({ 
        activeAccountIds: state.activeAccountIds 
      }),
    }
  ),
  { name: 'accounts-store' }
  )
);

// ============================================
// Selectors (for performance optimization)
// ============================================

export const selectAccounts = (state: AccountsState) => state.accounts;
export const selectLoading = (state: AccountsState) => state.loading;
export const selectError = (state: AccountsState) => state.error;
export const selectSelectedProvider = (state: AccountsState) => state.selectedProvider;
export const selectSelectedIds = (state: AccountsState) => state.selectedIds;
export const selectSearchQuery = (state: AccountsState) => state.searchQuery;
export const selectActiveAccountIds = (state: AccountsState) => state.activeAccountIds;
