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
  Globe,
} from 'lucide-react';

import type { Account, AccountStatus } from '../types';
import { useAppStore } from '../stores/app';
import { useAccountsStore } from '../stores/accounts';
import { t } from '../lib/i18n';
import { cn } from '../lib/utils';
import { ProviderLogo } from './ui/ProviderLogo';
import { UsageBar } from './ui/UsageBar';
import { AccountDrawer } from './ui/AccountDrawer';
import { FloatingActionBar } from './ui/FloatingActionBar';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';

// Helper function for middle truncation of emails
function truncateEmail(email: string, startChars = 10, endChars = 15): string {
  if (email.length <= startChars + endChars + 3) return email;
  return `${email.slice(0, startChars)}...${email.slice(-endChars)}`;
}

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
  onBulkRefresh: (ids: number[]) => Promise<any>;
  isBulkRefreshing: boolean;
  bulkProgress: { current: number; total: number };
  isAccountRefreshing: (accountId: number) => boolean;
  onOpenBrowser?: (accountId: number) => Promise<void>;
}

function formatRelativeTime(dateString?: string): string {
  if (!dateString) return 'Never';
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
  onBulkRefresh,
  isBulkRefreshing,
  bulkProgress,
  isAccountRefreshing,
  onOpenBrowser,
}: AccountsTableProps) {
  const { language } = useAppStore();
  const { sortField, sortDirection, setSortField, setSortDirection } = useAccountsStore();
  const [refreshingIds, setRefreshingIds] = useState<Set<number>>(new Set());
  const [activatingIds, setActivatingIds] = useState<Set<number>>(new Set());
  const [checkingStatusIds, setCheckingStatusIds] = useState<Set<number>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [drawerAccount, setDrawerAccount] = useState<Account | null>(null);
  const itemsPerPage = 50;
  const { copy } = useCopyToClipboard();

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    type: 'single' | 'bulk';
    accountId?: number;
    accountIds?: number[];
  }>({ isOpen: false, type: 'single' });
  const [isDeleting, setIsDeleting] = useState(false);

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
        case 'provider':
          comparison = a.provider.localeCompare(b.provider);
          break;
        case 'email':
          comparison = a.email.localeCompare(b.email);
          break;
        case 'status':
          comparison = a.status.localeCompare(b.status);
          break;
        case 'quota':
          const aRatio = a.quota && a.quota.limit > 0 ? a.quota.used / a.quota.limit : 0;
          const bRatio = b.quota && b.quota.limit > 0 ? b.quota.used / b.quota.limit : 0;
          comparison = aRatio - bRatio;
          break;
        case 'tokenExpires':
          const aDate = a.quota?.resetAt ? new Date(a.quota.resetAt).getTime() : 0;
          const bDate = b.quota?.resetAt ? new Date(b.quota.resetAt).getTime() : 0;
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
    setRefreshingIds(prev => new Set([...prev, accountId]));
    try {
      await onRefreshToken(accountId);
    } finally {
      setRefreshingIds(prev => {
        const next = new Set(prev);
        next.delete(accountId);
        return next;
      });
    }
  };

  const handleActivate = async (account: Account) => {
    const isCurrentlyActive = activeAccountIds[account.provider] === account.id;
    setActivatingIds(prev => new Set([...prev, account.id]));
    try {
      await onActivate(account.provider, isCurrentlyActive ? null : account.id);
    } finally {
      setActivatingIds(prev => {
        const next = new Set(prev);
        next.delete(account.id);
        return next;
      });
    }
  };

  const handleCheckStatus = async (accountId: number) => {
    setCheckingStatusIds(prev => new Set([...prev, accountId]));
    try {
      await onCheckStatus(accountId);
    } finally {
      setCheckingStatusIds(prev => {
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
    copy(email);
  };

  const handleCopyToken = (token: string) => {
    copy(token);
  };

  const isAccountActive = (account: Account) => activeAccountIds[account.provider] === account.id;

  const handleDeleteClick = (accountId: number) => {
    setConfirmDialog({ isOpen: true, type: 'single', accountId });
  };

  const handleBulkDeleteClick = (ids: number[]) => {
    setConfirmDialog({ isOpen: true, type: 'bulk', accountIds: ids });
  };

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    try {
      if (confirmDialog.type === 'single' && confirmDialog.accountId) {
        await onDelete(confirmDialog.accountId);
      } else if (confirmDialog.type === 'bulk' && confirmDialog.accountIds) {
        await onDeleteSelected(confirmDialog.accountIds);
      }
      setConfirmDialog({ isOpen: false, type: 'single' });
    } catch (error) {
      console.error('Delete failed:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  const getConfirmDialogContent = () => {
    if (confirmDialog.type === 'single' && confirmDialog.accountId) {
      const account = accounts.find(a => a.id === confirmDialog.accountId);
      return {
        title: t('accounts.deleteAccountTitle'),
        message: (
          <div>
            <p className="mb-3">{t('accounts.deleteAccountMessage')}</p>
            {account && (
              <div className="bg-white/5 rounded-lg p-3 border border-white/10">
                <p className="text-xs text-slate-400 mb-1">Email:</p>
                <p className="text-sm font-mono text-slate-200">{account.email}</p>
              </div>
            )}
          </div>
        ),
      };
    } else if (confirmDialog.type === 'bulk' && confirmDialog.accountIds) {
      const accountsToDelete = accounts.filter(a => confirmDialog.accountIds?.includes(a.id));
      const previewCount = 3;
      const hasMore = accountsToDelete.length > previewCount;

      return {
        title: t('accounts.deleteBulkTitle'),
        message: (
          <div>
            <p className="mb-3">
              {t('accounts.deleteBulkMessage', { count: confirmDialog.accountIds.length })}
            </p>
            <div className="bg-white/5 rounded-lg p-3 border border-white/10">
              <p className="text-xs text-slate-400 mb-2">{t('accounts.deleteBulkPreview')}</p>
              <ul className="space-y-1">
                {accountsToDelete.slice(0, previewCount).map(account => (
                  <li key={account.id} className="text-xs font-mono text-slate-300">
                    • {account.email}
                  </li>
                ))}
                {hasMore && (
                  <li className="text-xs text-slate-500 italic">
                    ... and {accountsToDelete.length - previewCount} more
                  </li>
                )}
              </ul>
            </div>
          </div>
        ),
      };
    }
    return { title: '', message: '' };
  };

  const dialogContent = getConfirmDialogContent();

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? (
      <ChevronUp size={10} className="text-slate-500" />
    ) : (
      <ChevronDown size={10} className="text-slate-500" />
    );
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
        <div
          className={cn(
            'flex-1 overflow-auto transition-[padding] duration-300 accounts-table-container',
            selectedIds.size > 0 && 'pb-16' // Account for FloatingActionBar height (h-14 + margin)
          )}
        >
          <table className="w-full" role="table" aria-label={t('accounts.accountsTable')}>
            <thead className="sticky top-0 z-10">
              <tr
                className="h-10 border-b border-white/5"
                style={{ background: 'rgba(30, 41, 59, 0.7)' }}
              >
                <th className="w-10 px-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={el => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={e => (e.target.checked ? onSelectAll() : onClearSelection())}
                    className="w-4 h-4 rounded"
                    aria-label={allSelected ? t('accounts.deselectAll') : t('accounts.selectAll')}
                  />
                </th>
                <th className="w-10 px-2"></th>
                <th className="px-3 text-left">
                  <button
                    onClick={() => handleSort('email')}
                    className="flex items-center gap-1 text-xs uppercase tracking-wider text-white/60 font-medium hover:text-white/90 transition-colors"
                  >
                    {t('accountsTable.account')} <SortIcon field="email" />
                  </button>
                </th>
                <th className="w-24 px-3 text-left">
                  <button
                    onClick={() => handleSort('status')}
                    className="flex items-center gap-1 text-xs uppercase tracking-wider text-white/60 font-medium hover:text-white/90 transition-colors"
                  >
                    {t('accountsTable.status')} <SortIcon field="status" />
                  </button>
                </th>
                <th className="w-28 px-3 text-left">
                  <button
                    onClick={() => handleSort('quota')}
                    className="flex items-center gap-1 text-xs uppercase tracking-wider text-white/60 font-medium hover:text-white/90 transition-colors"
                  >
                    {t('accountsTable.usage')} <SortIcon field="quota" />
                  </button>
                </th>
                <th className="w-32 px-3 text-left">
                  <button
                    onClick={() => handleSort('createdAt')}
                    className="flex items-center gap-1 text-xs uppercase tracking-wider text-white/60 font-medium hover:text-white/90 transition-colors"
                  >
                    {t('accountsTable.created')} <SortIcon field="createdAt" />
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
                  const isRefreshing =
                    refreshingIds.has(account.id) || isAccountRefreshing(account.id);
                  const isActivating = activatingIds.has(account.id);
                  const isCheckingStatus = checkingStatusIds.has(account.id);
                  const isActive = isAccountActive(account);
                  const isSelected = selectedIds.has(account.id);
                  const isSyncing = isAccountRefreshing(account.id);

                  return (
                    <tr
                      key={account.id}
                      onClick={e => handleRowClick(account, e)}
                      className={cn(
                        'transition-colors group cursor-pointer',
                        // Subtle zebra striping (even rows - 0, 2, 4...)
                        index % 2 === 0 && !isSelected && !isActive && 'bg-white/[0.01]',
                        // Selection and active states
                        isSelected && 'bg-indigo-500/10',
                        isActive && 'bg-emerald-500/5 border-l-2 border-l-emerald-400',
                        // Syncing state - subtle pulse
                        isSyncing && 'bg-indigo-500/5 animate-pulse',
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
                            onClick={e => {
                              e.stopPropagation();
                              handleCopyEmail(account.email);
                            }}
                          >
                            <span
                              className={cn(
                                'text-xs font-medium truncate',
                                account.status === 'banned'
                                  ? 'text-slate-500 line-through'
                                  : 'text-slate-200'
                              )}
                              title={account.email}
                            >
                              {truncateEmail(account.email)}
                            </span>
                            <Copy className="w-3 h-3 text-slate-600 opacity-0 group-hover/email:opacity-100 transition-opacity shrink-0" />
                          </div>

                          {/* Token row - clickable to copy */}
                          {account.token && (
                            <div
                              className="group/token flex items-center gap-1.5 cursor-pointer"
                              onClick={e => {
                                e.stopPropagation();
                                handleCopyToken(account.token!);
                              }}
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
                        <div className="flex items-center gap-1.5">
                          {isSyncing ? (
                            <div className="flex items-center gap-1.5 animate-pulse">
                              <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />
                              <span className="text-[10px] text-indigo-300 font-medium">
                                Syncing...
                              </span>
                            </div>
                          ) : (
                            <>
                              {/* Unified minimal dot + text style for ALL statuses */}
                              <div className="flex items-center gap-1.5">
                                <div
                                  className={cn(
                                    'w-1.5 h-1.5 rounded-full',
                                    account.status === 'active' && 'bg-emerald-400',
                                    account.status === 'banned' && 'bg-red-400',
                                    account.status === 'limit_hit' && 'bg-amber-400',
                                    account.status === 'expired' && 'bg-slate-400'
                                  )}
                                />
                                <span
                                  className={cn(
                                    'text-xs font-medium',
                                    account.status === 'active' && 'text-emerald-400',
                                    account.status === 'banned' && 'text-red-400',
                                    account.status === 'limit_hit' && 'text-amber-400',
                                    account.status === 'expired' && 'text-slate-400'
                                  )}
                                >
                                  {getStatusLabel(account.status as AccountStatus)}
                                </span>
                              </div>
                              {/* Quota warning badge when >80% */}
                              {account.quota &&
                                account.quota.limit > 0 &&
                                account.quota.used / account.quota.limit > 0.8 && (
                                  <span
                                    className="text-[9px] text-amber-400/70"
                                    title={`Quota almost full: ${Math.round((account.quota.used / account.quota.limit) * 100)}% used`}
                                  >
                                    ⚠️
                                  </span>
                                )}
                            </>
                          )}
                        </div>
                      </td>

                      {/* Usage Bar */}
                      <td className="py-3 px-3 align-middle">
                        <UsageBar
                          used={account.quota?.used || 0}
                          limit={account.quota?.limit || 0}
                        />
                      </td>

                      {/* Created At */}
                      <td className="py-3 px-3 align-middle">
                        <span className="text-[10px] text-slate-500 tabular-nums">
                          {formatRelativeTime(account.createdAt)}
                        </span>
                      </td>

                      {/* Last Active */}
                      <td className="py-3 px-3 align-middle">
                        <span className="text-[10px] text-slate-500 tabular-nums">
                          {formatRelativeTime(account.lastUsedAt || account.createdAt)}
                        </span>
                      </td>

                      {/* Actions - Always visible */}
                      <td className="py-3 px-3 align-middle">
                        <div className="flex items-center gap-1">
                          {/* Refresh / Check Status */}
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              // Prefer status check over simple refresh for Kiro/Windsurf
                              if (account.provider === 'kiro' || account.provider === 'windsurf') {
                                handleCheckStatus(account.id);
                              } else {
                                handleRefresh(account.id);
                              }
                            }}
                            disabled={isRefreshing || isCheckingStatus}
                            className="p-1.5 rounded-sm text-slate-400 hover:text-white hover:bg-white/[0.03] transition-colors disabled:opacity-30"
                            aria-label={t('accountsTable.refresh')}
                            title={t('accountsTable.checkStatus')}
                          >
                            <RefreshCw
                              size={12}
                              className={isRefreshing || isCheckingStatus ? 'animate-spin' : ''}
                            />
                          </button>

                          {/* Open Browser */}
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              onOpenBrowser?.(account.id);
                            }}
                            className="p-1.5 rounded-sm text-slate-400 hover:text-indigo-400 hover:bg-indigo-400/10 transition-colors"
                            title="Open in Browser"
                          >
                            <Globe size={12} />
                          </button>

                          {/* Play/Stop */}
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              handleActivate(account);
                            }}
                            disabled={isActivating || account.status !== 'active'}
                            className={cn(
                              'p-1.5 rounded-sm transition-colors',
                              isActive
                                ? 'text-amber-400 hover:bg-amber-400/10'
                                : 'text-emerald-400 hover:bg-emerald-400/10',
                              'disabled:opacity-30 disabled:cursor-not-allowed'
                            )}
                            aria-label={
                              isActive ? t('accounts.deactivate') : t('accounts.activate')
                            }
                          >
                            {isActivating ? (
                              <RefreshCw size={12} className="animate-spin" />
                            ) : isActive ? (
                              <Square size={12} />
                            ) : (
                              <Play size={12} className="fill-current" />
                            )}
                          </button>

                          {/* More Menu - Only visible on hover */}
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity relative">
                            <button
                              onClick={e => {
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
                                className="absolute right-0 top-full mt-1 w-40 rounded-lg shadow-2xl z-50 py-1 backdrop-blur-xl"
                                style={{
                                  background: 'rgba(26, 26, 26, 0.95)',
                                  border: '1px solid rgba(255,255,255,0.1)',
                                }}
                                role="menu"
                                aria-label={t('accounts.accountActions')}
                              >
                                <button
                                  onClick={e => {
                                    e.stopPropagation();
                                    handleCheckStatus(account.id);
                                    setOpenMenuId(null);
                                  }}
                                  disabled={isCheckingStatus}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-400 hover:bg-white/5 hover:text-slate-200 disabled:opacity-50 transition-colors"
                                  role="menuitem"
                                >
                                  <Activity
                                    size={12}
                                    className={isCheckingStatus ? 'animate-pulse' : ''}
                                    aria-hidden="true"
                                  />
                                  <span>
                                    {isCheckingStatus
                                      ? t('accountsTable.checkingStatus') || 'Checking...'
                                      : t('accountsTable.checkStatus')}
                                  </span>
                                </button>
                                <button
                                  onClick={e => {
                                    e.stopPropagation();
                                    handleRefresh(account.id);
                                    setOpenMenuId(null);
                                  }}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-400 hover:bg-white/5 hover:text-slate-200 transition-colors"
                                  role="menuitem"
                                >
                                  <RefreshCw
                                    size={12}
                                    className={isRefreshing ? 'animate-spin' : ''}
                                    aria-hidden="true"
                                  />
                                  <span>{t('accountsTable.refresh')}</span>
                                </button>
                                <button
                                  onClick={e => {
                                    e.stopPropagation();
                                    copy(account.token ?? '');
                                    setOpenMenuId(null);
                                  }}
                                  disabled={!account.token}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-slate-400 hover:bg-white/5 hover:text-slate-200 disabled:opacity-50 transition-colors"
                                  role="menuitem"
                                >
                                  <Copy size={12} aria-hidden="true" />
                                  <span>{t('accountsTable.copyToken')}</span>
                                </button>
                                <div className="h-px bg-white/5 my-1" />
                                <button
                                  onClick={e => {
                                    e.stopPropagation();
                                    handleDeleteClick(account.id);
                                    setOpenMenuId(null);
                                  }}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
                                  role="menuitem"
                                >
                                  <Trash2 size={12} aria-hidden="true" />
                                  <span>{t('accountsTable.delete')}</span>
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
        <div
          className="h-8 px-3 flex items-center justify-between border-t border-white/5"
          style={{ background: 'rgba(30, 41, 59, 0.5)' }}
        >
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
        onDelete={() => handleBulkDeleteClick([...selectedIds])}
        onRefreshAll={() => onBulkRefresh([...selectedIds])}
        onClear={onClearSelection}
        isRefreshing={isBulkRefreshing}
        refreshProgress={bulkProgress}
      />

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog({ isOpen: false, type: 'single' })}
        onConfirm={handleConfirmDelete}
        title={dialogContent.title}
        message={dialogContent.message}
        confirmText={t('accounts.confirmDelete')}
        cancelText={t('common.cancel')}
        variant="danger"
        isLoading={isDeleting}
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
