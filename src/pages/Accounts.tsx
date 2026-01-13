import { useEffect, useState, useCallback } from 'react';
import { Plus, Search, RefreshCw, Download, Users } from 'lucide-react';
import Header from '../components/layout/Header';
import AccountsTable from '../components/AccountsTable';
import AddAccountModal from '../components/AddAccountModal';
import QuickAccountSwitch from '../components/QuickAccountSwitch';
import { useAccountsStore } from '../stores/accounts';
import { useAppStore } from '../stores/app';
import { copyToClipboard, checkAccountStatus } from '../lib/tauri';
import { t } from '../lib/i18n';
import type { ProviderName } from '../types';

const providerTabs: { id: ProviderName | null; labelKey: string; label: string }[] = [
  { id: null, labelKey: 'accounts.filterAll', label: 'All' },
  { id: 'kiro', labelKey: '', label: 'Kiro' },
  { id: 'windsurf', labelKey: '', label: 'Windsurf' },
  { id: 'trae', labelKey: '', label: 'Trae' },
];

export default function Accounts() {
  const { language } = useAppStore();
  const {
    loading: isLoading,
    searchQuery,
    setSearchQuery,
    selectedProvider: filterProvider,
    setSelectedProvider: setFilterProvider,
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
    } catch (error) {
      console.error('Failed to add account:', error);
      const { addNotification } = useAppStore.getState();
      addNotification({
        type: 'error',
        title: t('notifications.addFailed'),
        message: String(error),
      });
    }
  };

  const handleRefreshToken = async (accountId: number) => {
    try {
      await refreshAccount(accountId);
    } catch (error) {
      console.error('Failed to refresh token:', error);
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
      await removeAccount(accountId);
    } catch (error) {
      console.error('Failed to delete account:', error);
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
      } else {
        addNotification({
          type: 'info',
          title: t('notifications.accountDeactivated'),
          message: provider,
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
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-4 mb-4">
          {/* Filter Tabs - Text links style */}
          <div className="flex items-center gap-1">
            {providerTabs.map((tab) => (
              <button
                key={tab.id ?? 'all'}
                onClick={() => setFilterProvider(tab.id)}
                className={`px-3 py-1 rounded-full text-sm transition-colors ${
                  filterProvider === tab.id
                    ? 'text-indigo-300 font-medium bg-indigo-500/15 border border-indigo-500/20 shadow-sm'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {tab.labelKey ? t(tab.labelKey) : tab.label}
              </button>
            ))}
          </div>

          {/* Search & Actions */}
          <div className="flex items-center gap-2">
            <QuickAccountSwitch />
            
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-56 h-9 bg-transparent rounded-lg pl-9 pr-3 text-sm text-white placeholder-slate-600 focus:outline-none"
                style={{ border: '1px solid rgba(255, 255, 255, 0.08)', }}
                onFocus={(e) => e.target.style.borderColor = 'rgba(255, 255, 255, 0.12)'}
                onBlur={(e) => e.target.style.borderColor = 'rgba(255, 255, 255, 0.08)'}
                placeholder={t('accounts.searchPlaceholder')}
              />
            </div>

            <button
              onClick={handleRefreshAll}
              disabled={isRefreshingAll}
              className="h-9 w-9 flex items-center justify-center rounded-lg border border-white/[0.08] text-slate-500 hover:text-white hover:border-white/[0.12] transition-colors disabled:opacity-50"
              title={t('accounts.refreshAll')}
            >
              <RefreshCw size={15} className={isRefreshingAll ? 'animate-spin' : ''} />
            </button>

            <button
              onClick={handleExportCSV}
              disabled={accounts.length === 0}
              className="h-9 w-9 flex items-center justify-center rounded-lg border border-white/[0.08] text-slate-500 hover:text-white hover:border-white/[0.12] transition-colors disabled:opacity-50"
              title={t('accounts.exportCsv')}
            >
              <Download size={15} />
            </button>

            <button 
              onClick={() => setIsModalOpen(true)} 
              className="h-9 px-4 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #6366f1, #4f46e5)', boxShadow: '0 0 15px rgba(99, 102, 241, 0.3)' }}
            >
              <Plus size={14} />
              {t('common.add')}
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-hidden">
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
