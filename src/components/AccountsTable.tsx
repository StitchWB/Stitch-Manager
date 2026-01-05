import { useState, useMemo, useRef, useEffect } from 'react';
import {
  Copy,
  Trash2,
  RefreshCw,
  ChevronUp,
  ChevronDown,
  AlertTriangle,
  Ban,
  Clock,
} from 'lucide-react';
import type { Account, AccountStatus } from '../types';
import { PROVIDER_ICONS, PROVIDER_COLORS } from '../constants';

const statusConfig: Record<AccountStatus, { label: string; className: string; icon?: React.ReactNode }> = {
  active: {
    label: 'Active',
    className: 'bg-green-500/15 text-green-400 border-green-500/20',
    icon: <span className="w-1.5 h-1.5 rounded-full bg-green-400 mr-1.5 animate-pulse" />,
  },
  banned: {
    label: 'Banned',
    className: 'bg-red-500/15 text-red-400 border-red-500/20',
    icon: <Ban size={12} className="mr-1" />,
  },
  limit_hit: {
    label: 'Limit Hit',
    className: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
    icon: <AlertTriangle size={12} className="mr-1" />,
  },
  expired: {
    label: 'Expired',
    className: 'bg-slate-500/15 text-slate-400 border-slate-500/20',
    icon: <Clock size={12} className="mr-1" />,
  },
  unknown: {
    label: 'Unknown',
    className: 'bg-slate-500/15 text-slate-400 border-slate-500/20',
  },
};

type SortField = 'provider' | 'email' | 'status' | 'quota' | 'tokenExpires';
type SortDirection = 'asc' | 'desc';

interface AccountsTableProps {
  accounts: Account[];
  isLoading: boolean;
  selectedIds: Set<number>;
  onToggleSelection: (accountId: number) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onRefreshToken: (accountId: number) => Promise<void>;
  onCopyToken: (token: string) => void;
  onDelete: (accountId: number) => void;
}

// Helper to format relative time
function formatRelativeTime(dateString?: string): string {
  if (!dateString) return 'N/A';
  
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  
  if (diffMs < 0) {
    // Already expired
    const absDays = Math.abs(diffDays);
    if (absDays > 30) return `${Math.floor(absDays / 30)}mo ago`;
    if (absDays > 0) return `${absDays}d ago`;
    return `${Math.abs(diffHours)}h ago`;
  }
  
  // Future expiration
  if (diffDays > 30) return `in ${Math.floor(diffDays / 30)}mo`;
  if (diffDays > 0) return `in ${diffDays}d`;
  if (diffHours > 0) return `in ${diffHours}h`;
  return 'soon';
}

export default function AccountsTable({
  accounts,
  isLoading,
  selectedIds,
  onToggleSelection,
  onSelectAll,
  onClearSelection,
  onRefreshToken,
  onCopyToken,
  onDelete,
}: AccountsTableProps) {
  const [sortField, setSortField] = useState<SortField>('email');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [refreshingIds, setRefreshingIds] = useState<Set<number>>(new Set());
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  
  // Ref to track delete confirmation timeout for cleanup
  const deleteConfirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (deleteConfirmTimeoutRef.current) {
        clearTimeout(deleteConfirmTimeoutRef.current);
      }
    };
  }, []);

  // Sort accounts
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
          const aPercent = a.quota.used / a.quota.limit;
          const bPercent = b.quota.used / b.quota.limit;
          comparison = aPercent - bPercent;
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
      // Clear any pending timeout
      if (deleteConfirmTimeoutRef.current) {
        clearTimeout(deleteConfirmTimeoutRef.current);
        deleteConfirmTimeoutRef.current = null;
      }
    } else {
      setDeleteConfirmId(accountId);
      // Clear any existing timeout before setting a new one
      if (deleteConfirmTimeoutRef.current) {
        clearTimeout(deleteConfirmTimeoutRef.current);
      }
      // Auto-reset confirmation after 3 seconds
      deleteConfirmTimeoutRef.current = setTimeout(() => {
        setDeleteConfirmId(null);
        deleteConfirmTimeoutRef.current = null;
      }, 3000);
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <ChevronUp size={14} className="opacity-0 group-hover:opacity-30" />;
    }
    return sortDirection === 'asc' ? (
      <ChevronUp size={14} className="text-primary" />
    ) : (
      <ChevronDown size={14} className="text-primary" />
    );
  };

  const allSelected = accounts.length > 0 && selectedIds.size === accounts.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < accounts.length;

  return (
    <div className="bg-surface-dark border border-border-dark rounded-xl shadow-sm flex flex-col h-full overflow-hidden">
      <div className="overflow-x-auto flex-1">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border-dark bg-[#1c283d]">
              <th className="py-3 px-4 w-12">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={(e) => (e.target.checked ? onSelectAll() : onClearSelection())}
                  className="w-4 h-4 rounded border-gray-600 bg-background-dark text-primary focus:ring-offset-0 focus:ring-1 focus:ring-primary cursor-pointer"
                />
              </th>
              <th
                className="py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider w-24 cursor-pointer group"
                onClick={() => handleSort('provider')}
              >
                <div className="flex items-center gap-1">
                  Provider
                  <SortIcon field="provider" />
                </div>
              </th>
              <th
                className="py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider cursor-pointer group"
                onClick={() => handleSort('email')}
              >
                <div className="flex items-center gap-1">
                  Email
                  <SortIcon field="email" />
                </div>
              </th>
              <th
                className="py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider w-32 cursor-pointer group"
                onClick={() => handleSort('status')}
              >
                <div className="flex items-center gap-1">
                  Status
                  <SortIcon field="status" />
                </div>
              </th>
              <th
                className="py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider w-48 cursor-pointer group"
                onClick={() => handleSort('quota')}
              >
                <div className="flex items-center gap-1">
                  Quota
                  <SortIcon field="quota" />
                </div>
              </th>
              <th
                className="py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider w-32 cursor-pointer group"
                onClick={() => handleSort('tokenExpires')}
              >
                <div className="flex items-center gap-1">
                  Token Expires
                  <SortIcon field="tokenExpires" />
                </div>
              </th>
              <th className="py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider w-36 text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-dark text-sm">
            {isLoading ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-400">
                  <div className="flex items-center justify-center gap-2">
                    <RefreshCw size={18} className="animate-spin" />
                    Loading accounts...
                  </div>
                </td>
              </tr>
            ) : sortedAccounts.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-slate-400">
                  No accounts found. Add your first account to get started.
                </td>
              </tr>
            ) : (
              sortedAccounts.map((account) => {
                const status = statusConfig[account.status];
                const usagePercent = Math.round(
                  (account.quota.used / account.quota.limit) * 100
                );
                const isRefreshing = refreshingIds.has(account.id);
                const isDeleteConfirm = deleteConfirmId === account.id;

                return (
                  <tr
                    key={account.id}
                    className="hover-row group transition-colors bg-surface-dark"
                  >
                    <td className="py-4 px-4">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(account.id)}
                        onChange={() => onToggleSelection(account.id)}
                        className="w-4 h-4 rounded border-gray-600 bg-background-dark text-primary focus:ring-offset-0 focus:ring-1 focus:ring-primary cursor-pointer"
                      />
                    </td>
                    <td className="py-4 px-4">
                      <div
                        className={`w-8 h-8 rounded flex items-center justify-center border text-xs font-bold ${PROVIDER_COLORS[account.provider]}`}
                        title={account.provider}
                      >
                        {PROVIDER_ICONS[account.provider]}
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex flex-col">
                        <span
                          className={`font-semibold ${
                            account.status === 'banned'
                              ? 'text-slate-500 line-through'
                              : 'text-white'
                          }`}
                        >
                          {account.email}
                        </span>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="font-mono text-xs text-slate-400 bg-background-dark px-1.5 py-0.5 rounded border border-border-dark truncate max-w-[180px]">
                            {account.token.slice(0, 12)}...
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${status.className}`}
                      >
                        {status.icon}
                        {status.label}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <div
                        className={`flex flex-col gap-1.5 ${
                          account.status === 'banned' ? 'opacity-50' : ''
                        }`}
                      >
                        <div className="flex justify-between items-center text-xs">
                          <span
                            className={`font-medium ${
                              usagePercent > 90 ? 'text-amber-400' : 'text-white'
                            }`}
                          >
                            {usagePercent}%
                          </span>
                          <span className="text-slate-400">
                            {account.quota.used}/{account.quota.limit} req
                          </span>
                        </div>
                        <div className="w-full bg-background-dark rounded-full h-1.5 overflow-hidden">
                          <div
                            className={`h-1.5 rounded-full transition-all ${
                              usagePercent > 90
                                ? 'bg-gradient-to-r from-orange-500 to-red-500'
                                : 'bg-primary'
                            }`}
                            style={{ width: `${usagePercent}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <span className="text-sm text-slate-400">
                        {formatRelativeTime(account.quota.resetAt)}
                      </span>
                    </td>
                    <td className="py-4 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleRefresh(account.id)}
                          disabled={isRefreshing}
                          className="action-btn p-1.5 rounded-md text-slate-400 hover:text-primary hover:bg-primary/10 transition-all disabled:opacity-50"
                          title="Refresh Token"
                        >
                          <RefreshCw
                            size={16}
                            className={isRefreshing ? 'animate-spin' : ''}
                          />
                        </button>
                        <button
                          onClick={() => onCopyToken(account.token)}
                          className="action-btn p-1.5 rounded-md text-slate-400 hover:text-primary hover:bg-primary/10 transition-all"
                          title="Copy Token"
                        >
                          <Copy size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(account.id)}
                          className={`action-btn p-1.5 rounded-md transition-all ${
                            isDeleteConfirm
                              ? 'text-red-400 bg-red-400/20'
                              : 'text-slate-400 hover:text-red-400 hover:bg-red-400/10'
                          }`}
                          title={isDeleteConfirm ? 'Click again to confirm' : 'Delete'}
                        >
                          <Trash2 size={16} />
                        </button>
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
      <div className="bg-surface-dark border-t border-border-dark px-6 py-4 flex items-center justify-between">
        <span className="text-sm text-slate-400">
          Showing <span className="text-white font-medium">{sortedAccounts.length}</span> accounts
        </span>
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="bg-primary text-white text-xs font-bold px-2 py-0.5 rounded-full">
              {selectedIds.size}
            </span>
            <span className="text-sm text-white">selected</span>
          </div>
        )}
      </div>
    </div>
  );
}
