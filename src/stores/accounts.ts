import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import type { Account } from '../types/generated';
import type { ProviderName, AccountStatus } from '../types/ui';
import {
  getAccounts,
  addAccount,
  deleteAccount,
  archiveAccount,
  refreshAccountQuota,
  refreshAccounts,
  validateAccount,
  setActiveAccount,
  getActiveAccounts,
  bulkDeleteAccounts,
  BackendError,
} from '../lib/backend';
import { createLogger } from '../lib/observability/logger';
const log = createLogger('AccountsStore');

// ============================================
// Types
// ============================================

export interface ProviderQuotaInfo {
  limit: number;
  used: number;
  remaining: number;
  checkedAt: number; // timestamp
  status?: string; // e.g. suspendState for Fireworks
}

interface AccountsState {
  // State
  accounts: Account[];
  loading: boolean;
  error: string | null;
  selectedProvider: ProviderName | null;
  selectedIds: Set<number>;
  searchQuery: string;
  statusFilter: AccountStatus | null;
  quotaFilter: 'any' | 'has_quota' | 'empty' | 'full' | 'low_quota';

  // Active accounts per provider (provider -> accountId)
  activeAccountIds: Record<string, number | null>;

  // Sorting state
  sortField:
    | 'provider'
    | 'email'
    | 'status'
    | 'quota'
    | 'tokenExpires'
    | 'createdAt'
    | 'useCount'
    | 'loginCount'
    | 'lastLoginAt'
    | 'successRate';
  sortDirection: 'asc' | 'desc';

  // Provider-specific quota cache (for providers not supported by backend quota refresh)
  providerQuotaCache: Record<number, ProviderQuotaInfo>;

  // Quota check progress tracking (accountId -> true if checking)
  quotaCheckProgress: Record<number, boolean>;

  // Quota check errors (accountId -> error message)
  quotaCheckErrors: Record<number, string | null>;

  // Actions
  fetchAccounts: (provider?: ProviderName) => Promise<void>;
  addAccount: (
    provider: ProviderName,
    email: string,
    password: string,
    cookies?: string
  ) => Promise<Account>;
  deleteAccount: (accountId: number) => Promise<void>;
  archiveAccounts: (accountIds: number[], archived: boolean) => Promise<void>;
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
  setSelectedIds: (accountIds: number[]) => void;

  // Filters
  showArchived: boolean;
  setShowArchived: (show: boolean) => void;
  setSelectedProvider: (provider: ProviderName | null) => void;
  setSearchQuery: (query: string) => void;
  setStatusFilter: (status: AccountStatus | null) => void;
  setQuotaFilter: (filter: 'any' | 'has_quota' | 'empty' | 'full' | 'low_quota') => void;
  clearFilters: () => void;

  // Sorting
  setSortField: (
    field:
      | 'provider'
      | 'email'
      | 'status'
      | 'quota'
      | 'tokenExpires'
      | 'createdAt'
      | 'useCount'
      | 'loginCount'
      | 'lastLoginAt'
      | 'successRate'
  ) => void;
  setSortDirection: (direction: 'asc' | 'desc') => void;

  // Provider-specific quota
  setProviderQuota: (accountId: number, quota: ProviderQuotaInfo) => void;
  getProviderQuota: (accountId: number) => ProviderQuotaInfo | undefined;

  // Quota check progress
  setQuotaChecking: (accountId: number, checking: boolean) => void;
  setQuotaCheckError: (accountId: number, error: string | null) => void;
  clearQuotaCheckError: (accountId: number) => void;

  // Computed helpers
  getFilteredAccounts: () => Account[];
  getAccountsByProvider: (provider: ProviderName) => Account[];
  getAccountsNearQuotaLimit: () => Account[];
  refreshExpiredAccounts: () => Promise<void>;
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
        showArchived: false,
        activeAccountIds: {},
        sortField: 'email',
        sortDirection: 'asc',
        providerQuotaCache: {},
        quotaCheckProgress: {},
        quotaCheckErrors: {},

        // ============================================
        // Provider-specific quota cache
        // ============================================
        setProviderQuota: (accountId, quota) => {
          set(state => ({
            providerQuotaCache: {
              ...state.providerQuotaCache,
              [accountId]: quota,
            },
          }));
        },
        // Quota check progress
        setQuotaChecking: (accountId, checking) => {
          set(state => ({
            quotaCheckProgress: {
              ...state.quotaCheckProgress,
              [accountId]: checking,
            },
          }));
        },
        setQuotaCheckError: (accountId, error) => {
          set(state => ({
            quotaCheckErrors: {
              ...state.quotaCheckErrors,
              [accountId]: error,
            },
          }));
        },
        clearQuotaCheckError: accountId => {
          set(state => {
            const next = { ...state.quotaCheckErrors };
            delete next[accountId];
            return { quotaCheckErrors: next };
          });
        },
        getProviderQuota: accountId => {
          return get().providerQuotaCache[accountId];
        },

        // ============================================
        // Core Actions
        // ============================================

        fetchAccounts: async _provider => {
          set({ loading: true, error: null });
          try {
            const showArchived = get().showArchived;
            const accounts = await getAccounts({ showArchived });
            set({ accounts, loading: false });
            // Load active accounts after fetching
            await get().loadActiveAccounts();

            // Auto-refresh quota for accounts that have a token but no quota info.
            // Uses the single batch `refresh_accounts` command (bounded concurrency
            // on the backend) instead of fanning out N parallel single-account
            // calls. Fire-and-forget — does not block the UI.
            const accountsNeedingQuota = accounts.filter(
              a => a.token && a.quota?.limit === 0 && a.quota?.used === 0
            );
            if (accountsNeedingQuota.length > 0) {
              refreshAccounts({
                accountIds: accountsNeedingQuota.map(a => a.id),
              })
                .then(result => {
                  const updatedMap = new Map<string, Account>();
                  for (const r of result.results) {
                    if (r.ok && r.account) {
                      updatedMap.set(String(r.accountId), r.account);
                    }
                  }
                  if (updatedMap.size > 0) {
                    set(state => ({
                      accounts: state.accounts.map(a =>
                        updatedMap.has(String(a.id))
                          ? (updatedMap.get(String(a.id)) as Account)
                          : a
                      ),
                    }));
                  }
                })
                .catch(() => {
                  // Non-fatal: background quota refresh failure — UI stays usable
                });
            }
          } catch (error) {
            const message = error instanceof BackendError ? error.message : String(error);
            set({ error: message, loading: false });
            throw error;
          }
        },

        addAccount: async (provider, email, password, cookies) => {
          set({ loading: true, error: null });
          try {
            const newAccount = await addAccount({ provider, email, password, cookies });
            set(state => ({
              accounts: [...state.accounts, newAccount],
              loading: false,
            }));
            return newAccount;
          } catch (error) {
            const message = error instanceof BackendError ? error.message : String(error);
            set({ error: message, loading: false });
            throw error;
          }
        },

        deleteAccount: async accountId => {
          const previousAccounts = get().accounts;

          // Optimistic update
          set(state => ({
            accounts: state.accounts.filter(a => a.id !== accountId),
            selectedIds: new Set([...state.selectedIds].filter(id => id !== accountId)),
          }));

          try {
            await deleteAccount({ accountId });
          } catch (error) {
            // Rollback on error
            set({ accounts: previousAccounts });
            const message = error instanceof BackendError ? error.message : String(error);
            set({ error: message });
            throw error;
          }
        },

        archiveAccounts: async (accountIds, archived) => {
          const previousAccounts = get().accounts;

          // Optimistic update
          set(state => ({
            accounts: state.accounts.map(a =>
              accountIds.includes(a.id) ? { ...a, archived: archived ? 1 : 0 } : a
            ),
          }));

          try {
            await Promise.all(
              accountIds.map(id => archiveAccount({ accountId: id, archived }))
            );
            // Refresh accounts from backend to ensure consistency
            await get().fetchAccounts();
          } catch (error) {
            // Rollback on error
            set({ accounts: previousAccounts });
            const message = error instanceof BackendError ? error.message : String(error);
            set({ error: message });
            throw error;
          }
        },

        deleteAccounts: async accountIds => {
          log.debug('deleteAccounts called with:', accountIds);
          const previousAccounts = get().accounts;

          // Optimistic update
          set(state => ({
            accounts: state.accounts.filter(a => !accountIds.includes(a.id)),
            selectedIds: new Set([...state.selectedIds].filter(id => !accountIds.includes(id))),
          }));

          try {
            // Use bulk delete command
            const result = await bulkDeleteAccounts({ accountIds });
            log.debug('bulkDeleteAccounts result:', result);

            // If some deletions failed, show error but keep optimistic update for succeeded ones
            if (result.failed > 0) {
              const message = `Deleted ${result.succeeded}/${result.total} accounts. ${result.failed} failed.`;
              console.warn('[Store] Some deletions failed:', message);
              set({ error: message });
            }
          } catch (error) {
            // Rollback on error
            console.error('[Store] bulkDeleteAccounts error, rolling back:', error);
            set({ accounts: previousAccounts });
            const message = error instanceof BackendError ? error.message : String(error);
            set({ error: message });
            throw error;
          }
        },

        refreshAccount: async accountId => {
          try {
            const updatedAccount = await refreshAccountQuota({ accountId });
            set(state => ({
              accounts: state.accounts.map(a => (a.id === accountId ? updatedAccount : a)),
            }));

            return updatedAccount;
          } catch (error) {
            const message = error instanceof BackendError ? error.message : String(error);
            set({ error: message });
            throw error;
          }
        },

        refreshAllAccounts: async () => {
          const { accounts } = get();
          if (accounts.length === 0) return;

          set({ loading: true, error: null });

          // Mark all accounts as "checking" for progress UI
          const checkingMap: Record<number, boolean> = {};
          for (const a of accounts) checkingMap[Number(a.id)] = true;
          set({ quotaCheckProgress: checkingMap });

          void _ensureRefreshProgressListener();

          try {
            const result = await refreshAccounts({
              accountIds: accounts.map(a => a.id),
            });

            const updatedMap = new Map<string, Account>();
            for (const r of result.results) {
              if (r.ok && r.account) {
                updatedMap.set(String(r.accountId), r.account);
              }
            }

            set(state => ({
              accounts: state.accounts.map(a =>
                updatedMap.has(String(a.id)) ? (updatedMap.get(String(a.id)) as Account) : a
              ),
              loading: false,
              quotaCheckProgress: {},
            }));
          } catch (error) {
            const message = error instanceof BackendError ? error.message : String(error);
            set({ error: message, loading: false, quotaCheckProgress: {} });
            throw error;
          }
        },

        validateAccount: async accountId => {
          try {
            return await validateAccount({ accountId });
          } catch (error) {
            const message = error instanceof BackendError ? error.message : String(error);
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
            await setActiveAccount({ provider, accountId });

            // Update local state
            set(state => ({
              activeAccountIds: {
                ...state.activeAccountIds,
                [provider]: accountId,
              },
            }));
          } catch (error) {
            const message = error instanceof BackendError ? error.message : String(error);
            set({ error: message });
            throw error;
          }
        },

        getActiveAccount: provider => {
          const { accounts, activeAccountIds } = get();
          const activeId = activeAccountIds[provider];
          if (activeId === null || activeId === undefined) return undefined;
          return accounts.find(a => a.id === activeId);
        },

        loadActiveAccounts: async () => {
          try {
            const activeAccounts = await getActiveAccounts();
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

        toggleSelection: accountId => {
          set(state => {
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
          set({ selectedIds: new Set(filtered.map(a => a.id)) });
        },

        clearSelection: () => {
          set({ selectedIds: new Set() });
        },

        setSelectedIds: accountIds => {
          set({ selectedIds: new Set(accountIds) });
        },

        // ============================================
        // Filters
        // ============================================

        setSelectedProvider: provider => {
          set({ selectedProvider: provider, selectedIds: new Set() });
        },

        setSearchQuery: query => {
          set({ searchQuery: query });
        },

        setStatusFilter: status => {
          set({ statusFilter: status });
        },

        setQuotaFilter: filter => {
          set({ quotaFilter: filter });
        },

        setShowArchived: show => {
          set({ showArchived: show });
        },

        clearFilters: () => {
          set({
            selectedProvider: null,
            searchQuery: '',
            statusFilter: null,
            quotaFilter: 'any',
            showArchived: false,
            selectedIds: new Set(),
          });
        },

        // ============================================
        // Sorting
        // ============================================

        setSortField: field => {
          set({ sortField: field });
        },

        setSortDirection: direction => {
          set({ sortDirection: direction });
        },

        // ============================================
        // Computed Helpers
        // ============================================

        getFilteredAccounts: () => {
          const { accounts, selectedProvider, searchQuery, statusFilter, quotaFilter } = get();
          let result = accounts.filter(account => {
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
              if (!a.quota) return quotaFilter === 'empty';
              const remaining = a.quota.limit - a.quota.used;
              const hasQuota = remaining > 0;
              const isEmpty = a.quota.used === 0;
              const isFull = a.quota.limit > 0 && a.quota.used >= a.quota.limit;
              const isLowQuota = a.quota.limit > 0 && a.quota.used / a.quota.limit > 0.8;

              switch (quotaFilter) {
                case 'has_quota':
                  return hasQuota;
                case 'empty':
                  return isEmpty;
                case 'full':
                  return isFull;
                case 'low_quota':
                  return isLowQuota;
                default:
                  return true;
              }
            });
          }

          return result;
        },

        getAccountsByProvider: provider => {
          return get().accounts.filter(a => a.provider === provider);
        },

        // Get accounts with low quota (>80% used)
        getAccountsNearQuotaLimit: () => {
          return get().accounts.filter(a => {
            if (!a.quota || a.quota.limit <= 0) return false; // Skip unlimited/no-quota accounts
            const percentUsed = (a.quota.used / a.quota.limit) * 100;
            return percentUsed > 80;
          });
        },

        // Refresh all expired accounts
        refreshExpiredAccounts: async () => {
          const { accounts } = get();
          const expiredAccounts = accounts.filter(a => a.status === 'expired');

          if (expiredAccounts.length === 0) {
            return;
          }

          set({ loading: true, error: null });

          // Mark expired accounts as "checking" for progress UI
          const checkingMap: Record<number, boolean> = {};
          for (const a of expiredAccounts) checkingMap[Number(a.id)] = true;
          set({ quotaCheckProgress: checkingMap });

          void _ensureRefreshProgressListener();

          try {
            const result = await refreshAccounts({
              accountIds: expiredAccounts.map(a => a.id),
            });

            const updatedMap = new Map<string, Account>();
            for (const r of result.results) {
              if (r.ok && r.account) {
                updatedMap.set(String(r.accountId), r.account);
              }
            }

            set(state => ({
              accounts: state.accounts.map(a =>
                updatedMap.has(String(a.id)) ? (updatedMap.get(String(a.id)) as Account) : a
              ),
              loading: false,
              quotaCheckProgress: {},
            }));
          } catch (error) {
            const message = error instanceof BackendError ? error.message : String(error);
            set({ error: message, loading: false, quotaCheckProgress: {} });
            throw error;
          }
        },
      }),
      {
        name: 'accounts-store',
        partialize: state => ({
          activeAccountIds: state.activeAccountIds,
          selectedProvider: state.selectedProvider,
          statusFilter: state.statusFilter,
          quotaFilter: state.quotaFilter,
          sortField: state.sortField,
          sortDirection: state.sortDirection,
          providerQuotaCache: state.providerQuotaCache,
        }),
      }
    ),
    { name: 'accounts-store' }
  )
);

// ── Batch refresh progress listener ──────────────────────────────────────────
// Module-level listener for `accounts.refresh_progress` WS events emitted by
// the backend `refresh_accounts` command. Guarded against double-registration
// so multiple calls to refreshAllAccounts/refreshExpiredAccounts don't stack
// listeners. Updates `quotaCheckProgress` / `quotaCheckErrors` live as each
// account completes.

let _refreshProgressListenerRegistered = false;

async function _ensureRefreshProgressListener(): Promise<void> {
  if (_refreshProgressListenerRegistered) return;
  _refreshProgressListenerRegistered = true;

  const { listen } = await import('../lib/events/websocket');
  await listen<{
    accountId: string;
    done: number;
    total: number;
    ok: boolean;
    error?: string;
  }>('accounts.refresh_progress', event => {
    const { accountId, ok, error } = event.payload;
    const id = Number(accountId);
    useAccountsStore.setState(state => {
      const nextProgress = { ...state.quotaCheckProgress };
      delete nextProgress[id];
      if (!ok) {
        const nextErrors = { ...state.quotaCheckErrors };
        nextErrors[id] = error ?? 'Refresh failed';
        return { quotaCheckProgress: nextProgress, quotaCheckErrors: nextErrors };
      }
      return { quotaCheckProgress: nextProgress };
    });
  });
}