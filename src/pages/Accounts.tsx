import { useEffect, useState, useCallback } from 'react';
import { Plus, Search, RefreshCw, Download } from 'lucide-react';
import Header from '../components/layout/Header';
import AccountsTable from '../components/AccountsTable';
import AddAccountModal from '../components/AddAccountModal';
import { useAccountsStore } from '../stores/accounts';
import { copyToClipboard } from '../lib/tauri';
import type { ProviderName } from '../types';

// Provider filter tabs
const providerTabs: { id: ProviderName | null; label: string }[] = [
  { id: null, label: 'All' },
  { id: 'kiro', label: 'Kiro' },
  { id: 'windsurf', label: 'Windsurf' },
  { id: 'cursor', label: 'Cursor' },
  { id: 'trae', label: 'Trae' },
  { id: 'qoder', label: 'Qoder' },
];

export default function Accounts() {
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
  } = useAccountsStore();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [copiedToast, setCopiedToast] = useState(false);

  const accounts = getFilteredAccounts();

  // Fetch accounts on mount
  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  // Handle adding a new account
  const handleAddAccount = async (data: {
    provider: ProviderName;
    email: string;
    password: string;
    token?: string;
  }) => {
    // Pass email and password to the backend for account creation
    await createAccount(data.provider, data.email, data.password);
  };

  // Handle refreshing a single account's token
  const handleRefreshToken = async (accountId: number) => {
    try {
      await refreshAccount(accountId);
    } catch (error) {
      console.error('Failed to refresh token:', error);
    }
  };

  // Handle refreshing all accounts
  const handleRefreshAll = async () => {
    setIsRefreshingAll(true);
    try {
      await refreshAllAccounts();
    } finally {
      setIsRefreshingAll(false);
    }
  };

  // Handle copying token to clipboard
  const handleCopyToken = useCallback(async (token: string) => {
    try {
      await copyToClipboard({ text: token });
      setCopiedToast(true);
      setTimeout(() => setCopiedToast(false), 2000);
    } catch (error) {
      // Fallback to browser clipboard API
      try {
        await navigator.clipboard.writeText(token);
        setCopiedToast(true);
        setTimeout(() => setCopiedToast(false), 2000);
      } catch (e) {
        console.error('Failed to copy token:', e);
      }
    }
  }, []);

  // Handle deleting an account
  const handleDelete = async (accountId: number) => {
    try {
      await removeAccount(accountId);
    } catch (error) {
      console.error('Failed to delete account:', error);
    }
  };

  // Handle exporting accounts to CSV
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
    <>
      <Header title="Accounts Database" />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Filter & Search Toolbar */}
        <div className="p-6 pb-2">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            {/* Filter Pills */}
            <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0 no-scrollbar">
              {providerTabs.map((tab) => (
                <button
                  key={tab.id ?? 'all'}
                  onClick={() => setFilterProvider(tab.id)}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
                    filterProvider === tab.id
                      ? 'bg-surface-dark border border-primary text-primary shadow-sm'
                      : 'border border-border-dark text-slate-400 hover:text-white hover:border-white/20 hover:bg-surface-dark'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Search & Actions */}
            <div className="flex items-center gap-3">
              {/* Search Input */}
              <div className="relative group w-full md:w-80">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Search className="w-5 h-5 text-slate-400 group-focus-within:text-primary transition-colors" />
                </div>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="block w-full pl-10 pr-3 py-2 bg-surface-dark border border-border-dark rounded-lg leading-5 text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary sm:text-sm transition-all shadow-sm"
                  placeholder="Search by email..."
                />
              </div>

              {/* Refresh All Button */}
              <button
                onClick={handleRefreshAll}
                disabled={isRefreshingAll}
                className="p-2 rounded-lg border border-border-dark text-slate-400 hover:text-white hover:bg-surface-dark transition-colors disabled:opacity-50"
                title="Refresh All"
              >
                <RefreshCw size={18} className={isRefreshingAll ? 'animate-spin' : ''} />
              </button>

              {/* Export Button */}
              <button
                onClick={handleExportCSV}
                disabled={accounts.length === 0}
                className="p-2 rounded-lg border border-border-dark text-slate-400 hover:text-white hover:bg-surface-dark transition-colors disabled:opacity-50"
                title="Export CSV"
              >
                <Download size={18} />
              </button>

              {/* Add Account Button */}
              <button
                onClick={() => setIsModalOpen(true)}
                className="bg-primary hover:bg-blue-600 text-white text-sm font-medium py-2 px-4 rounded-lg shadow-lg shadow-primary/20 transition-all flex items-center gap-2"
              >
                <Plus size={18} />
                <span>Add Account</span>
              </button>
            </div>
          </div>
        </div>

        {/* Data Grid */}
        <div className="flex-1 px-6 pb-6 overflow-hidden flex flex-col">
          <AccountsTable
            accounts={accounts}
            isLoading={isLoading}
            selectedIds={selectedIds}
            onToggleSelection={toggleSelection}
            onSelectAll={selectAll}
            onClearSelection={clearSelection}
            onRefreshToken={handleRefreshToken}
            onCopyToken={handleCopyToken}
            onDelete={handleDelete}
          />
        </div>

        {/* Bulk Actions Floating Bar */}
        {selectedIds.size > 0 && (
          <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 bg-surface-dark border border-border-dark shadow-lg rounded-full px-6 py-3 flex items-center gap-6 z-20 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="flex items-center gap-2 pr-4 border-r border-border-dark">
              <span className="bg-primary text-white text-xs font-bold px-2 py-0.5 rounded-full">
                {selectedIds.size}
              </span>
              <span className="text-sm font-medium text-white">Selected</span>
            </div>
            <button
              onClick={handleExportCSV}
              className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors"
            >
              <Download size={18} />
              Export CSV
            </button>
            <button
              onClick={async () => {
                if (confirm(`Delete ${selectedIds.size} selected accounts?`)) {
                  await removeSelectedAccounts([...selectedIds]);
                }
              }}
              className="flex items-center gap-2 text-sm text-red-400 hover:text-red-300 transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
              Delete
            </button>
            <button
              onClick={clearSelection}
              className="ml-2 text-slate-400 hover:text-white"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}

        {/* Copied Toast */}
        {copiedToast && (
          <div className="fixed bottom-8 right-8 bg-green-500/90 text-white px-4 py-2 rounded-lg shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200 z-50">
            Token copied to clipboard!
          </div>
        )}
      </div>

      {/* Add Account Modal */}
      <AddAccountModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleAddAccount}
      />
    </>
  );
}
