import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, RefreshCw, Download, Users, AlertCircle } from 'lucide-react';
import Header from '../components/layout/Header';
import AccountsTable from '../components/AccountsTable';
import AddAccountModal from '../components/AddAccountModal';
import { StatusFilterChip, QuotaFilterChip } from '../components/ui/FilterChip';
import { ProviderFilter } from '../components/accounts/ProviderFilter';
import { useAccountsStore } from '../stores/accounts';
import { useAppStore } from '../stores/app';
import { useLogsStore } from '../stores/logs';
import { copyToClipboard, checkAccountStatus, getAccounts, type GetAccountsParams } from '../lib/tauri';
import { t } from '../lib/i18n';
import type { ProviderName, AccountStatus, Account } from '../types';

export default function Accounts() {
  const navigate = useNavigate();
  const { language } = useAppStore();
  const { addLog } = useLogsStore();
  const {
    loading: isLoading,
    error: storeError,
    searchQuery,
    setSearchQuery,
    statusFilter,
    setStatusFilter,
    quotaFilter,
    setQuotaFilter,
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
    refreshExpiredAccounts,
    activeAccountIds,
    setActiveAccount,
  } = useAccountsStore();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [isRefreshingExpired, setIsRefreshingExpired] = useState(false);
  const [copiedToast, setCopiedToast] = useState(false);
  const [providerFilter, setProviderFilter] = useState('all');
  const [accounts, setAccounts] = useState<Account[]>([]);

  // Custom fetch function that uses the new getAccounts API with filtering
  const fetchAccountsWithFilter = useCallback(async () => {
    try {
      const params: GetAccountsParams = {};
      
      if (providerFilter !== 'all') {
        // Map filter values to actual provider names in database
        let providerSubtype = providerFilter;
        if (providerFilter === 'aws') {
          providerSubtype = 'aws_builder_id'; // Map 'aws' filter to 'aws_builder_id' provider
        }
        
        params.providerSubtype = providerSubtype;
        
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
        if (window.confirm(t('accounts.confirmDeleteSelected', { count: selectedIds.size }) || `Delete ${selectedIds.size} selected account(s)?`)) {
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
        if (selectedIds.size === accounts.length) {
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
  }, [selectedIds, accounts.length, selectAll, clearSelection, removeSelectedAccounts, refreshAccount]);

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
      (account.quota?.used || 0).toString(),
      (account.quota?.limit || 0).toString(),
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

        {/* Expired Accounts Warning */}
        {expiredCount > 0 && (
          <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center gap-3">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="text-xs text-amber-300 flex-1">
              {expiredCount} {expiredCount === 1 ? 'account requires' : 'accounts require'} re-authentication. 
              Refresh tokens have expired.
            </span>
            <button 
              onClick={handleRefreshExpired}
              disabled={isRefreshingExpired}
              className="px-3 py-1 text-xs font-medium rounded-md bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              <RefreshCw size={12} className={isRefreshingExpired ? 'animate-spin' : ''} />
              {isRefreshingExpired ? 'Refreshing...' : 'Refresh All Expired'}
            </button>
            <button 
              onClick={() => setStatusFilter('expired')}
              className="text-amber-400 hover:text-amber-300 text-xs shrink-0 underline"
            >
              Show expired
            </button>
          </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-4 mb-4">
          {/* Left: Provider Filter + Filter Chips */}
          <div className="flex items-center gap-3">
            {/* Provider Filter */}
            <ProviderFilter value={providerFilter} onChange={setProviderFilter} />

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
              onClick={() => navigate('/autoreg', { state: { provider: providerFilter !== 'all' ? providerFilter : null } })}
              className="h-9 px-4 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 transition-colors"
            >
              <Plus size={14} />
              {t('common.add')}
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-hidden">
          {isLoading && accounts.length === 0 ? (
            // Skeleton loader for initial load
            <div 
              className="flex flex-col h-full rounded-lg overflow-hidden"
              style={{ border: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.02)' }}
            >
              <div className="flex-1 overflow-auto">
                <table className="w-full">
                  <thead className="sticky top-0 z-10">
                    <tr className="h-10 border-b border-white/5" style={{ background: 'rgba(30, 41, 59, 0.7)' }}>
                      <th className="w-10 px-3"></th>
                      <th className="w-10 px-2"></th>
                      <th className="px-3 text-left">
                        <span className="text-xs uppercase tracking-wider text-white/60 font-medium">{t('accountsTable.account')}</span>
                      </th>
                      <th className="w-24 px-3 text-left">
                        <span className="text-xs uppercase tracking-wider text-white/60 font-medium">{t('accountsTable.status')}</span>
                      </th>
                      <th className="w-28 px-3 text-left">
                        <span className="text-xs uppercase tracking-wider text-white/60 font-medium">{t('accountsTable.usage')}</span>
                      </th>
                      <th className="w-20 px-3 text-left">
                        <span className="text-xs uppercase tracking-wider text-white/60 font-medium">{t('accountsTable.last')}</span>
                      </th>
                      <th className="w-16 px-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {[1, 2, 3, 4, 5].map((i) => (
                      <tr key={i} className="animate-pulse">
                        <td className="py-3 px-3"><div className="w-4 h-4 bg-white/5 rounded" /></td>
                        <td className="py-3 px-2"><div className="w-5 h-5 bg-white/5 rounded" /></td>
                        <td className="py-3 px-3">
                          <div className="h-3 bg-white/5 rounded w-48 mb-1.5" />
                          <div className="h-2 bg-white/5 rounded w-24" />
                        </td>
                        <td className="py-3 px-3"><div className="h-5 bg-white/5 rounded w-16" /></td>
                        <td className="py-3 px-3"><div className="h-2 bg-white/5 rounded w-24" /></td>
                        <td className="py-3 px-3"><div className="h-2 bg-white/5 rounded w-12" /></td>
                        <td className="py-3 px-3"><div className="flex gap-1"><div className="w-6 h-6 bg-white/5 rounded" /><div className="w-6 h-6 bg-white/5 rounded" /></div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="h-8 px-3 flex items-center justify-between border-t border-white/5" style={{ background: 'rgba(30, 41, 59, 0.5)' }}>
                <span className="text-[10px] text-slate-500">{t('common.loading')}...</span>
              </div>
            </div>
          ) : accounts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-3">
              <Users size={48} className="opacity-30" />
              <p className="text-sm">{t('accounts.noAccountsFound') || 'No accounts found'}</p>
              <button 
                onClick={() => navigate('/autoreg')}
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
