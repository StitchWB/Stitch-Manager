import { useState, useMemo, useRef, useEffect } from 'react';
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
  Star,
  Zap,
  Play,
} from 'lucide-react';
import type { Account, AccountStatus } from '../types';
import { useAppStore } from '../stores/app';
import { t } from '../lib/i18n';

// Minimal status config - just dot color
const statusDot: Record<AccountStatus, string> = {
  active: 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]',
  banned: 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]',
  limit_hit: 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]',
  expired: 'bg-slate-500',
  unknown: 'bg-slate-600',
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

// Provider badge styles
const providerBadge: Record<string, { bg: string; text: string; border: string; label: string }> = {
  kiro: { 
    bg: 'bg-indigo-500/10', 
    text: 'text-indigo-400', 
    border: 'border-indigo-500/20',
    label: 'Kiro'
  },
  windsurf: { 
    bg: 'bg-cyan-500/10', 
    text: 'text-cyan-400', 
    border: 'border-cyan-500/20',
    label: 'Windsurf'
  },
  trae: { 
    bg: 'bg-emerald-500/10', 
    text: 'text-emerald-400', 
    border: 'border-emerald-500/20',
    label: 'Trae'
  },
};

type SortField = 'provider' | 'email' | 'status' | 'quota' | 'tokenExpires';
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
  onActivate: (provider: string, accountId: number | null) => Promise<void>;
}

function formatRelativeTime(dateString?: string): string {
  if (!dateString) return '—';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  
  if (diffMs < 0) {
    const absDays = Math.abs(diffDays);
    if (absDays > 30) return t('time.monthsAgo', { count: Math.floor(absDays / 30) });
    if (absDays > 0) return t('time.daysAgo', { count: absDays });
    return t('time.hoursAgo', { count: Math.abs(diffHours) });
  }
  if (diffDays > 30) return t('time.inMonths', { count: Math.floor(diffDays / 30) });
  if (diffDays > 0) return t('time.inDays', { count: diffDays });
  if (diffHours > 0) return t('time.inHours', { count: diffHours });
  return t('time.soon');
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
  onActivate,
}: AccountsTableProps) {
  const { language } = useAppStore();
  const [sortField, setSortField] = useState<SortField>('email');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [refreshingIds, setRefreshingIds] = useState<Set<number>>(new Set());
  const [activatingIds, setActivatingIds] = useState<Set<number>>(new Set());
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;
  
  const deleteConfirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Force re-render when language changes
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _lang = language;
  
  useEffect(() => {
    return () => {
      if (deleteConfirmTimeoutRef.current) clearTimeout(deleteConfirmTimeoutRef.current);
    };
  }, []);

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

  const handleDelete = (accountId: number) => {
    if (deleteConfirmId === accountId) {
      onDelete(accountId);
      setDeleteConfirmId(null);
      if (deleteConfirmTimeoutRef.current) {
        clearTimeout(deleteConfirmTimeoutRef.current);
      }
    } else {
      setDeleteConfirmId(accountId);
      if (deleteConfirmTimeoutRef.current) clearTimeout(deleteConfirmTimeoutRef.current);
      deleteConfirmTimeoutRef.current = setTimeout(() => setDeleteConfirmId(null), 3000);
    }
  };

  const handleActivate = async (account: Account) => {
    const isCurrentlyActive = activeAccountIds[account.provider] === account.id;
    setActivatingIds((prev) => new Set([...prev, account.id]));
    try {
      // If already active, deactivate (set to null), otherwise activate
      await onActivate(account.provider, isCurrentlyActive ? null : account.id);
    } finally {
      setActivatingIds((prev) => {
        const next = new Set(prev);
        next.delete(account.id);
        return next;
      });
    }
  };

  const handleRowDoubleClick = (account: Account) => {
    // Double-click to activate/deactivate
    if (account.status === 'active') {
      handleActivate(account);
    }
  };

  const isAccountActive = (account: Account) => {
    return activeAccountIds[account.provider] === account.id;
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' 
      ? <ChevronUp size={12} className="text-white/60" />
      : <ChevronDown size={12} className="text-white/60" />;
  };

  const allSelected = accounts.length > 0 && selectedIds.size === accounts.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < accounts.length;

  return (
    <div className="flex flex-col h-full border border-white/10 rounded-lg overflow-hidden bg-slate-950">
      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full">
          {/* Header */}
          <thead className="sticky top-0 z-10">
            <tr className="h-10 bg-white/[0.02] border-b border-white/5">
              <th className="w-12 px-4">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected; }}
                  onChange={(e) => (e.target.checked ? onSelectAll() : onClearSelection())}
                  className="checkbox-ds"
                />
              </th>
              <th className="px-3 text-left">
                <button onClick={() => handleSort('email')} className="flex items-center gap-1 text-[11px] uppercase tracking-widest text-slate-500 font-bold hover:text-slate-300">
                  {t('accountsTable.account')} <SortIcon field="email" />
                </button>
              </th>
              <th className="w-24 px-3 text-left">
                <button onClick={() => handleSort('status')} className="flex items-center gap-1 text-[11px] uppercase tracking-widest text-slate-500 font-bold hover:text-slate-300">
                  {t('accountsTable.status')} <SortIcon field="status" />
                </button>
              </th>
              <th className="w-28 px-3 text-left">
                <button onClick={() => handleSort('quota')} className="flex items-center gap-1 text-[11px] uppercase tracking-widest text-slate-500 font-bold hover:text-slate-300">
                  {t('accountsTable.usage')} <SortIcon field="quota" />
                </button>
              </th>
              <th className="w-24 px-3 text-left">
                <button onClick={() => handleSort('tokenExpires')} className="flex items-center gap-1 text-[11px] uppercase tracking-widest text-slate-500 font-bold hover:text-slate-300">
                  {t('accountsTable.expires')} <SortIcon field="tokenExpires" />
                </button>
              </th>
              <th className="w-20 px-3"></th>
            </tr>
          </thead>

          {/* Body */}
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="h-64">
                  <div className="flex items-center justify-center gap-2 text-slate-500">
                    <RefreshCw size={16} className="animate-spin" />
                    <span className="text-sm">{t('common.loading')}</span>
                  </div>
                </td>
              </tr>
            ) : paginatedAccounts.length === 0 ? (
              <tr>
                <td colSpan={7} className="h-64">
                  <div className="flex flex-col items-center justify-center text-slate-600">
                    <Users className="w-12 h-12 mb-3 opacity-20" />
                    <p className="text-sm text-slate-400">{t('accounts.noAccounts')}</p>
                    <p className="text-xs text-slate-600 mt-1">{t('accounts.noAccountsSubtitle')}</p>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedAccounts.map((account) => {
                const provider = providerBadge[account.provider] || providerBadge.kiro;
                const rawPercent = account.quota.limit > 0 ? (account.quota.used / account.quota.limit) * 100 : 0;
                const usagePercent = Math.round(rawPercent);
                const isRefreshing = refreshingIds.has(account.id);
                const isActivating = activatingIds.has(account.id);
                const isDeleteConfirm = deleteConfirmId === account.id;
                const isActive = isAccountActive(account);

                return (
                  <tr 
                    key={account.id} 
                    className={`h-14 border-b border-white/5 hover:bg-white/[0.02] transition-colors duration-150 group cursor-pointer ${
                      isActive ? 'bg-primary/5 border-l-2 border-l-primary' : ''
                    }`}
                    onDoubleClick={() => handleRowDoubleClick(account)}
                  >
                    {/* Checkbox */}
                    <td className="px-4">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(account.id)}
                        onChange={() => onToggleSelection(account.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="checkbox-ds"
                      />
                    </td>

                    {/* Provider Badge + Email & Token */}
                    <td className="px-3 min-w-0">
                      <div className="flex items-center gap-3 min-w-0">
                        {/* Provider Badge */}
                        <div className={`shrink-0 px-2 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wide border ${provider.bg} ${provider.text} ${provider.border} ${isActive ? 'ring-1 ring-primary' : ''}`}>
                          {provider.label}
                        </div>
                        
                        {/* Email & Token */}
                        <div className="flex flex-col justify-center min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`text-[13px] font-medium leading-tight truncate ${
                              account.status === 'banned' ? 'text-slate-500 line-through' : 'text-slate-200'
                            }`}>
                              {account.email}
                            </span>
                            {isActive && (
                              <div className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider bg-primary/20 text-primary rounded">
                                <Star size={8} className="fill-current" />
                                {t('accountsTable.active')}
                              </div>
                            )}
                          </div>
                          <span className="text-[11px] font-mono text-slate-500 mt-0.5 leading-tight truncate">
                            {account.token ? account.token.slice(0, 32) + '...' : '—'}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-3">
                      <div className="flex items-center gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full ${statusDot[account.status]}`} />
                        <span className="text-xs font-medium text-slate-300">
                          {getStatusLabel(account.status)}
                        </span>
                      </div>
                    </td>

                    {/* Usage */}
                    <td className="px-3">
                      {account.quota.limit > 0 ? (
                        <div className="flex items-center gap-2">
                          <div className="w-12 h-1 bg-white/5 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${usagePercent > 90 ? 'bg-amber-500' : 'bg-white/30'}`}
                              style={{ width: `${Math.min(usagePercent, 100)}%` }}
                            />
                          </div>
                          <span className={`text-[11px] font-mono tabular-nums ${usagePercent > 90 ? 'text-amber-400' : 'text-slate-400'}`}>
                            {usagePercent}%
                          </span>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-600">—</span>
                      )}
                    </td>

                    {/* Expires */}
                    <td className="px-3">
                      <span className="text-[11px] text-slate-500 tabular-nums">
                        {formatRelativeTime(account.quota.resetAt)}
                      </span>
                    </td>

                    {/* Actions: Start Button + Delete */}
                    <td className="px-3">
                      <div className="flex items-center gap-1.5">
                        {/* Start/Stop Button - Always visible */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleActivate(account);
                          }}
                          disabled={isActivating || account.status !== 'active'}
                          className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold uppercase tracking-wide transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed ${
                            isActive 
                              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20' 
                              : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20'
                          }`}
                        >
                          {isActivating ? (
                            <RefreshCw size={10} className="animate-spin" />
                          ) : isActive ? (
                            <Zap size={10} className="fill-current" />
                          ) : (
                            <Play size={10} className="fill-current" />
                          )}
                          {isActive ? 'Stop' : 'Start'}
                        </button>

                        {/* Delete Button - Always visible, requires confirmation */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(account.id);
                          }}
                          className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold uppercase tracking-wide transition-all active:scale-95 ${
                            isDeleteConfirm 
                              ? 'bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse' 
                              : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20'
                          }`}
                        >
                          <Trash2 size={10} />
                          {isDeleteConfirm ? '?' : ''}
                        </button>

                        {/* More Menu */}
                        <div className="relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuId(openMenuId === account.id ? null : account.id);
                            }}
                            className="p-1.5 rounded text-slate-600 hover:text-white hover:bg-white/5 opacity-0 group-hover:opacity-100 transition-all"
                          >
                            <MoreHorizontal size={16} />
                          </button>
                          
                          {openMenuId === account.id && (
                            <div className="absolute right-0 top-full mt-1 w-36 bg-slate-900 border border-white/10 rounded-lg shadow-2xl z-50 py-1">
                              <button
                                onClick={() => { handleRefresh(account.id); setOpenMenuId(null); }}
                                disabled={isRefreshing}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 hover:text-white"
                              >
                                <RefreshCw size={12} className={isRefreshing ? 'animate-spin' : ''} />
                                {t('accountsTable.refresh')}
                              </button>
                              <button
                                onClick={() => { onCopyToken(account.token); setOpenMenuId(null); }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 hover:text-white"
                              >
                                <Copy size={12} />
                                {t('accountsTable.copyToken')}
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
      <div className="h-10 px-4 flex items-center justify-between border-t border-white/5 bg-white/[0.01]">
        <span className="text-[11px] text-slate-500">
          {sortedAccounts.length} {t('accountsTable.accounts')}
        </span>
        
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-1 text-slate-500 hover:text-white disabled:opacity-30"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-[11px] text-slate-500 px-2 tabular-nums">
              {currentPage}/{totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-1 text-slate-500 hover:text-white disabled:opacity-30"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}

        {selectedIds.size > 0 && (
          <span className="text-[11px] text-slate-400">
            <span className="text-white font-medium">{selectedIds.size}</span> {t('common.selected')}
          </span>
        )}
      </div>
    </div>
  );
}
