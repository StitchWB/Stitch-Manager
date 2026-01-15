import { useEffect, useState, useCallback } from 'react';
import { Plus, Search, RefreshCw, Download, Users, AlertCircle } from 'lucide-react';
import Header from '../components/layout/Header';
import AccountsTable from '../components/AccountsTable';
import AddAccountModal from '../components/AddAccountModal';
import { StatusFilterChip, QuotaFilterChip } from '../components/ui/FilterChip';
import { useAccountsStore } from '../stores/accounts';
import { useAppStore } from '../stores/app';
import { useLogsStore } from '../stores/logs';
import { copyToClipboard, checkAccountStatus } from '../lib/tauri';
import { t } from '../lib/i18n';
import type { ProviderName, AccountStatus } from '../types';

// Provider tabs are derived from the app store's providers list
const getProviderTabs = (providers: { id: ProviderName; name: string }[]): { id: ProviderName | null; labelKey: string; label: string }[] => [
  { id: null, labelKey: 'accounts.filterAll', label: 'All' },
  ...providers.map(p => ({ id: p.id, labelKey: '', label: p.name })),
];

export default function Accounts() {
  const { language, providers } = useAppStore();
  const { addLog } = useLogsStore();
  const providerTabs = getProviderTabs(providers);
  const {
    loading: isLoading,
    error: storeError,
    searchQuery,
    setSearchQuery,
    selectedProvider: filterProvider,
    setSelectedProvider: setFilterProvider,
    statusFilter,
    setStatusFilter,
    quotaFilter,
    setQuotaFilter,
    getFilteredAccounts,
    selectedIds,
    toggleSelection,
    selectAll,
    clearSelection,
    fetchAccounts,
    addAccount: createAccount,
    deleteAccount: removeAccount,
    deleteAccounts: removeSelectedAccounts,
    refreshAccount,
    refreshAllAccounts,
    activeAccountIds,
    setActiveAccount,
  } = useAccountsStore();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [copiedToast, setCopiedToast] = useState(false);

  const accounts = getFilteredAccounts();

  // Force re-render when language changes
  void language; // Force re-render on language change

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

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
      await refreshAllAccounts();
    } finally {
      setIsRefreshingAll(false);
    }
  };

  const handleCopyToken = useCallback(async (token: string) => {
    try {
      await copyToClipboard({ text: token });
      setCopiedToast(true);
    } catch {
      try {
        await navigator.clipboard.writeText(token);
        setCopiedToast(true);
      } catch (e) {
        console.error('Failed to copy token:', e);
      }
    }
  }, []);

  // Auto-hide copied toast with cleanup
  useEffect(() => {
    if (!copiedToast) return;
    const timer = setTimeout(() => setCopiedToast(false), 2000);
    return () => clearTimeout(timer);
  }, [copiedToast]);

  const handleDelete = async (accountId: number) => {
    try {
      const account = accounts.find(a => a.id === accountId);
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
        const account = accounts.find(a => a.id === accountId);
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
      const account = accounts.find(a => a.id === accountId);
      
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
        throw new Error("Invalid response from server");
      }
      
      // Show detailed status notification
      const quotaText = statusInfo.quotaLimit < 0 
        ? 'Unlimited' 
        : `${statusInfo.quotaUsed}/${statusInfo.quotaLimit} (${Math.round(statusInfo.quotaPercent)}%)`;
      
      const flowText = statusInfo.flowCreditsLimit !== undefined
        ? `\nFlow: ${statusInfo.flowCreditsUsed}/${statusInfo.flowCreditsLimit < 0 ? '∞' : statusInfo.flowCreditsLimit}`
        : '';

      addNotification({
        type: statusInfo.isActive ? 'success' : 'warning',
        title: `${statusInfo.provider.toUpperCase()} Status`,
        message: `${statusInfo.email}\nPlan: ${statusInfo.plan}\nQuota: ${quotaText}${flowText}`,
      });

      // Refresh account data
      await refreshAccount(accountId);
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

  const handleExportCSV = () => {
    const headers = ['Provider', 'Email', 'Status', 'Quota Used', 'Quota Limit', 'Token'];
    const rows = accounts.map((account) => [
      account.provider,
      account.email,
      account.status,
      account.quota.used.toString(),
      account.quota.limit.toString(),
      account.token ?? '',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `accounts_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header title={t('accounts.title')} icon={<Users size={18} />} />

      <div className="flex-1 flex flex-col overflow-hidden p-4">
        {/* Error Alert */}
        {storeError && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center gap-3">
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

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-4 mb-4">
          {/* Left: Provider Tabs + Filter Chips */}
          <div className="flex items-center gap-3">
            {/* Provider Tabs - Pill/Segmented control style */}
            <div className="flex items-center gap-1">
              {providerTabs.map((tab) => (
                <button
                  key={tab.id ?? 'all'}
                  onClick={() => setFilterProvider(tab.id)}
                  className={`px-3 py-1.5 text-sm rounded-md transition-all duration-200 ${
                    filterProvider === tab.id
                      ? 'bg-white/[0.08] text-white'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'
                  }`}
                >
                  {tab.labelKey ? t(tab.labelKey) : tab.label}
                </button>
              ))}
            </div>

            {/* Separator */}
            <div className="w-px h-5 bg-white/10" />

            {/* Filter Chips */}
            <StatusFilterChip 
              value={statusFilter} 
              onChange={(value) => setStatusFilter(value as AccountStatus | null)}
            />
            <QuotaFilterChip 
              value={quotaFilter} 
              onChange={setQuotaFilter}
            />
          </div>

          {/* Right: Search & Actions */}
          <div className="flex items-center gap-2">
            {/* Search with shortcut hint */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
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
              onClick={() => setIsModalOpen(true)} 
              className="h-9 px-4 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 transition-colors"
            >
              <Plus size={14} />
              {t('common.add')}
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-hidden">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-3">
              <RefreshCw size={32} className="animate-spin text-indigo-400" />
              <p className="text-sm">{t('common.loading') || 'Loading...'}</p>
            </div>
          ) : accounts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-3">
              <Users size={48} className="opacity-30" />
              <p className="text-sm">{t('accounts.noAccountsFound') || 'No accounts found'}</p>
              <button 
                onClick={() => setIsModalOpen(true)} 
                className="mt-2 px-4 py-2 text-xs font-medium rounded-lg bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 transition-colors"
              >
                {t('accounts.addFirstAccount') || 'Add your first account'}
              </button>
            </div>
          ) : (
            <AccountsTable
              accounts={accounts}
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
            />
          )}
        </div>

        {/* Toast */}
        {copiedToast && (
          <div className="fixed bottom-6 right-6 bg-white text-black text-xs font-medium px-4 py-2 rounded-lg shadow-lg animate-slide-up z-50">
            {t('common.copied')}
          </div>
        )}
      </div>

      <AddAccountModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleAddAccount}
      />
    </div>
  );
}
