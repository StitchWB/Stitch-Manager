import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { Account, ProviderName, AccountStatus } from '../types';
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
  statusFilter: AccountStatus | null;
  quotaFilter: 'any' | 'has_quota' | 'empty' | 'full';
  
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
  

  
  // Selection
  toggleSelection: (accountId: number) => void;
  selectAll: () => void;
  clearSelection: () => void;
  
  // Filters
  setSelectedProvider: (provider: ProviderName | null) => void;
  setSearchQuery: (query: string) => void;
  setStatusFilter: (status: AccountStatus | null) => void;
  setQuotaFilter: (filter: 'any' | 'has_quota' | 'empty' | 'full') => void;
  clearFilters: () => void;
  
  // Computed helpers
  getFilteredAccounts: () => Account[];
  getAccountsByProvider: (provider: ProviderName) => Account[];
  
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
        statusFilter: null,
        quotaFilter: 'any',
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
          await setActiveAccountTauri({ provider, accountId });
          
          // Update local state
          set((state) => ({
            activeAccountIds: {
              ...state.activeAccountIds,
              [provider]: accountId,
            },
          }));
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
      // Filters
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

      // ============================================
      // Filters
      // ============================================

      setSelectedProvider: (provider) => {
        set({ selectedProvider: provider, selectedIds: new Set() });
      },

      setSearchQuery: (query) => {
        set({ searchQuery: query });
      },

      setStatusFilter: (status) => {
        set({ statusFilter: status });
      },

      setQuotaFilter: (filter) => {
        set({ quotaFilter: filter });
      },

      clearFilters: () => {
        set({ 
          selectedProvider: null, 
          searchQuery: '', 
          statusFilter: null, 
          quotaFilter: 'any',
          selectedIds: new Set() 
        });
      },

      // ============================================
      // Computed Helpers
      // ============================================

      getFilteredAccounts: () => {
        const { accounts, selectedProvider, searchQuery, statusFilter, quotaFilter } = get();
        let result = accounts.filter((account) => {
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

        // Status filter
        if (statusFilter) {
          result = result.filter(a => a.status === statusFilter);
        }

        // Quota filter (simplified logic)
        if (quotaFilter !== 'any') {
          result = result.filter(a => {
            const remaining = a.quota.limit - a.quota.used;
            const hasQuota = remaining > 0;
            const isEmpty = a.quota.used === 0;
            const isFull = a.quota.limit > 0 && a.quota.used >= a.quota.limit;
            
            switch (quotaFilter) {
              case 'has_quota': return hasQuota;
              case 'empty': return isEmpty;
              case 'full': return isFull;
              default: return true;
            }
          });
        }

        return result;
      },

      getAccountsByProvider: (provider) => {
        return get().accounts.filter((a) => a.provider === provider);
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


