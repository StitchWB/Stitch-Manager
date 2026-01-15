import { useState, useMemo, useEffect } from 'react';
import {
  Copy,
  Trash2,
  RefreshCw,
  ChevronUp,
  ChevronDown,
  MoreHorizontal,
  Users,
  ChevronLeft,
  ChevronRight,
  Play,
  Square,
  Activity,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Account, AccountStatus } from '../types';
import { useAppStore } from '../stores/app';
import { t } from '../lib/i18n';
import { cn } from '../lib/utils';
import { ProviderLogo } from './ui/ProviderLogo';
import { UsageBar } from './ui/UsageBar';
import { StatusBadge } from './ui/StatusBadge';
import { AccountDrawer } from './ui/AccountDrawer';
import { FloatingActionBar } from './ui/FloatingActionBar';
import { useBulkRefresh } from '../hooks/useBulkRefresh';

// Helper function for middle truncation of emails
function truncateEmail(email: string, startChars = 10, endChars = 15): string {
  if (email.length <= startChars + endChars + 3) return email;
  return `${email.slice(0, startChars)}...${email.slice(-endChars)}`;
}

// Status badge variant mapping
const getStatusVariant = (status: AccountStatus): 'success' | 'error' | 'warning' | 'neutral' => {
  const variantMap: Record<AccountStatus, 'success' | 'error' | 'warning' | 'neutral'> = {
    active: 'success',
    banned: 'error',
    limit_hit: 'warning',
    expired: 'neutral',
    unknown: 'neutral',
  };
  return variantMap[status];
};

const getStatusLabel = (status: AccountStatus): string => {
  const statusMap: Record<AccountStatus, string> = {
    active: t('status.active'),
    banned: t('status.banned'),
    limit_hit: t('status.limitHit'),
    expired: t('status.expired'),
    unknown: t('status.unknown'),
  };
  return statusMap[status];
};

type SortField = 'provider' | 'email' | 'status' | 'quota' | 'tokenExpires' | 'createdAt';
type SortDirection = 'asc' | 'desc';

interface AccountsTableProps {
  accounts: Account[];
  isLoading: boolean;
  selectedIds: Set<number>;
  activeAccountIds: Record<string, number | null>;
  onToggleSelection: (accountId: number) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onRefreshToken: (accountId: number) => Promise<void>;
  onCopyToken: (token: string) => void;
  onDelete: (accountId: number) => void;
  onDeleteSelected: (ids: number[]) => void;
  onActivate: (provider: string, accountId: number | null) => Promise<void>;
  onExportCSV: () => void;
  onCheckStatus: (accountId: number) => Promise<void>;
}

function formatRelativeTime(dateString?: string): string {
  if (!dateString) return '—';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return t('time.now');
  if (diffMins < 60) return t('time.minutesAgo', { count: diffMins });
  if (diffHours < 24) return t('time.hoursAgo', { count: diffHours });
  if (diffDays < 30) return t('time.daysAgo', { count: diffDays });
  return t('time.monthsAgo', { count: Math.floor(diffDays / 30) });
}

export default function AccountsTable({
  accounts,
  isLoading,
  selectedIds,
  activeAccountIds,
  onToggleSelection,
  onSelectAll,
  onClearSelection,
  onRefreshToken,
  onCopyToken,
  onDelete,
  onDeleteSelected,
  onActivate,
  onExportCSV,
  onCheckStatus,
}: AccountsTableProps) {
  const { language } = useAppStore();
  const [sortField, setSortField] = useState<SortField>('email');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [refreshingIds, setRefreshingIds] = useState<Set<number>>(new Set());
  const [activatingIds, setActivatingIds] = useState<Set<number>>(new Set());
  const [checkingStatusIds, setCheckingStatusIds] = useState<Set<number>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [drawerAccount, setDrawerAccount] = useState<Account | null>(null);
  const itemsPerPage = 50;

  // Bulk refresh hook
  const { 
    isRefreshing: isBulkRefreshing, 
    progress: bulkProgress, 
    startBulkRefresh,
    isAccountRefreshing,
  } = useBulkRefresh({
    concurrency: 3,
    delayMs: 500,
  });

  void language;

  useEffect(() => {
    const handleClick = () => setOpenMenuId(null);
    if (openMenuId !== null) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [openMenuId]);

  const sortedAccounts = useMemo(() => {
    return [...accounts].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'provider': comparison = a.provider.localeCompare(b.provider); break;
        case 'email': comparison = a.email.localeCompare(b.email); break;
        case 'status': comparison = a.status.localeCompare(b.status); break;
        case 'quota':
          const aRatio = a.quota.limit > 0 ? a.quota.used / a.quota.limit : 0;
          const bRatio = b.quota.limit > 0 ? b.quota.used / b.quota.limit : 0;
          comparison = aRatio - bRatio;
          break;
        case 'tokenExpires':
          const aDate = a.quota.resetAt ? new Date(a.quota.resetAt).getTime() : 0;
          const bDate = b.quota.resetAt ? new Date(b.quota.resetAt).getTime() : 0;
          comparison = aDate - bDate;
          break;
        case 'createdAt':
          const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          comparison = aCreated - bCreated;
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [accounts, sortField, sortDirection]);

  const totalPages = Math.ceil(sortedAccounts.length / itemsPerPage);
  const paginatedAccounts = sortedAccounts.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const handleRefresh = async (accountId: number) => {
    setRefreshingIds((prev) => new Set([...prev, accountId]));
    try {
      await onRefreshToken(accountId);
    } finally {
      setRefreshingIds((prev) => {
        const next = new Set(prev);
        next.delete(accountId);
        return next;
      });
    }
  };

  const handleActivate = async (account: Account) => {
    const isCurrentlyActive = activeAccountIds[account.provider] === account.id;
    setActivatingIds((prev) => new Set([...prev, account.id]));
    try {
      await onActivate(account.provider, isCurrentlyActive ? null : account.id);
    } finally {
      setActivatingIds((prev) => {
        const next = new Set(prev);
        next.delete(account.id);
        return next;
      });
    }
  };

  const handleCheckStatus = async (accountId: number) => {
    setCheckingStatusIds((prev) => new Set([...prev, accountId]));
    try {
      await onCheckStatus(accountId);
    } finally {
      setCheckingStatusIds((prev) => {
        const next = new Set(prev);
        next.delete(accountId);
        return next;
      });
    }
  };

  const handleRowClick = (account: Account, e: React.MouseEvent) => {
    // Don't open drawer if clicking on checkbox or action buttons
    const target = e.target as HTMLElement;
    if (target.closest('input[type="checkbox"]') || target.closest('button')) return;
    setDrawerAccount(account);
  };

  const handleCopyEmail = (email: string) => {
    navigator.clipboard.writeText(email);
    toast.success('Email copied!', { duration: 1500 });
  };

  const handleCopyToken = (token: string) => {
    onCopyToken(token);
    toast.success('Token copied!', { duration: 1500 });
  };

  const isAccountActive = (account: Account) => activeAccountIds[account.provider] === account.id;

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' 
      ? <ChevronUp size={10} className="text-slate-500" />
      : <ChevronDown size={10} className="text-slate-500" />;
  };

  const allSelected = accounts.length > 0 && selectedIds.size === accounts.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < accounts.length;

  return (
    <>
      <div 
        className="flex flex-col h-full rounded-lg overflow-hidden"
        style={{ border: '1px solid rgba(255,255,255,0.05)', background: 'rgba(255,255,255,0.02)' }}
        role="region"
        aria-label={t('accounts.tableRegion')}
      >
        {/* Table */}
        <div className={cn(
          "flex-1 overflow-auto transition-[padding] duration-300",
          selectedIds.size > 0 && "pb-16" // Account for FloatingActionBar height (h-14 + margin)
        )}>
          <table className="w-full" role="table" aria-label={t('accounts.accountsTable')}>
            <thead className="sticky top-0 z-10">
              <tr className="h-10 border-b border-white/5" style={{ background: 'rgba(30, 41, 59, 0.7)' }}>
                <th className="w-10 px-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                    onChange={(e) => (e.target.checked ? onSelectAll() : onClearSelection())}
                    className="w-4 h-4 rounded"
                    aria-label={allSelected ? t('accounts.deselectAll') : t('accounts.selectAll')}
                  />
                </th>
                <th className="w-10 px-2"></th>
                <th className="px-3 text-left">
                  <button onClick={() => handleSort('email')} className="flex items-center gap-1 text-xs uppercase tracking-wider text-white/60 font-medium hover:text-white/90 transition-colors">
                    {t('accountsTable.account')} <SortIcon field="email" />
                  </button>
                </th>
                <th className="w-24 px-3 text-left">
                  <button onClick={() => handleSort('status')} className="flex items-center gap-1 text-xs uppercase tracking-wider text-white/60 font-medium hover:text-white/90 transition-colors">
                    {t('accountsTable.status')} <SortIcon field="status" />
                  </button>
                </th>
                <th className="w-28 px-3 text-left">
                  <button onClick={() => handleSort('quota')} className="flex items-center gap-1 text-xs uppercase tracking-wider text-white/60 font-medium hover:text-white/90 transition-colors">
                    {t('accountsTable.usage')} <SortIcon field="quota" />
                  </button>
                </th>
                <th className="w-20 px-3 text-left">
                  <span className="text-xs uppercase tracking-wider text-white/60 font-medium">
                    {t('accountsTable.last')}
                  </span>
                </th>
                <th className="w-16 px-3"></th>
              </tr>
            </thead>

            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="h-48">
                    <div className="flex items-center justify-center gap-2 text-slate-500">
                      <RefreshCw size={14} className="animate-spin" />
                      <span className="text-xs">{t('accountsTable.loading')}</span>
                    </div>
                  </td>
                </tr>
              ) : paginatedAccounts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="h-48">
                    <div className="flex flex-col items-center justify-center text-slate-500">
                      <Users className="w-10 h-10 mb-2 opacity-30" />
                      <p className="text-xs">{t('accountsTable.noAccounts')}</p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedAccounts.map((account, index) => {
                  const isRefreshing = refreshingIds.has(account.id) || isAccountRefreshing(account.id);
                  const isActivating = activatingIds.has(account.id);
                  const isCheckingStatus = checkingStatusIds.has(account.id);
                  const isActive = isAccountActive(account);
                  const isSelected = selectedIds.has(account.id);
                  const isSyncing = isAccountRefreshing(account.id);

                  return (
                    <tr 
                      key={account.id} 
                      onClick={(e) => handleRowClick(account, e)}
                      className={cn(
                        'transition-colors group cursor-pointer',
                        // Subtle zebra striping (even rows - 0, 2, 4...)
                        index % 2 === 0 && !isSelected && !isActive && 'bg-white/[0.01]',
                        // Selection and active states
                        isSelected && 'bg-indigo-500/10',
                        isActive && 'bg-emerald-500/5 border-l-2 border-l-emerald-400',
                        // Improved hover effect
                        !isSelected && !isActive && 'hover:bg-white/[0.03]'
                      )}
                    >
                      {/* Checkbox */}
                      <td className="py-3 px-3 align-middle">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => onToggleSelection(account.id)}
                          className="w-4 h-4 rounded"
                          aria-label={`${isSelected ? t('accounts.deselect') : t('accounts.select')} ${account.email}`}
                        />
                      </td>

                      {/* Provider Logo */}
                      <td className="py-3 px-2 align-middle">
                        <ProviderLogo provider={account.provider} size={18} colored={isActive} />
                      </td>

                      {/* Email & Token ID */}
                      <td className="py-3 px-3 min-w-0 align-middle">
                        <div className="flex flex-col min-w-0 gap-0.5">
                          {/* Email row - clickable to copy */}
                          <div 
                            className="group/email flex items-center gap-1.5 cursor-pointer"
                            onClick={(e) => { e.stopPropagation(); handleCopyEmail(account.email); }}
                          >
                            <span className={cn(
                              'text-xs font-medium truncate',
                              account.status === 'banned' ? 'text-slate-500 line-through' : 'text-slate-200'
                            )} title={account.email}>
                              {truncateEmail(account.email)}
                            </span>
                            <Copy className="w-3 h-3 text-slate-600 opacity-0 group-hover/email:opacity-100 transition-opacity shrink-0" />
                          </div>
                          
                          {/* Token row - clickable to copy */}
                          {account.token && (
                            <div 
                              className="group/token flex items-center gap-1.5 cursor-pointer"
                              onClick={(e) => { e.stopPropagation(); handleCopyToken(account.token!); }}
                            >
                              <span className="text-[10px] font-mono text-slate-500 truncate">
                                tk_...{account.token.slice(-8)}
                              </span>
                              <Copy className="w-2.5 h-2.5 text-slate-600 opacity-0 group-hover/token:opacity-100 transition-opacity shrink-0" />
                            </div>
                          )}
                          {!account.token && (
                            <span className="text-[10px] font-mono text-slate-600">—</span>
                          )}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3 px-3 align-middle">
                        {isSyncing ? (
                          <div className="flex items-center gap-1.5">
                            <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />
                            <span className="text-[10px] text-indigo-300">Syncing...</span>
                          </div>
                        ) : (
                          <StatusBadge variant={getStatusVariant(account.status)}>
                            {getStatusLabel(account.status)}
                          </StatusBadge>
                        )}
                      </td>

                      {/* Usage Bar */}
                      <td className="py-3 px-3 align-middle">
                        <UsageBar used={account.quota.used} limit={account.quota.limit} />
                      </td>

                      {/* Last Active */}
                      <td className="py-3 px-3 align-middle">
                        <span className="text-[10px] text-slate-500 tabular-nums">
                          {formatRelativeTime(account.lastUsedAt || account.createdAt)}
                        </span>
                      </td>

                      {/* Actions - Hover visible */}
                      <td className="py-3 px-3 align-middle">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {/* Play/Stop */}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleActivate(account); }}
                            disabled={isActivating || account.status !== 'active'}
                            className={cn(
                              'p-1.5 rounded-sm transition-colors',
                              isActive 
                                ? 'text-amber-400 hover:bg-amber-400/10' 
                                : 'text-emerald-400 hover:bg-emerald-400/10',
                              'disabled:opacity-30 disabled:cursor-not-allowed'
                            )}
                            aria-label={isActive ? t('accounts.deactivate') : t('accounts.activate')}
                          >
                            {isActivating ? (
                              <RefreshCw size={12} className="animate-spin" />
                            ) : isActive ? (
                              <Square size={12} />
                            ) : (
                              <Play size={12} className="fill-current" />
                            )}
                          </button>

                          {/* More Menu */}
                          <div className="relative">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuId(openMenuId === account.id ? null : account.id);
                              }}
                              className="p-1.5 rounded-sm text-slate-500 hover:text-slate-200 hover:bg-white/[0.03] transition-colors"
                              aria-label={t('accounts.moreActions')}
                              aria-expanded={openMenuId === account.id}
                              aria-haspopup="menu"
                            >
                              <MoreHorizontal size={12} aria-hidden="true" />
                            </button>
                            
                            {openMenuId === account.id && (
                              <div 
                                className="absolute right-0 top-full mt-1 w-36 rounded-sm shadow-xl z-50 py-1"
                                style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.05)' }}
                                role="menu"
                                aria-label={t('accounts.accountActions')}
                              >
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleCheckStatus(account.id); setOpenMenuId(null); }}
                                  disabled={isCheckingStatus}
                                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-slate-500 hover:bg-white/[0.03] hover:text-slate-200 disabled:opacity-50"
                                  role="menuitem"
                                >
                                  <Activity size={10} className={isCheckingStatus ? 'animate-pulse' : ''} aria-hidden="true" />
                                  {t('accountsTable.checkStatus')}
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleRefresh(account.id); setOpenMenuId(null); }}
                                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-slate-500 hover:bg-white/[0.03] hover:text-slate-200"
                                  role="menuitem"
                                >
                                  <RefreshCw size={10} className={isRefreshing ? 'animate-spin' : ''} aria-hidden="true" />
                                  {t('accountsTable.refresh')}
                                </button>
                                <button
                                  onClick={(e) => { 
                                    e.stopPropagation(); 
                                    onCopyToken(account.token ?? ''); 
                                    toast.success(t('accounts.tokenCopied'));
                                    setOpenMenuId(null); 
                                  }}
                                  disabled={!account.token}
                                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-slate-500 hover:bg-white/[0.03] hover:text-slate-200 disabled:opacity-50"
                                  role="menuitem"
                                >
                                  <Copy size={10} aria-hidden="true" />
                                  {t('accountsTable.copyToken')}
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); onDelete(account.id); setOpenMenuId(null); }}
                                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-red-400 hover:bg-red-400/10"
                                  role="menuitem"
                                >
                                  <Trash2 size={10} aria-hidden="true" />
                                  {t('accountsTable.delete')}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="h-8 px-3 flex items-center justify-between border-t border-white/5" style={{ background: 'rgba(30, 41, 59, 0.5)' }}>
          <span className="text-[10px] text-slate-500" aria-live="polite">
            {sortedAccounts.length} {t('accountsTable.accounts')}
          </span>
          
          {totalPages > 1 && (
            <nav className="flex items-center gap-1" aria-label={t('accounts.pagination')}>
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1 text-slate-500 hover:text-slate-200 disabled:opacity-30"
                aria-label={t('accounts.previousPage')}
              >
                <ChevronLeft size={12} aria-hidden="true" />
              </button>
              <span className="text-[10px] text-slate-500 px-1 tabular-nums" aria-current="page">
                {currentPage}/{totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1 text-slate-500 hover:text-slate-200 disabled:opacity-30"
                aria-label={t('accounts.nextPage')}
              >
                <ChevronRight size={12} aria-hidden="true" />
              </button>
            </nav>
          )}
        </div>
      </div>

      {/* Floating Action Bar */}
      <FloatingActionBar
        selectedCount={selectedIds.size}
        onExport={onExportCSV}
        onDelete={() => onDeleteSelected([...selectedIds])}
        onRefreshAll={() => startBulkRefresh([...selectedIds])}
        onClear={onClearSelection}
        isRefreshing={isBulkRefreshing}
        refreshProgress={bulkProgress}
      />

      {/* Account Drawer */}
      <AccountDrawer
        account={drawerAccount}
        isOpen={!!drawerAccount}
        onClose={() => setDrawerAccount(null)}
        onCopyToken={onCopyToken}
        onRefresh={handleRefresh}
        onDelete={onDelete}
        isActive={drawerAccount ? isAccountActive(drawerAccount) : false}
      />
    </>
  );
}
