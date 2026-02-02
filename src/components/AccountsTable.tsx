import { useState } from 'react';
import {
  Trash2,
  RefreshCw,
  ChevronUp,
  ChevronDown,
  MoreHorizontal,
  Play,
  Square,
  Globe,
  Copy,
  Activity,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import type { Account, AccountStatus } from '../types';
import { useAccountsStore } from '../stores/accounts';
import { t } from '../lib/i18n';
import { cn } from '../lib/utils';
import { UsageBar } from './ui/UsageBar';
import AccountDetailsModal from './ui/AccountDetailsModal';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { Tooltip } from './ui/Tooltip';
import { Button } from './ui/Button';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';
import { ACCOUNT_STATUS_COLORS, STATUS_COLORS } from '../constants/colors';

function truncateEmail(email: string, startChars = 18, endChars = 18): string {
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

type SortField = 'email' | 'status' | 'quota' | 'useCount' | 'lastLoginAt' | 'successRate';

interface AccountsTableProps {
  accounts: Account[];
  selectedIds: Set<number>;
  activeAccountIds: Record<string, number | null>;
  onToggleSelection: (accountId: number) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDelete: (accountId: number) => Promise<void>;
  onDeleteSelected: (ids: number[]) => Promise<void>;
  onActivate: (provider: string, accountId: number | null) => Promise<void>;
  onCheckStatus: (accountId: number) => Promise<void>;
  isAccountRefreshing: (accountId: number) => boolean;
  onOpenBrowser?: (accountId: number) => Promise<void>;
  selectedProvider?: string | null;
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
  selectedIds,
  activeAccountIds,
  onToggleSelection,
  onSelectAll,
  onClearSelection,
  onDelete,
  onDeleteSelected,
  onActivate,
  onCheckStatus,
  isAccountRefreshing,
  onOpenBrowser,
  selectedProvider,
}: AccountsTableProps) {
  const { sortField, sortDirection, setSortField, setSortDirection } = useAccountsStore();
  const [checkingStatusIds, setCheckingStatusIds] = useState<Set<number>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [detailsModalAccount, setDetailsModalAccount] = useState<Account | null>(null);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const { copy } = useCopyToClipboard();

  const handleSort = (field: SortField) => {
    if (sortField === (field as any)) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field as any);
      setSortDirection('desc');
    }
  };

  const handleCheckboxChange = (account: Account, index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.shiftKey && lastSelectedIndex !== null) {
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      const toSelect = accounts.slice(start, end + 1);
      toSelect.forEach(acc => {
        if (!selectedIds.has(acc.id)) onToggleSelection(acc.id);
      });
    } else {
      onToggleSelection(account.id);
      setLastSelectedIndex(index);
    }
  };

  const handleRowClick = (account: Account, e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input[type="checkbox"]')) return;
    setDetailsModalAccount(account);
  };

  const isAccountActive = (account: Account) => activeAccountIds[account.provider] === account.id;

  const handleActivate = async (account: Account) => {
    const isActive = isAccountActive(account);
    await onActivate(account.provider, isActive ? null : account.id);
  };

  const handleCheckStatus = async (accountId: number) => {
    setCheckingStatusIds(prev => new Set(prev).add(accountId));
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

  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    type: 'single' | 'bulk';
    accountId?: number;
    accountIds?: number[];
  }>({ isOpen: false, type: 'single' });
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirmDelete = async () => {
    setIsDeleting(true);
    try {
      if (confirmDialog.type === 'single' && confirmDialog.accountId)
        await onDelete(confirmDialog.accountId);
      else if (confirmDialog.type === 'bulk' && confirmDialog.accountIds)
        await onDeleteSelected(confirmDialog.accountIds);
      setConfirmDialog({ ...confirmDialog, isOpen: false });
    } finally {
      setIsDeleting(false);
    }
  };

  const allSelected = accounts.length > 0 && selectedIds.size >= accounts.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < accounts.length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10 pb-20">
        <table className="w-full border-separate border-spacing-0" style={{ tableLayout: 'fixed' }}>
          <thead className="sticky top-0 z-30">
            <tr className="bg-[#0a0a0c]/95 backdrop-blur-2xl border-b border-white/5">
              <th className="w-12 px-4 py-2.5 text-center">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={el => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={() => (allSelected ? onClearSelection() : onSelectAll())}
                  className="w-4 h-4 rounded border-white/10 bg-black/40 text-indigo-500 focus:ring-indigo-500/50 cursor-pointer"
                />
              </th>
              <th className="w-10 py-2.5"></th>
              <th
                className="px-6 py-2.5 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-widest cursor-pointer hover:text-slate-300 transition-colors"
                onClick={() => handleSort('email')}
              >
                <div className="flex items-center gap-2">
                  {t('accountsTable.account')}
                  {sortField === 'email' && (
                    <span className="text-indigo-400">
                      {sortDirection === 'asc' ? (
                        <ChevronUp size={12} />
                      ) : (
                        <ChevronDown size={12} />
                      )}
                    </span>
                  )}
                </div>
              </th>
              <th className="w-[140px] px-4 py-2.5 text-center text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                {t('accountsTable.status')}
              </th>
              <th className="w-[180px] px-4 py-2.5 text-center text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                {t('accountsTable.usage')}
              </th>
              <th className="w-[100px] px-4 py-2.5 text-center text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                {t('accountsTable.uses')}
              </th>
              <th className="w-[150px] px-4 py-2.5 text-center text-[10px] font-semibold text-slate-400 uppercase tracking-widest hidden xl:table-cell">
                {t('accountsTable.lastLogin')}
              </th>
              <th className="w-[100px] px-4 py-2.5 text-right text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                {t('accountsTable.success')}
              </th>
              <th className="w-[200px] px-6 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.04]">
            <AnimatePresence mode="popLayout">
              {accounts.map((account, index) => {
                const isActive = isAccountActive(account);
                const isSelected = selectedIds.has(account.id);
                const isRefreshing = isAccountRefreshing(account.id);
                return (
                  <motion.tr
                    layout
                    key={account.id}
                    onClick={e => handleRowClick(account, e)}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className={cn(
                      'group cursor-pointer transition-all relative border-l-4',
                      isSelected
                        ? 'bg-indigo-500/[0.08] border-l-indigo-500'
                        : isActive 
                          ? `${STATUS_COLORS.success.bgOpacity} border-l-${STATUS_COLORS.success.border.replace('border-', '')}/50`
                          : 'hover:bg-white/[0.02] hover:border-l-indigo-500 border-l-transparent',
                      index % 2 === 0 && !isSelected && !isActive && 'bg-white/[0.01]'
                    )}
                  >
                    <td
                      className="px-4 py-2 text-center"
                      onClick={e => handleCheckboxChange(account, index, e)}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        className="w-4 h-4 rounded border-white/20 bg-black/40 text-indigo-500 pointer-events-none transition-all group-hover:border-indigo-500/50"
                      />
                    </td>
                    <td className="py-2 px-0 text-center">
                      <div
                        className={cn(
                          'w-2 h-2 rounded-full mx-auto transition-all duration-500',
                          isActive
                            ? STATUS_COLORS.success.bg
                            : 'bg-slate-700'
                        )}
                        style={{
                          boxShadow: isActive ? `0 0 8px ${STATUS_COLORS.success.hex}99` : 'none',
                          transform: isActive ? 'scale(1.25)' : 'scale(1)'
                        }}
                      />
                    </td>
                    <td className="px-6 py-2 overflow-hidden">
                      <div className="flex items-center gap-3 min-w-0">
                        {isRefreshing && (
                          <RefreshCw size={14} className="animate-spin text-indigo-400 shrink-0" />
                        )}
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-semibold text-white truncate leading-tight group-hover:text-indigo-300 transition-colors">
                            {truncateEmail(account.email, 22, 22)}
                          </span>
                          {!selectedProvider && (
                            <span className="text-[10px] font-medium text-slate-400 mt-0.5">
                              {account.provider.toUpperCase()}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <div
                          className={cn(
                            'w-1.5 h-1.5 rounded-full',
                            account.status === 'active'
                              ? ACCOUNT_STATUS_COLORS.active.bg
                              : account.status === 'banned'
                                ? ACCOUNT_STATUS_COLORS.banned.bg
                                : ACCOUNT_STATUS_COLORS.expired.bg
                          )}
                        />
                        <span
                          className={cn(
                            'text-xs font-medium',
                            account.status === 'active'
                              ? ACCOUNT_STATUS_COLORS.active.text
                              : account.status === 'banned'
                                ? ACCOUNT_STATUS_COLORS.banned.text
                                : ACCOUNT_STATUS_COLORS.expired.text
                          )}
                        >
                          {getStatusLabel(account.status as AccountStatus)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="w-full max-w-[140px] mx-auto">
                        <UsageBar
                          used={account.quota?.used || 0}
                          limit={account.quota?.limit || 0}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-2 text-center">
                      <span className="text-sm tabular-nums font-semibold text-slate-200">
                        {account.useCount}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-center hidden xl:table-cell">
                      <span className={cn(
                        "text-xs font-medium px-2 py-1 rounded",
                        !account.lastLoginAt 
                          ? "text-slate-500" 
                          : "text-slate-300 bg-white/[0.03]"
                      )}>
                        {formatRelativeTime(account.lastLoginAt || undefined)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex flex-col items-end gap-1">
                        <span
                          className={cn(
                            'text-xs font-semibold tabular-nums',
                            account.useCount === 0
                              ? 'text-slate-600'
                              : account.successRate >= 0.8
                                ? STATUS_COLORS.success.text
                                : account.successRate < 0.3
                                  ? STATUS_COLORS.error.text
                                  : STATUS_COLORS.warning.text
                          )}
                        >
                          {account.useCount === 0 ? 'N/A' : `${Math.max(0, Math.round(account.successRate * 100))}%`}
                        </span>
                        {account.useCount > 0 && (
                          <div className="w-12 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className={cn(
                                'h-full transition-all duration-700',
                                account.successRate >= 0.8
                                  ? STATUS_COLORS.success.bg
                                  : account.successRate <= 0
                                    ? STATUS_COLORS.error.bg
                                    : account.successRate < 0.5
                                      ? STATUS_COLORS.warning.bg
                                      : STATUS_COLORS.success.bg
                              )}
                              style={{ 
                                width: `${Math.max(0, Math.min(100, account.successRate * 100))}%`,
                                boxShadow: account.successRate >= 0.8
                                  ? `0 0 8px ${STATUS_COLORS.success.hex}66`
                                  : account.successRate <= 0
                                    ? `0 0 8px ${STATUS_COLORS.error.hex}66`
                                    : `0 0 8px ${STATUS_COLORS.warning.hex}66`
                              }}
                            />
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-2 text-right">
                      <div className="flex items-center gap-1 justify-end opacity-30 group-hover:opacity-100 transition-all duration-300">
                        <Tooltip content={t('accountsTable.checkStatus')}>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={e => {
                              e.stopPropagation();
                              handleCheckStatus(account.id);
                            }}
                            isLoading={checkingStatusIds.has(account.id)}
                            className="h-7 w-7 text-slate-400 hover:text-white hover:bg-white/5"
                          >
                            <RefreshCw size={13} />
                          </Button>
                        </Tooltip>
                        <Tooltip content={t('accountsTable.openBrowser')}>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={e => {
                              e.stopPropagation();
                              onOpenBrowser?.(account.id);
                            }}
                            className="h-7 w-7 text-slate-400 hover:text-indigo-400 hover:bg-indigo-500/10"
                          >
                            <Globe size={13} />
                          </Button>
                        </Tooltip>
                        <Tooltip
                          content={isActive ? t('accounts.deactivate') : t('accounts.activate')}
                        >
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={e => {
                              e.stopPropagation();
                              handleActivate(account);
                            }}
                            className={cn(
                              'h-7 w-7 transition-colors',
                              isActive
                                ? `${STATUS_COLORS.warning.text} hover:text-amber-300 hover:${STATUS_COLORS.warning.bgOpacity}`
                                : `${STATUS_COLORS.success.text} hover:text-emerald-300 hover:${STATUS_COLORS.success.bgOpacity}`
                            )}
                          >
                            {isActive ? (
                              <Square size={13} />
                            ) : (
                              <Play size={13} className="fill-current" />
                            )}
                          </Button>
                        </Tooltip>
                        <div className="relative">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={e => {
                              e.stopPropagation();
                              setOpenMenuId(openMenuId === account.id ? null : account.id);
                            }}
                            className="h-7 w-7 text-slate-400 hover:bg-white/5"
                          >
                            <MoreHorizontal size={13} />
                          </Button>
                          {openMenuId === account.id && (
                            <div className="absolute right-0 top-full mt-2 w-48 rounded-2xl shadow-2xl z-50 py-2 backdrop-blur-3xl border border-white/10 bg-[#0f1115]/95 shadow-indigo-500/30 animate-in fade-in zoom-in-95 duration-200">
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  copy(account.token ?? '');
                                  setOpenMenuId(null);
                                }}
                                className="w-full flex items-center gap-3 px-4 py-2.5 text-xs text-slate-300 hover:bg-white/5 transition-colors"
                              >
                                <Copy size={14} className="text-indigo-400" />
                                <span>Copy Token</span>
                              </button>
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  handleCheckStatus(account.id);
                                  setOpenMenuId(null);
                                }}
                                className="w-full flex items-center gap-3 px-4 py-2.5 text-xs text-slate-300 hover:bg-white/5 transition-colors"
                              >
                                <Activity size={14} className="text-indigo-400" />
                                <span>Refresh Status</span>
                              </button>
                              <div className="h-px bg-white/5 my-1.5 mx-3" />
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  setConfirmDialog({
                                    isOpen: true,
                                    type: 'single',
                                    accountId: account.id,
                                  });
                                  setOpenMenuId(null);
                                }}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 text-xs ${STATUS_COLORS.error.text} hover:${STATUS_COLORS.error.bgOpacity} transition-colors`}
                              >
                                <Trash2 size={14} />
                                <span>{t('accountsTable.delete')}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </AnimatePresence>
          </tbody>
        </table>
      </div>
      <AccountDetailsModal
        account={detailsModalAccount}
        isOpen={!!detailsModalAccount}
        onClose={() => setDetailsModalAccount(null)}
        onDelete={onDelete}
      />
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        title={t('accounts.deleteAccountTitle')}
        message={t('accounts.deleteAccountMessage')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        onConfirm={handleConfirmDelete}
        onClose={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}
        isLoading={isDeleting}
        variant="danger"
      />
    </div>
  );
}
