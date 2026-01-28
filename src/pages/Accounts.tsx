import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, RefreshCw, Download, Users, AlertCircle, LayoutGrid } from 'lucide-react';
import Header from '../components/layout/Header';
import AccountsTable from '../components/AccountsTable';
import AddAccountModal from '../components/AddAccountModal';
import { QuotaFilterChip } from '../components/ui/FilterChip';
import { useAccountsStore } from '../stores/accounts';
import { useAppStore } from '../stores/app';
import { useLogsStore } from '../stores/logs';
import { useUIPreferencesStore } from '../stores/uiPreferences';
import {
  copyToClipboard,
  checkAccountStatus,
  getAccounts,
  openAccountBrowser,
  bulkExportAccounts,
  type GetAccountsParams,
} from '../lib/tauri';
import { t } from '../lib/i18n';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';
import { useBulkRefresh } from '../hooks/useBulkRefresh';
import type { ProviderName, Account } from '../types';
import { ProviderLogo } from '../components/ui/ProviderLogo';
import { cn } from '../lib/utils';

export default function Accounts() {
  const navigate = useNavigate();
  const { language } = useAppStore();
  const { addLog } = useLogsStore();
  const {
    loading: isLoading,
    error: storeError,
    selectedIds,
    toggleSelection,
    selectAll,
    clearSelection,
    fetchAccounts,
    addAccount: createAccount,
    deleteAccount: removeAccount,
    deleteAccounts: removeSelectedAccounts,
    refreshAccount,
    refreshExpiredAccounts,
    activeAccountIds,
    setActiveAccount,
  } = useAccountsStore();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [isRefreshingExpired, setIsRefreshingExpired] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const { copy } = useCopyToClipboard();

  // Bulk refresh hook
  const {
    startBulkRefresh,
    isRefreshing: isBulkRefreshing,
    progress: bulkProgress,
    isAccountRefreshing,
  } = useBulkRefresh({
    concurrency: 3,
    delayMs: 500,
  });

  // UI preferences from store (persisted in localStorage)
  const {
    accountsPage: {
      providerFilter,
      statusFilter,
      quotaFilter,
      searchQuery,
    },
    setAccountsProviderFilter,
    setAccountsStatusFilter,
    setAccountsQuotaFilter,
    setAccountsSearchQuery,
  } = useUIPreferencesStore();

  // Provider counts for sidebar
  const providerCounts = useMemo(() => {
    const counts: Record<string, number> = { all: 0 };
    accounts.forEach(acc => {
      counts.all++;
      counts[acc.provider] = (counts[acc.provider] || 0) + 1;
    });
    return counts;
  }, [accounts]);

  // Custom fetch function that uses the new getAccounts API with filtering
  const fetchAccountsWithFilter = useCallback(async () => {
    try {
      const params: GetAccountsParams = {};

      if (providerFilter !== 'all') {
        // Map filter values to actual provider names in database
        let providerSubtype: string = providerFilter;
        if (providerFilter === 'aws') {
          providerSubtype = 'aws_builder_id'; // Map 'aws' filter to 'aws_builder_id' provider
        }

        params.providerSubtype = providerSubtype as any;

        // Set provider_type based on subtype
        if (['kiro', 'windsurf', 'trae'].includes(providerFilter)) {
          params.providerType = 'ide';
        } else if (providerFilter === 'aws') {
          params.providerType = 'cloud';
        } else if (providerFilter === 'github') {
          params.providerType = 'git';
        }
      }

      const data = await getAccounts(params);
      setAccounts(data);
    } catch (error) {
      console.error('Failed to fetch accounts:', error);
      const { addNotification } = useAppStore.getState();
      addNotification({
        type: 'error',
        title: 'Failed to fetch accounts',
        message: String(error),
      });
    }
  }, [providerFilter]);

  // Apply client-side filters (search, status, quota)
  const filteredAccounts = useMemo(() => {
    let filtered = [...accounts];

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        acc => acc.email.toLowerCase().includes(query) || acc.provider.toLowerCase().includes(query)
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(acc => acc.status === statusFilter);
    }

    // Quota filter
    if (quotaFilter === 'low_quota') {
      filtered = filtered.filter(
        acc => acc.quota && acc.quota.limit > 0 && acc.quota.used / acc.quota.limit > 0.8
      );
    } else if (quotaFilter === 'has_quota') {
      filtered = filtered.filter(
        acc => acc.quota && acc.quota.limit > 0 && acc.quota.used / acc.quota.limit < 0.5
      );
    } else if (quotaFilter === 'empty') {
      filtered = filtered.filter(acc => !acc.quota || acc.quota.used === 0);
    } else if (quotaFilter === 'full') {
      filtered = filtered.filter(
        acc => acc.quota && acc.quota.limit > 0 && acc.quota.used >= acc.quota.limit
      );
    }

    return filtered;
  }, [accounts, searchQuery, statusFilter, quotaFilter]);

  // Get all accounts to count expired ones
  const allAccounts = useAccountsStore.getState().accounts;
  const expiredCount = allAccounts.filter(a => a.status === 'expired').length;

  // Force re-render when language changes
  void language; // Force re-render on language change

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  // Fetch accounts when provider filter changes
  useEffect(() => {
    fetchAccountsWithFilter();
  }, [fetchAccountsWithFilter, providerFilter]);

  // Keyboard shortcuts for accounts page
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Delete key - delete selected accounts (with confirmation)
      if (e.key === 'Delete' && selectedIds.size > 0) {
        e.preventDefault();
        if (
          window.confirm(
            t('accounts.confirmDeleteSelected', { count: selectedIds.size }) ||
              `Delete ${selectedIds.size} selected account(s)?`
          )
        ) {
          removeSelectedAccounts([...selectedIds]);
        }
      }

      // 'r' key - refresh selected accounts
      if (e.key === 'r' && selectedIds.size > 0 && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        selectedIds.forEach(id => refreshAccount(id));
      }

      // 'a' key - select all / deselect all
      if (e.key === 'a' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        if (selectedIds.size === filteredAccounts.length) {
          clearSelection();
        } else {
          selectAll();
        }
      }

      // Escape key - clear selection
      if (e.key === 'Escape' && selectedIds.size > 0) {
        e.preventDefault();
        clearSelection();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [
    selectedIds,
    filteredAccounts.length,
    selectAll,
    clearSelection,
    removeSelectedAccounts,
    refreshAccount,
  ]);

  const handleAddAccount = async (data: {
    provider: ProviderName;
    email: string;
    password: string;
    token?: string;
  }) => {
    try {
      await createAccount(data.provider, data.email, data.password);
      const { addNotification } = useAppStore.getState();
      addNotification({
        type: 'success',
        title: t('notifications.accountAdded'),
        message: `${data.email} (${data.provider})`,
      });
      addLog({
        level: 'success',
        message: `Account added: ${data.email} (${data.provider})`,
        source: 'accounts',
      });
    } catch (error) {
      console.error('Failed to add account:', error);
      const { addNotification } = useAppStore.getState();
      addNotification({
        type: 'error',
        title: t('notifications.addFailed'),
        message: String(error),
      });
      addLog({
        level: 'error',
        message: `Failed to add account: ${String(error)}`,
        source: 'accounts',
      });
    }
  };

  const handleRefreshToken = async (accountId: number) => {
    try {
      await refreshAccount(accountId);
    } catch (error) {
      console.error('Failed to refresh token:', error);
      const { addNotification } = useAppStore.getState();
      addNotification({
        type: 'error',
        title: t('notifications.refreshFailed'),
        message: String(error),
      });
    }
  };

  const handleRefreshAll = async () => {
    setIsRefreshingAll(true);
    try {
      // Use useBulkRefresh for deep status check
      await startBulkRefresh(filteredAccounts.map(a => a.id));
    } finally {
      setIsRefreshingAll(false);
    }
  };

  const handleRefreshExpired = async () => {
    setIsRefreshingExpired(true);
    try {
      await refreshExpiredAccounts();
      const { addNotification } = useAppStore.getState();
      addNotification({
        type: 'success',
        title: t('notifications.refreshComplete'),
        message: `Refreshed ${expiredCount} expired account${expiredCount !== 1 ? 's' : ''}`,
      });
    } catch (error) {
      console.error('Failed to refresh expired accounts:', error);
      const { addNotification } = useAppStore.getState();
      addNotification({
        type: 'error',
        title: t('notifications.refreshFailed'),
        message: String(error),
      });
    } finally {
      setIsRefreshingExpired(false);
    }
  };

  const handleCopyToken = useCallback(
    async (token: string) => {
      try {
        await copyToClipboard({ text: token });
      } catch {
        // Fallback to direct clipboard API
        await copy(token);
      }
    },
    [copy]
  );

  const handleDelete = async (accountId: number) => {
    try {
      const account = filteredAccounts.find(a => a.id === accountId);
      await removeAccount(accountId);
      addLog({
        level: 'info',
        message: `Account deleted: ${account?.email || accountId}`,
        source: 'accounts',
      });
    } catch (error) {
      console.error('Failed to delete account:', error);
      const { addNotification } = useAppStore.getState();
      addNotification({
        type: 'error',
        title: t('notifications.deleteFailed'),
        message: String(error),
      });
      addLog({
        level: 'error',
        message: `Failed to delete account: ${String(error)}`,
        source: 'accounts',
      });
    }
  };

  const handleActivate = async (provider: string, accountId: number | null) => {
    try {
      await setActiveAccount(provider, accountId);
      // Show success notification
      const { addNotification } = useAppStore.getState();
      if (accountId) {
        const account = filteredAccounts.find(a => a.id === accountId);
        addNotification({
          type: 'success',
          title: t('notifications.accountActivated'),
          message: account ? `${account.email} → ${provider}` : provider,
        });
        addLog({
          level: 'success',
          message: `Account activated: ${account?.email || accountId} for ${provider}`,
          source: 'accounts',
        });
      } else {
        addNotification({
          type: 'info',
          title: t('notifications.accountDeactivated'),
          message: provider,
        });
        addLog({
          level: 'info',
          message: `Account deactivated for ${provider}`,
          source: 'accounts',
        });
      }
    } catch (error) {
      console.error('Failed to activate account:', error);
      const { addNotification } = useAppStore.getState();
      addNotification({
        type: 'error',
        title: t('notifications.activationFailed'),
        message: String(error),
      });
      addLog({
        level: 'error',
        message: `Failed to activate account: ${String(error)}`,
        source: 'accounts',
      });
    }
  };

  const handleCheckStatus = async (accountId: number) => {
    try {
      const { addNotification } = useAppStore.getState();
      const account = filteredAccounts.find(a => a.id === accountId);

      if (!account) {
        addNotification({
          type: 'error',
          title: 'Account not found',
          message: `Account ID ${accountId} not found`,
        });
        return;
      }

      addNotification({
        type: 'info',
        title: 'Checking status...',
        message: `Checking ${account.provider} account: ${account.email}`,
      });

      const statusInfo = await checkAccountStatus({ accountId });

      if (!statusInfo || typeof statusInfo !== 'object') {
        throw new Error('Invalid response from server');
      }

      // Force refresh account data from store/DB to update UI
      // We do this immediately after checkAccountStatus succeeds, as DB is already updated by backend
      const updatedAccount = await useAccountsStore.getState().refreshAccount(accountId);

      // Update local state if needed (though store update should trigger re-render)
      setAccounts(prev => prev.map(a => (a.id === accountId ? updatedAccount : a)));

      // Show detailed status notification
      const quotaText =
        statusInfo.quotaLimit < 0
          ? 'Unlimited'
          : `${statusInfo.quotaUsed}/${statusInfo.quotaLimit} (${Math.round(statusInfo.quotaPercent)}%)`;

      const flowText =
        statusInfo.flowCreditsLimit !== undefined
          ? `\nFlow: ${statusInfo.flowCreditsUsed}/${statusInfo.flowCreditsLimit < 0 ? '∞' : statusInfo.flowCreditsLimit}`
          : '';

      addNotification({
        type: statusInfo.isActive ? 'success' : 'warning',
        title: `${statusInfo.provider.toUpperCase()} Status`,
        message: `${statusInfo.email}\nStatus: ${statusInfo.isActive ? 'Active' : 'Inactive/Banned'}\nPlan: ${statusInfo.plan}\nQuota: ${quotaText}${flowText}`,
      });
    } catch (error) {
      console.error('Failed to check account status:', error);
      const { addNotification } = useAppStore.getState();
      addNotification({
        type: 'error',
        title: 'Status Check Failed',
        message: String(error),
      });
    }
  };

  const handleOpenBrowser = async (accountId: number) => {
    console.log('[Accounts] Opening browser for account:', accountId);
    try {
      console.log('[Accounts] Calling openAccountBrowser...');
      await openAccountBrowser({ accountId });
      console.log('[Accounts] Browser opened successfully');
      
      const { addNotification } = useAppStore.getState();
      addNotification({
        type: 'success',
        title: 'Browser opened',
        message: `Browser opened for account ${accountId}`,
      });
    } catch (error) {
      console.error('[Accounts] Failed to open browser:', error);
      const { addNotification } = useAppStore.getState();
      addNotification({
        type: 'error',
        title: 'Failed to open browser',
        message: String(error),
      });
    }
  };

  const handleExportCSV = async () => {
    try {
      // If accounts are selected, use bulk export; otherwise export all filtered accounts
      const accountsToExport = selectedIds.size > 0 
        ? Array.from(selectedIds) 
        : filteredAccounts.map(a => a.id);
      
      if (accountsToExport.length === 0) {
        const { addNotification } = useAppStore.getState();
        addNotification({
          type: 'warning',
          title: 'No accounts to export',
          message: 'Please select accounts or adjust filters',
        });
        return;
      }

      // Use bulk export command
      const csvContent = await bulkExportAccounts({
        accountIds: accountsToExport,
        format: 'csv',
      });

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `accounts_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      const { addNotification } = useAppStore.getState();
      addNotification({
        type: 'success',
        title: 'Export successful',
        message: `Exported ${accountsToExport.length} account(s)`,
      });
    } catch (error) {
      console.error('Failed to export accounts:', error);
      const { addNotification } = useAppStore.getState();
      addNotification({
        type: 'error',
        title: 'Export failed',
        message: String(error),
      });
    }
  };

  const SidebarItem = ({ id, label, icon: Icon }: { id: string; label: string; icon?: any }) => (
    <button
      onClick={() => setAccountsProviderFilter(id)}
      className={cn(
        'w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all',
        providerFilter === id
          ? 'bg-indigo-500/20 text-white border border-indigo-500/30 shadow-[0_0_10px_rgba(99,102,241,0.1)]'
          : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent'
      )}
    >
      <div className="flex items-center gap-2.5">
        {Icon ? (
          <Icon
            size={14}
            className={providerFilter === id ? 'text-indigo-400' : 'text-slate-500'}
          />
        ) : (
          <ProviderLogo provider={id as any} size={14} colored={providerFilter === id} />
        )}
        <span>{label}</span>
      </div>
      {(providerCounts[id] || 0) > 0 && (
        <span
          className={cn(
            'px-1.5 py-0.5 rounded text-[10px]',
            providerFilter === id
              ? 'bg-indigo-500/30 text-indigo-300'
              : 'bg-white/10 text-slate-500'
          )}
        >
          {providerCounts[id]}
        </span>
      )}
    </button>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header title={t('accounts.title')} icon={<Users size={18} />} />

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar Filters */}
        <div className="w-[200px] shrink-0 border-r border-white/5 bg-slate-900/30 p-3 flex flex-col gap-1 overflow-y-auto">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold px-3 py-2">
            Providers
          </div>

          <SidebarItem id="all" label="All Accounts" icon={LayoutGrid} />
          <SidebarItem id="kiro" label="Kiro" />
          <SidebarItem id="windsurf" label="Windsurf" />
          <SidebarItem id="trae" label="Trae" />
          <SidebarItem id="aws" label="AWS Builder ID" />
          <SidebarItem id="github" label="GitHub" />

          <div className="h-px bg-white/5 my-2 mx-3" />

          <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold px-3 py-2">
            Status
          </div>

          {/* Status Filters - Minimal visual representation in sidebar */}
          <div className="space-y-1">
            <button
              onClick={() => setAccountsStatusFilter('all')}
              className={cn(
                'w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs transition-colors',
                statusFilter === 'all'
                  ? 'text-white bg-white/5'
                  : 'text-slate-400 hover:text-slate-200'
              )}
            >
              <span>Any Status</span>
            </button>
            <button
              onClick={() => setAccountsStatusFilter('active')}
              className={cn(
                'w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs transition-colors',
                statusFilter === 'active'
                  ? 'text-emerald-400 bg-emerald-500/10'
                  : 'text-slate-400 hover:text-emerald-400/80'
              )}
            >
              <span>Active</span>
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            </button>
            <button
              onClick={() => setAccountsStatusFilter('banned')}
              className={cn(
                'w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs transition-colors',
                statusFilter === 'banned'
                  ? 'text-red-400 bg-red-500/10'
                  : 'text-slate-400 hover:text-red-400/80'
              )}
            >
              <span>Banned</span>
              <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
            </button>
            <button
              onClick={() => setAccountsStatusFilter('expired')}
              className={cn(
                'w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs transition-colors',
                statusFilter === 'expired'
                  ? 'text-amber-400 bg-amber-500/10'
                  : 'text-slate-400 hover:text-amber-400/80'
              )}
            >
              <span>Expired</span>
              <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden bg-slate-950/30">
          <div className="p-4 flex flex-col h-full overflow-hidden">
            {/* Error Alert */}
            {storeError && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-3 shrink-0">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span className="text-xs text-red-400 flex-1">{storeError}</span>
                <button
                  onClick={() => useAccountsStore.setState({ error: null })}
                  className="text-red-400 hover:text-red-300 text-xs shrink-0"
                >
                  {t('common.dismiss')}
                </button>
              </div>
            )}

            {/* Expired Accounts Warning */}
            {expiredCount > 0 && (
              <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center gap-3 shrink-0">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="text-xs text-amber-300 flex-1">
                  {expiredCount} {expiredCount === 1 ? 'account requires' : 'accounts require'}{' '}
                  re-authentication. Refresh tokens have expired.
                </span>
                <button
                  onClick={handleRefreshExpired}
                  disabled={isRefreshingExpired}
                  className="px-3 py-1 text-xs font-medium rounded-md bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  <RefreshCw size={12} className={isRefreshingExpired ? 'animate-spin' : ''} />
                  {isRefreshingExpired ? 'Refreshing...' : 'Refresh All Expired'}
                </button>
              </div>
            )}

            {/* Toolbar */}
            <div className="flex items-center justify-between gap-4 mb-4 shrink-0">
              {/* Left: Quick Filters */}
              <div className="flex items-center gap-2">
                <QuotaFilterChip
                  value={quotaFilter as 'any' | 'has_quota' | 'empty' | 'full' | 'low_quota'}
                  onChange={value => setAccountsQuotaFilter(value)}
                />
              </div>

              {/* Right: Search & Actions */}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setAccountsSearchQuery(e.target.value)}
                    className="w-64 h-9 bg-white/5 rounded-lg pl-9 pr-16 text-sm text-white placeholder-slate-600 border border-white/10 focus:border-white/20 focus:outline-none transition-colors"
                    placeholder={t('accounts.searchPlaceholder')}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 bg-white/10 text-slate-500 text-[10px] font-mono px-1.5 py-0.5 rounded">
                    ⌘K
                  </span>
                </div>

                <button
                  onClick={handleRefreshAll}
                  disabled={isRefreshingAll}
                  className="h-9 w-9 flex items-center justify-center rounded-lg text-slate-500 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50"
                  title={t('accounts.refreshAll')}
                >
                  <RefreshCw size={15} className={isRefreshingAll ? 'animate-spin' : ''} />
                </button>

                <button
                  onClick={handleExportCSV}
                  disabled={accounts.length === 0}
                  className="h-9 w-9 flex items-center justify-center rounded-lg text-slate-500 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50"
                  title={t('accounts.exportCsv')}
                >
                  <Download size={15} />
                </button>

                <button
                  onClick={() =>
                    navigate('/autoreg', {
                      state: { provider: providerFilter !== 'all' ? providerFilter : null },
                    })
                  }
                  className="h-9 px-4 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 transition-colors shadow-lg shadow-indigo-900/20"
                >
                  <Plus size={14} />
                  {t('common.add')}
                </button>
              </div>
            </div>

            {/* Table Area */}
            <div className="flex-1 overflow-hidden bg-slate-900/20 rounded-xl border border-white/5">
              {isLoading && filteredAccounts.length === 0 ? (
                // Skeleton loader
                <div className="flex flex-col h-full">
                  <div className="flex-1 overflow-auto p-4 space-y-3">
                    {[1, 2, 3, 4, 5].map(i => (
                      <div key={i} className="h-12 bg-white/5 rounded-lg animate-pulse" />
                    ))}
                  </div>
                </div>
              ) : filteredAccounts.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-3">
                  <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-2">
                    <Users size={32} className="opacity-30" />
                  </div>
                  <p className="text-sm font-medium text-slate-400">
                    {t('accounts.noAccountsFound') || 'No accounts found'}
                  </p>
                  <p className="text-xs text-slate-600 max-w-[200px] text-center">
                    Try adjusting your filters or add a new account to get started.
                  </p>
                  <button
                    onClick={() => navigate('/autoreg')}
                    className="mt-4 px-4 py-2 text-xs font-medium rounded-lg bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 border border-indigo-500/20 transition-colors"
                  >
                    {t('accounts.addFirstAccount') || 'Add your first account'}
                  </button>
                </div>
              ) : (
                <AccountsTable
                  accounts={filteredAccounts}
                  isLoading={isLoading}
                  selectedIds={selectedIds}
                  activeAccountIds={activeAccountIds}
                  onToggleSelection={toggleSelection}
                  onSelectAll={selectAll}
                  onClearSelection={clearSelection}
                  onRefreshToken={handleRefreshToken}
                  onCopyToken={handleCopyToken}
                  onDelete={handleDelete}
                  onDeleteSelected={removeSelectedAccounts}
                  onActivate={handleActivate}
                  onExportCSV={handleExportCSV}
                  onCheckStatus={handleCheckStatus}
                  onBulkRefresh={startBulkRefresh}
                  isBulkRefreshing={isBulkRefreshing}
                  bulkProgress={bulkProgress}
                  isAccountRefreshing={isAccountRefreshing}
                  onOpenBrowser={handleOpenBrowser}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      <AddAccountModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleAddAccount}
      />
    </div>
  );
}
