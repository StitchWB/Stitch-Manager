import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, RefreshCw, Download, Users, LayoutGrid, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import Header from '../components/layout/Header';
import AccountsTable from '../components/AccountsTable';
import AddAccountModal from '../components/AddAccountModal';
import AccountDetailsModal from '../components/ui/AccountDetailsModal';
import { QuotaFilterChip } from '../components/ui/QuotaFilterChip';
import { FloatingActionBar } from '../components/ui/FloatingActionBar';
import { useAccountsStore } from '../stores/accounts';
import { useUIPreferencesStore } from '../stores/uiPreferences';
import {
  checkAccountStatus,
  getAccounts,
  openAccountBrowser,
  bulkExportAccounts,
  type GetAccountsParams,
} from '../lib/tauri';
import { t } from '../lib/i18n';
import { Tooltip } from '../components/Tooltip';
import { useBulkRefresh } from '../hooks/useBulkRefresh';
import { useUrlState } from '../hooks/useUrlState';
import type { Account, AccountStatus } from '../types';
import { ProviderLogo } from '../components/ui/ProviderLogo';
import { cn } from '../lib/utils';

export default function Accounts() {
  const navigate = useNavigate();
  const {
    accounts: storeAccounts,
    loading,
    fetchAccounts,
    deleteAccount,
    deleteAccounts,
    toggleSelection,
    selectAll,
    clearSelection,
    selectedIds,
    setSelectedProvider,
    activeAccountIds,
    setActiveAccount,
    setSearchQuery: setStoreSearchQuery,
    setQuotaFilter: setStoreQuotaFilter,
    setStatusFilter: setStoreStatusFilter,
  } = useAccountsStore();

  const [detailsModalAccount, setDetailsModalAccount] = useState<Account | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const {
    startBulkRefresh,
    isRefreshing: isBulkRefreshing,
    progress: bulkProgress,
    isAccountRefreshing,
  } = useBulkRefresh({ concurrency: 3, delayMs: 500 });

  // Sync with UI preferences
  const {
    accountsPage,
    setAccountsProviderFilter,
    setAccountsStatusFilter,
    setAccountsQuotaFilter,
    setAccountsSearchQuery,
  } = useUIPreferencesStore();

  // Initialize state from preferences (use preferences as source of truth)
  const [providerFilter, setProviderFilter] = useUrlState('provider', accountsPage.providerFilter || 'all');
  const [statusFilter, setStatusFilter] = useUrlState('status', accountsPage.statusFilter || 'all');
  const [searchQuery, setSearchQuery] = useState(accountsPage.searchQuery || '');
  const [quotaFilter, setQuotaFilter] = useState<string>(accountsPage.quotaFilter || 'any');

  // Memoized handlers to prevent unnecessary re-renders
  const handleProviderFilterChange = useCallback((value: string) => {
    setProviderFilter(value);
    setAccountsProviderFilter(value);
    setSelectedProvider(value === 'all' ? null : (value as any));
  }, [setProviderFilter, setAccountsProviderFilter, setSelectedProvider]);

  const handleStatusFilterChange = useCallback((value: string) => {
    setStatusFilter(value);
    setAccountsStatusFilter(value);
    setStoreStatusFilter(value === 'all' ? null : (value as AccountStatus));
  }, [setStatusFilter, setAccountsStatusFilter, setStoreStatusFilter]);

  const handleQuotaFilterChange = useCallback((value: string) => {
    setQuotaFilter(value);
    setAccountsQuotaFilter(value);
    setStoreQuotaFilter(value as any);
  }, [setAccountsQuotaFilter, setStoreQuotaFilter]);

  const handleSearchQueryChange = useCallback((value: string) => {
    setSearchQuery(value);
    setAccountsSearchQuery(value);
    setStoreSearchQuery(value);
  }, [setAccountsSearchQuery, setStoreSearchQuery]);

  const providerCounts = useMemo(() => {
    const counts: Record<string, number> = { all: 0 };
    accounts.forEach(acc => {
      counts.all++;
      counts[acc.provider] = (counts[acc.provider] || 0) + 1;
    });
    return counts;
  }, [accounts]);

  const fetchAccountsWithFilter = useCallback(async () => {
    try {
      const params: GetAccountsParams = {};
      if (providerFilter !== 'all') {
        let subtype: string = providerFilter;
        if (providerFilter === 'aws') subtype = 'aws_builder_id';
        params.providerSubtype = subtype as any;
        if (['kiro', 'windsurf', 'trae'].includes(providerFilter)) params.providerType = 'ide';
        else if (providerFilter === 'aws') params.providerType = 'cloud';
        else if (providerFilter === 'github') params.providerType = 'git';
      }
      const data = await getAccounts(params);
      setAccounts(data);
    } catch (e) {
      console.error(e);
    }
  }, [providerFilter]);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);
  useEffect(() => {
    fetchAccountsWithFilter();
  }, [fetchAccountsWithFilter, providerFilter]);

  const handleRemoveSelectedAccounts = useCallback(
    async (ids?: number[]) => {
      const targets = ids || Array.from(selectedIds);
      if (
        !targets.length ||
        !window.confirm(t('accounts.deleteConfirm', { count: targets.length }))
      )
        return;
      try {
        await deleteAccounts(targets);
        clearSelection();
        fetchAccountsWithFilter();
      } catch (e) {
        console.error(e);
      }
    },
    [selectedIds, deleteAccounts, clearSelection, fetchAccountsWithFilter]
  );

  const handleRemoveAccount = useCallback(
    async (id: number) => {
      try {
        await deleteAccount(id);
        if (detailsModalAccount?.id === id) setDetailsModalAccount(null);
        fetchAccountsWithFilter();
      } catch (e) {
        console.error(e);
      }
    },
    [deleteAccount, detailsModalAccount, fetchAccountsWithFilter]
  );

  const filteredAccounts = useMemo(() => {
    let filtered = [...accounts];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        a => a.email.toLowerCase().includes(q) || a.provider.toLowerCase().includes(q)
      );
    }
    if (statusFilter !== 'all') filtered = filtered.filter(a => a.status === statusFilter);
    
    // Apply quota filter (skip if 'any' or 'all')
    if (quotaFilter && quotaFilter !== 'any' && quotaFilter !== 'all') {
      if (quotaFilter === 'low_quota')
        filtered = filtered.filter(
          a => a.quota && a.quota.limit > 0 && a.quota.used / a.quota.limit > 0.8
        );
      else if (quotaFilter === 'has_quota')
        filtered = filtered.filter(
          a => a.quota && a.quota.limit > 0 && a.quota.used / a.quota.limit < 0.5
        );
      else if (quotaFilter === 'empty')
        filtered = filtered.filter(a => !a.quota || a.quota.used === 0);
      else if (quotaFilter === 'full')
        filtered = filtered.filter(
          a => a.quota && a.quota.limit > 0 && a.quota.used >= a.quota.limit
        );
    }
    return filtered;
  }, [accounts, searchQuery, statusFilter, quotaFilter]);

  const handleAddAccount = async (d: any) => {
    try {
      await useAccountsStore.getState().addAccount(d.provider, d.email, d.password);
      fetchAccountsWithFilter();
    } catch (e) {
      console.error(e);
    }
  };
  const handleCheckStatus = async (id: number) => {
    try {
      await checkAccountStatus({ accountId: id });
      const updated = await useAccountsStore.getState().refreshAccount(id);
      setAccounts(prev => prev.map(a => (a.id === id ? updated : a)));
    } catch (e) {
      console.error(e);
    }
  };
  const handleOpenBrowser = async (id: number) => {
    try {
      await openAccountBrowser({ accountId: id });
    } catch (error) {
      console.error(error);
    }
  };
  const handleExportCSV = async () => {
    try {
      const targets =
        selectedIds.size > 0 ? Array.from(selectedIds) : filteredAccounts.map(a => a.id);
      if (!targets.length) return;
      const csv = await bulkExportAccounts({ accountIds: targets, format: 'csv' });
      const blob = new Blob([csv], { type: 'text/csv' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `accounts_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
    } catch (e) {
      console.error(e);
    }
  };

  const handleRefreshAll = async () => {
    await startBulkRefresh(filteredAccounts.map(a => a.id));
    fetchAccountsWithFilter();
  };

  const handleRefreshExpired = async () => {
    const expiredAccountIds = filteredAccounts.filter(a => a.status === 'expired').map(a => a.id);
    if (expiredAccountIds.length === 0) {
      toast.info('No expired accounts to refresh');
      return;
    }
    await startBulkRefresh(expiredAccountIds);
    fetchAccountsWithFilter();
  };

  const expiredCount = storeAccounts.filter(a => a.status === 'expired').length;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#050508]">
      <Header title={t('accounts.title')} icon={<Users size={18} />} />
      
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar Filter Panel */}
        <aside className="w-[220px] shrink-0 bg-[#111116]/50 backdrop-blur-md border-r border-white/5 flex flex-col overflow-hidden">
          {/* Providers Section */}
          <div className="p-3">
            <h3 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2 px-2">
              {t('accounts.providers')}
            </h3>
            <div className="space-y-0.5">
              <button
                onClick={() => handleProviderFilterChange('all')}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors duration-150 relative',
                  providerFilter === 'all'
                    ? 'bg-indigo-500/15 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                )}
              >
                {providerFilter === 'all' && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-indigo-500 rounded-r shadow-[0_0_8px_rgba(99,102,241,0.6)]" />
                )}
                <LayoutGrid size={16} className="shrink-0 ml-2" />
                <span className="flex-1 text-left">{t('accounts.allAccounts')}</span>
                <span className="text-xs text-slate-400 font-medium tabular-nums">
                  {providerCounts.all}
                </span>
              </button>
              
              {[
                { id: 'kiro', label: 'Kiro' },
                { id: 'windsurf', label: 'Windsurf' },
                { id: 'trae', label: 'Trae' },
                { id: 'aws', label: 'AWS Builder ID' },
                { id: 'github', label: 'GitHub' },
              ].map(provider => (
                <button
                  key={provider.id}
                  onClick={() => handleProviderFilterChange(provider.id)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors duration-150 relative',
                    providerFilter === provider.id
                      ? 'bg-indigo-500/15 text-white'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  )}
                >
                  {providerFilter === provider.id && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-indigo-500 rounded-r shadow-[0_0_8px_rgba(99,102,241,0.6)]" />
                  )}
                  <ProviderLogo
                    provider={provider.id as any}
                    size={16}
                    colored={providerFilter === provider.id}
                    className="shrink-0 ml-2"
                  />
                  <span className="flex-1 text-left">{provider.label}</span>
                  {providerCounts[provider.id === 'aws' ? 'aws_builder_id' : provider.id] > 0 && (
                    <span className="text-xs text-slate-400 font-medium tabular-nums">
                      {providerCounts[provider.id === 'aws' ? 'aws_builder_id' : provider.id]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="h-px bg-white/5 mx-4" />

          {/* Status Section */}
          <div className="p-3">
            <h3 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2 px-2">
              {t('accounts.statusHeader')}
            </h3>
            <div className="space-y-0.5">
              {[
                { id: 'all', label: t('filters.anyStatus'), dot: null },
                { id: 'active', label: t('status.active'), dot: 'bg-emerald-500' },
                { id: 'banned', label: t('status.banned'), dot: 'bg-red-500' },
                { id: 'expired', label: t('status.expired'), dot: 'bg-amber-500' },
              ].map(status => (
                <button
                  key={status.id}
                  onClick={() => handleStatusFilterChange(status.id)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors duration-150 relative',
                    statusFilter === status.id
                      ? 'bg-indigo-500/15 text-white'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  )}
                >
                  {statusFilter === status.id && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-indigo-500 rounded-r shadow-[0_0_8px_rgba(99,102,241,0.6)]" />
                  )}
                  {status.dot ? (
                    <div 
                      className={cn('w-2 h-2 rounded-full shrink-0 ml-2', status.dot)}
                      style={{
                        boxShadow: statusFilter === status.id && status.id !== 'all'
                          ? status.id === 'active' 
                            ? '0 0 8px rgba(16,185,129,0.6)' 
                            : status.id === 'banned'
                              ? '0 0 8px rgba(239,68,68,0.6)'
                              : '0 0 8px rgba(245,158,11,0.6)'
                          : 'none'
                      }}
                    />
                  ) : (
                    <div className="w-2 h-2 shrink-0 ml-2" />
                  )}
                  <span className="flex-1 text-left">{status.label}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header Bar */}
          <div className="shrink-0 flex items-center justify-between gap-4 px-6 py-4 border-b border-white/5 bg-[#0a0a0c]/80 backdrop-blur-xl">
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <div className="relative group flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-indigo-400 transition-colors" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => handleSearchQueryChange(e.target.value)}
                  className="w-full h-9 bg-black/40 rounded-lg pl-10 pr-4 text-sm text-white border border-white/10 focus:border-indigo-500/50 focus:bg-black/60 outline-none transition-colors placeholder-slate-400"
                  placeholder={t('accounts.searchPlaceholder')}
                />
              </div>
              
              <QuotaFilterChip value={quotaFilter as any} onChange={handleQuotaFilterChange} />
            </div>

            <div className="flex items-center gap-3">
              <Tooltip content={t('accounts.refreshAll')}>
                <button
                  onClick={handleRefreshAll}
                  disabled={isBulkRefreshing}
                  className="h-9 px-3 flex items-center gap-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white bg-white/5 border border-white/10 hover:bg-white/10 transition-colors disabled:opacity-30"
                >
                  <RefreshCw
                    size={15}
                    className={cn(isBulkRefreshing && 'animate-spin text-indigo-400')}
                  />
                </button>
              </Tooltip>
              
              <Tooltip content={t('accounts.exportCsv')}>
                <button
                  onClick={handleExportCSV}
                  disabled={accounts.length === 0}
                  className="h-9 px-3 flex items-center gap-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white bg-white/5 border border-white/10 hover:bg-white/10 transition-colors disabled:opacity-30"
                >
                  <Download size={15} />
                </button>
              </Tooltip>

              <div className="w-px h-6 bg-white/10" />
              
              <button
                onClick={() => navigate('/autoreg')}
                className="h-9 px-4 text-white text-sm font-semibold rounded-lg flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 transition-colors shadow-lg shadow-indigo-500/20"
              >
                <Plus size={18} />
                <span>Add account</span>
              </button>
            </div>
          </div>

          {/* Expired Warning */}
          {expiredCount > 0 && (
            <div className="shrink-0 mx-6 mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center gap-3">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="text-sm text-amber-300 flex-1">
                {expiredCount} {expiredCount === 1 ? 'account has' : 'accounts have'} expired
              </span>
              <button
                onClick={handleRefreshExpired}
                disabled={isBulkRefreshing}
                className="px-3 py-1.5 text-xs font-semibold rounded-md bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors flex items-center gap-2 border border-amber-500/30 disabled:opacity-50"
              >
                <RefreshCw size={12} className={isBulkRefreshing ? 'animate-spin' : ''} />
                Refresh expired
              </button>
            </div>
          )}

          {/* Table */}
          <div className="flex-1 overflow-hidden">
            {loading && filteredAccounts.length === 0 ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3, 4, 5, 6].map(i => (
                  <div key={i} className="h-14 bg-white/[0.02] rounded-lg animate-pulse" />
                ))}
              </div>
            ) : filteredAccounts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-4">
                <Users size={48} className="opacity-30" />
                <p className="text-sm font-medium">No accounts found</p>
              </div>
            ) : (
              <AccountsTable
                accounts={filteredAccounts}
                selectedIds={selectedIds}
                activeAccountIds={activeAccountIds}
                onToggleSelection={toggleSelection}
                onSelectAll={selectAll}
                onClearSelection={clearSelection}
                onDelete={handleRemoveAccount}
                onDeleteSelected={handleRemoveSelectedAccounts}
                onActivate={setActiveAccount}
                onCheckStatus={handleCheckStatus}
                isAccountRefreshing={isAccountRefreshing}
                onOpenBrowser={handleOpenBrowser}
                selectedProvider={providerFilter === 'all' ? null : providerFilter}
              />
            )}
          </div>
        </div>
      </div>

      <AccountDetailsModal
        account={detailsModalAccount}
        isOpen={!!detailsModalAccount}
        onClose={() => setDetailsModalAccount(null)}
        onDelete={handleRemoveAccount}
      />
      <AddAccountModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleAddAccount}
      />
      {selectedIds.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 px-6 pb-6 pointer-events-none">
          <div className="max-w-2xl mx-auto pointer-events-auto">
            <FloatingActionBar
              selectedCount={selectedIds.size}
              onExport={handleExportCSV}
              onDelete={() => handleRemoveSelectedAccounts()}
              onClear={clearSelection}
              onRefreshAll={handleRefreshAll}
              isRefreshing={isBulkRefreshing}
              refreshProgress={bulkProgress}
            />
          </div>
        </div>
      )}
    </div>
  );
}
