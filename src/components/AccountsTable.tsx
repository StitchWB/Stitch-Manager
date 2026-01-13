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
} from 'lucide-react';
import type { Account, AccountStatus } from '../types';
import { useAppStore } from '../stores/app';
import { t } from '../lib/i18n';
import { cn } from '../lib/utils';
import { ProviderLogo } from './ui/ProviderLogo';
import { UsageBar } from './ui/UsageBar';
import { AccountDrawer } from './ui/AccountDrawer';
import { FloatingActionBar } from './ui/FloatingActionBar';

// Status dot styles
const statusDot: Record<AccountStatus, string> = {
  active: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]',
  banned: 'bg-red-400',
  limit_hit: 'bg-amber-400',
  expired: 'bg-slate-500',
  unknown: 'bg-slate-500',
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
  onDeleteSelected?: (ids: number[]) => void;
  onActivate: (provider: string, accountId: number | null) => Promise<void>;
  onExportCSV?: () => void;
  onCheckStatus?: (accountId: number) => Promise<void>;
}

function formatRelativeTime(dateString?: string): string {
  if (!dateString) return '—';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
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
    if (!onCheckStatus) return;
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
      >
        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 z-10">
              <tr className="h-9 border-b border-white/5" style={{ background: 'rgba(30, 41, 59, 0.5)' }}>
                <th className="w-10 px-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                    onChange={(e) => (e.target.checked ? onSelectAll() : onClearSelection())}
                    className="w-3.5 h-3.5 accent-indigo-500 rounded-sm"
                  />
                </th>
                <th className="w-10 px-2"></th>
                <th className="px-3 text-left">
                  <button onClick={() => handleSort('email')} className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500 font-semibold hover:text-slate-200">
                    Account <SortIcon field="email" />
                  </button>
                </th>
                <th className="w-20 px-3 text-left">
                  <button onClick={() => handleSort('status')} className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500 font-semibold hover:text-slate-200">
                    Status <SortIcon field="status" />
                  </button>
                </th>
                <th className="w-24 px-3 text-left">
                  <button onClick={() => handleSort('quota')} className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500 font-semibold hover:text-slate-200">
                    Usage <SortIcon field="quota" />
                  </button>
                </th>
                <th className="w-20 px-3 text-left">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                    Last
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
                      <span className="text-xs">Loading...</span>
                    </div>
                  </td>
                </tr>
              ) : paginatedAccounts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="h-48">
                    <div className="flex flex-col items-center justify-center text-slate-500">
                      <Users className="w-10 h-10 mb-2 opacity-30" />
                      <p className="text-xs">No accounts</p>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedAccounts.map((account) => {
                  const isRefreshing = refreshingIds.has(account.id);
                  const isActivating = activatingIds.has(account.id);
                  const isCheckingStatus = checkingStatusIds.has(account.id);
                  const isActive = isAccountActive(account);
                  const isSelected = selectedIds.has(account.id);

                  return (
                    <tr 
                      key={account.id} 
                      onClick={(e) => handleRowClick(account, e)}
                      className={cn(
                        'h-12 border-b border-white/[0.03] transition-colors duration-100 group cursor-pointer',
                        isSelected && 'bg-indigo-500/10',
                        isActive && 'bg-emerald-500/5 border-l-2 border-l-emerald-400',
                        !isSelected && !isActive && 'hover:bg-white/[0.03]'
                      )}
                    >
                      {/* Checkbox */}
                      <td className="px-3">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => onToggleSelection(account.id)}
                          className="w-3.5 h-3.5 accent-indigo-500 rounded-sm"
                        />
                      </td>

                      {/* Provider Logo */}
                      <td className="px-2">
                        <ProviderLogo provider={account.provider} size={18} colored={isActive} />
                      </td>

                      {/* Email & Token ID */}
                      <td className="px-3 min-w-0">
                        <div className="flex flex-col min-w-0">
                          <span className={cn(
                            'text-xs font-medium truncate',
                            account.status === 'banned' ? 'text-slate-500 line-through' : 'text-slate-200'
                          )}>
                            {account.email}
                          </span>
                          <span className="text-[10px] font-mono text-slate-500 truncate">
                            {account.token ? `tk_...${account.token.slice(-8)}` : '—'}
                          </span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-3">
                        <div className="flex items-center gap-1.5">
                          <div className={cn('w-1.5 h-1.5 rounded-full', statusDot[account.status])} />
                          <span className="text-[10px] text-slate-500">{getStatusLabel(account.status)}</span>
                        </div>
                      </td>

                      {/* Usage Bar */}
                      <td className="px-3">
                        <UsageBar used={account.quota.used} limit={account.quota.limit} />
                      </td>

                      {/* Last Active */}
                      <td className="px-3">
                        <span className="text-[10px] text-slate-500 tabular-nums">
                          {formatRelativeTime(account.lastUsedAt || account.createdAt)}
                        </span>
                      </td>

                      {/* Actions - Hover visible */}
                      <td className="px-3">
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
                            >
                              <MoreHorizontal size={12} />
                            </button>
                            
                            {openMenuId === account.id && (
                              <div 
                                className="absolute right-0 top-full mt-1 w-36 rounded-sm shadow-xl z-50 py-1"
                                style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid rgba(255,255,255,0.05)' }}
                              >
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleCheckStatus(account.id); setOpenMenuId(null); }}
                                  disabled={isCheckingStatus}
                                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-slate-500 hover:bg-white/[0.03] hover:text-slate-200 disabled:opacity-50"
                                >
                                  <Activity size={10} className={isCheckingStatus ? 'animate-pulse' : ''} />
                                  Check Status
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleRefresh(account.id); setOpenMenuId(null); }}
                                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-slate-500 hover:bg-white/[0.03] hover:text-slate-200"
                                >
                                  <RefreshCw size={10} className={isRefreshing ? 'animate-spin' : ''} />
                                  Refresh
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); onCopyToken(account.token ?? ''); setOpenMenuId(null); }}
                                  disabled={!account.token}
                                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-slate-500 hover:bg-white/[0.03] hover:text-slate-200 disabled:opacity-50"
                                >
                                  <Copy size={10} />
                                  Copy Token
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); onDelete(account.id); setOpenMenuId(null); }}
                                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-red-400 hover:bg-red-400/10"
                                >
                                  <Trash2 size={10} />
                                  Delete
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
          <span className="text-[10px] text-slate-500">
            {sortedAccounts.length} accounts
          </span>
          
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1 text-slate-500 hover:text-slate-200 disabled:opacity-30"
              >
                <ChevronLeft size={12} />
              </button>
              <span className="text-[10px] text-slate-500 px-1 tabular-nums">
                {currentPage}/{totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1 text-slate-500 hover:text-slate-200 disabled:opacity-30"
              >
                <ChevronRight size={12} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Floating Action Bar */}
      <FloatingActionBar
        selectedCount={selectedIds.size}
        onExport={onExportCSV || (() => {})}
        onDelete={() => onDeleteSelected?.([...selectedIds])}
        onRefreshAll={() => {
          selectedIds.forEach(id => handleRefresh(id));
        }}
        onClear={onClearSelection}
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
