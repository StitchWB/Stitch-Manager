import { useState } from 'react';
import { Trash2, RefreshCw, MoreHorizontal, Play, Square, Globe, Copy } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import type { Account, AccountStatus } from '../types';
import { t } from '../lib/i18n';
import { cn } from '../lib/utils';
import { UsageBar } from './ui/UsageBar';
import AccountDetailsModal from './ui/AccountDetailsModal';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { Tooltip } from './ui/Tooltip';
import { ProviderLogo } from './ui/ProviderLogo';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';

function truncateEmail(email: string, startChars = 16, endChars = 14): string {
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
}: AccountsTableProps) {
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [detailsModalAccount, setDetailsModalAccount] = useState<Account | null>(null);
  const { copy } = useCopyToClipboard();

  const isAccountActive = (account: Account) => activeAccountIds[account.provider] === account.id;

  const handleActivate = async (account: Account) => {
    const isActive = isAccountActive(account);
    await onActivate(account.provider, isActive ? null : account.id);
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

  return (
    <div className="flex flex-col h-full overflow-hidden px-2 sm:px-4">
      {/* Optimized Header Grid */}
      <div className="hidden lg:grid grid-cols-[40px_minmax(200px,1fr)_90px_240px_160px] gap-4 py-3 px-4 border-b border-white/5 sticky top-0 bg-[#050508]/95 backdrop-blur-md z-40">
        <div className="flex justify-center">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => (allSelected ? onClearSelection() : onSelectAll())}
            className="w-4 h-4 rounded border-white/10 bg-black/40 text-indigo-500 cursor-pointer"
          />
        </div>
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
          {t('accountsTable.account')}
        </span>
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">
          {t('accountsTable.status')}
        </span>
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">
          {t('accountsTable.usage')}
        </span>
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right pr-4">
          {t('common.actions')}
        </span>
      </div>

      <div className="flex-1 overflow-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10 pb-24 pt-2 space-y-1.5">
        <AnimatePresence mode="popLayout">
          {accounts.map(account => {
            const isActive = isAccountActive(account);
            const isSelected = selectedIds.has(account.id);
            const isRefreshing = isAccountRefreshing(account.id);
            const metadata = account.metadata ? JSON.parse(account.metadata) : {};

            return (
              <motion.div
                layout
                key={account.id}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98 }}
                onClick={() => setDetailsModalAccount(account)}
                className={cn(
                  'relative group rounded-xl border transition-all duration-200 cursor-pointer overflow-hidden',
                  isSelected
                    ? 'bg-indigo-500/[0.08] border-indigo-500/50 shadow-sm'
                    : isActive
                      ? 'bg-emerald-500/[0.05] border-emerald-500/30'
                      : 'bg-[#0f1115]/60 border-white/[0.03] hover:border-white/[0.08] hover:bg-[#161920]'
                )}
              >
                {/* Accent Bar Left (The glowy one) */}
                {isActive && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500 shadow-[0_0_15px_#10b981]" />
                )}

                <div className="grid grid-cols-1 lg:grid-cols-[40px_minmax(200px,1fr)_90px_240px_160px] gap-4 items-center p-3 lg:p-3.5">
                  {/* Checkbox (Desktop only) */}
                  <div
                    className="hidden lg:flex justify-center"
                    onClick={e => {
                      e.stopPropagation();
                      onToggleSelection(account.id);
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {}}
                      className="w-4 h-4 rounded border-white/10 bg-black/40 text-indigo-500 pointer-events-none"
                    />
                  </div>

                  {/* Identity: Logo + Email + Name */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="p-1.5 rounded-lg bg-white/5 shrink-0">
                      <ProviderLogo provider={account.provider as any} size={16} />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-100 truncate group-hover:text-indigo-300 transition-colors">
                          {truncateEmail(account.email)}
                        </span>
                        {isRefreshing && (
                          <RefreshCw size={12} className="animate-spin text-indigo-400 shrink-0" />
                        )}
                      </div>
                      {metadata.name && (
                        <span className="text-[10px] text-slate-500 font-medium truncate">
                          {metadata.name}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Status Badge (Compact) */}
                  <div className="flex lg:justify-center">
                    <div
                      className={cn(
                        'flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-tighter border',
                        account.status === 'active'
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                      )}
                    >
                      {getStatusLabel(account.status as AccountStatus)}
                    </div>
                  </div>

                  {/* Quota Section (WIDE) */}
                  <div className="flex flex-col gap-1.5 px-2">
                    <div className="flex items-center justify-between text-[9px] font-black tabular-nums tracking-tighter uppercase">
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-500">Success</span>
                        <span
                          className={cn(
                            account.successRate > 0.8 ? 'text-emerald-400' : 'text-amber-400'
                          )}
                        >
                          {Math.round(account.successRate * 100)}%
                        </span>
                      </div>
                      <span className="text-slate-400">{account.useCount} USES</span>
                    </div>
                    <UsageBar
                      used={account.quota?.used || 0}
                      limit={account.quota?.limit || 0}
                      className="h-2 rounded-full overflow-hidden bg-black/40 border border-white/5"
                    />
                  </div>

                  {/* Action Buttons (Fixed Width) */}
                  <div className="flex items-center justify-end gap-1 px-1 border-t lg:border-t-0 border-white/5 pt-2 lg:pt-0">
                    <Tooltip content={t('accountsTable.checkStatus')}>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          onCheckStatus(account.id);
                        }}
                        className="p-2 text-slate-500 hover:text-white hover:bg-white/5 rounded-lg transition-all"
                      >
                        <RefreshCw size={15} className={isRefreshing ? 'animate-spin' : ''} />
                      </button>
                    </Tooltip>

                    <Tooltip content={t('accountsTable.openBrowser')}>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          onOpenBrowser?.(account.id);
                        }}
                        className="p-2 text-slate-500 hover:text-indigo-400 hover:bg-indigo-500/10 rounded-lg transition-all"
                      >
                        <Globe size={15} />
                      </button>
                    </Tooltip>

                    <Tooltip content={isActive ? t('accounts.deactivate') : t('accounts.activate')}>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          handleActivate(account);
                        }}
                        className={cn(
                          'p-2 rounded-lg transition-all border',
                          isActive
                            ? 'bg-amber-500/10 text-amber-500 border-amber-500/20 hover:bg-amber-500/20'
                            : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/20 shadow-md'
                        )}
                      >
                        {isActive ? (
                          <Square size={14} fill="currentColor" />
                        ) : (
                          <Play size={14} fill="currentColor" />
                        )}
                      </button>
                    </Tooltip>

                    <div className="relative">
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          setOpenMenuId(openMenuId === account.id ? null : account.id);
                        }}
                        className="p-2 text-slate-500 hover:text-white hover:bg-white/5 rounded-lg transition-all"
                      >
                        <MoreHorizontal size={16} />
                      </button>

                      {openMenuId === account.id && (
                        <div className="absolute right-0 top-full mt-2 w-44 rounded-xl shadow-2xl z-50 py-1.5 backdrop-blur-3xl border border-white/10 bg-[#0f1115]/95 animate-in fade-in slide-in-from-top-1 duration-200">
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              copy(account.token ?? '');
                              setOpenMenuId(null);
                            }}
                            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[11px] text-slate-300 hover:bg-white/5 transition-colors"
                          >
                            <Copy size={13} className="text-indigo-400" />
                            <span>Copy Token</span>
                          </button>
                          <div className="h-px bg-white/5 my-1 mx-2" />
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
                            className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[11px] text-rose-400 hover:bg-rose-500/10 transition-colors"
                          >
                            <Trash2 size={13} />
                            <span>Delete Account</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
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
