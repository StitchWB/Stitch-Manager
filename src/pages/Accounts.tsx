import { useEffect, useState, useCallback } from 'react';
import { Plus, Search, RefreshCw, Download, Users } from 'lucide-react';
import Header from '../components/layout/Header';
import AccountsTable from '../components/AccountsTable';
import AddAccountModal from '../components/AddAccountModal';
import QuickAccountSwitch from '../components/QuickAccountSwitch';
import { useAccountsStore } from '../stores/accounts';
import { useAppStore } from '../stores/app';
import { copyToClipboard } from '../lib/tauri';
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
  const _ = language;

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const handleAddAccount = async (data: {
    provider: ProviderName;
    email: string;
    password: string;
    token?: string;
  }) => {
    await createAccount(data.provider, data.email, data.password);
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
      setTimeout(() => setCopiedToast(false), 2000);
    } catch {
      try {
        await navigator.clipboard.writeText(token);
        setCopiedToast(true);
        setTimeout(() => setCopiedToast(false), 2000);
      } catch (e) {
        console.error('Failed to copy token:', e);
      }
    }
  }, []);

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

  const handleExportCSV = () => {
    const headers = ['Provider', 'Email', 'Status', 'Quota Used', 'Quota Limit', 'Token'];
    const rows = accounts.map((account) => [
      account.provider,
      account.email,
      account.status,
      account.quota.used.toString(),
      account.quota.limit.toString(),
      account.token,
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
                    ? 'text-white font-medium bg-white/10 border border-white/5 shadow-sm'
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
                className="w-56 h-9 bg-transparent border border-white/10 rounded-lg pl-9 pr-3 text-sm text-white placeholder-slate-600 focus:border-white/20 focus:outline-none"
                placeholder={t('accounts.searchPlaceholder')}
              />
            </div>

            <button
              onClick={handleRefreshAll}
              disabled={isRefreshingAll}
              className="h-9 w-9 flex items-center justify-center rounded-lg border border-white/10 text-slate-500 hover:text-white hover:border-white/20 transition-colors disabled:opacity-50"
              title={t('accounts.refreshAll')}
            >
              <RefreshCw size={15} className={isRefreshingAll ? 'animate-spin' : ''} />
            </button>

            <button
              onClick={handleExportCSV}
              disabled={accounts.length === 0}
              className="h-9 w-9 flex items-center justify-center rounded-lg border border-white/10 text-slate-500 hover:text-white hover:border-white/20 transition-colors disabled:opacity-50"
              title={t('accounts.exportCsv')}
            >
              <Download size={15} />
            </button>

            <button 
              onClick={() => setIsModalOpen(true)} 
              className="h-9 px-4 bg-white text-black text-xs font-semibold rounded-lg flex items-center gap-1.5 hover:bg-white/90 transition-colors"
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
            onActivate={handleActivate}
          />
        </div>

        {/* Bulk Actions */}
        {selectedIds.size > 0 && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 border border-white/10 rounded-full px-4 py-2 flex items-center gap-4 shadow-2xl z-20 animate-slide-up">
            <span className="text-xs text-white">
              <span className="font-semibold">{selectedIds.size}</span> {t('common.selected')}
            </span>
            <div className="w-px h-4 bg-white/10" />
            <button onClick={handleExportCSV} className="text-xs text-slate-400 hover:text-white">
              {t('common.export')}
            </button>
            <button
              onClick={async () => {
                if (confirm(t('accounts.deleteConfirm', { count: selectedIds.size }))) {
                  await removeSelectedAccounts([...selectedIds]);
                }
              }}
              className="text-xs text-red-400 hover:text-red-300"
            >
              {t('common.delete')}
            </button>
            <button onClick={clearSelection} className="text-slate-500 hover:text-white">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

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
