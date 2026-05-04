import { useEffect, useMemo, useState } from 'react';
import { Trash2, Users } from 'lucide-react';
import type { Account } from '../types/generated';
import { t } from '../lib/i18n';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';
import type { AccountRelationEdge, RelationType } from '../lib/accounts/relations';
import type { AccountsTableVisibleColumns } from '../stores/uiPreferences';
import { AccountRow } from './accounts/AccountRow';
import { AccountDetailsModal, ConfirmDialog } from '@/components/ui';
import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  SkeletonLoader,
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
  QuotaDisplay,
} from './ui';

export interface AccountsTableProps {
  accounts: Account[];
  relationHintsById?: Record<number, string[]>;
  relationEdgesById?: Record<number, AccountRelationEdge[]>;
  selectedIds: Set<number>;
  activeAccountIds: Record<string, number | null>;
  isLoading?: boolean;
  visibleColumns?: AccountsTableVisibleColumns;
  onToggleSelection: (accountId: number) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDelete: (accountId: number) => Promise<void>;
  onDeleteSelected: (ids: number[]) => Promise<void>;
  onActivate: (provider: string, accountId: number | null) => Promise<void>;
  onCheckStatus: (accountId: number) => Promise<void>;
  isAccountRefreshing: (accountId: number) => boolean;
  onOpenBrowser?: (accountId: number) => Promise<void>;
  onOpenProfileSession?: (accountId: number) => Promise<void>;
  onConfirmProfileSession?: (accountId: number) => Promise<void>;
  onClearProfileSession?: (accountId: number) => Promise<void>;
  onUpdate?: (accountId: number, updates: { notes?: string; tags?: string }) => Promise<void>;
  onRelationEdgeClick?: (edgeType: RelationType, targetProvider: string) => void;
  selectedProvider?: string | null;
}

type DeleteDialogState =
  | { isOpen: false }
  | { isOpen: true; mode: 'single'; accountId: number }
  | { isOpen: true; mode: 'bulk'; accountIds: number[] };

export default function AccountsTable({
  accounts,
  relationHintsById,
  relationEdgesById,
  selectedIds,
  activeAccountIds,
  isLoading = false,
  visibleColumns = { lastLogin: true, proxy: true, tags: true },
  onToggleSelection,
  onSelectAll,
  onClearSelection,
  onDelete,
  onDeleteSelected,
  onActivate,
  onCheckStatus,
  isAccountRefreshing,
  onOpenBrowser,
  onOpenProfileSession,
  onConfirmProfileSession,
  onClearProfileSession,
  onUpdate,
  onRelationEdgeClick,
}: AccountsTableProps) {
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [detailsModalAccount, setDetailsModalAccount] = useState<Account | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>({ isOpen: false });
  const [isDeleting, setIsDeleting] = useState(false);

  const { copy } = useCopyToClipboard({
    successMessage: t('accounts.tokenCopiedAutoClear'),
    errorMessage: t('accounts.tokenCopyFailed'),
  });

  const allSelected = accounts.length > 0 && selectedIds.size === accounts.length;
  const selectedCount = selectedIds.size;

  const selectedIdsList = useMemo(() => Array.from(selectedIds), [selectedIds]);

  useEffect(() => {
    if (!openMenuId) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-row-actions-menu="true"]')) return;
      setOpenMenuId(null);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenMenuId(null);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [openMenuId]);

  const isAccountActive = (account: Account) => activeAccountIds[account.provider] === account.id;

  const handleLaunch = async (account: Account) => {
    if (onOpenBrowser) {
      await onOpenBrowser(account.id);
      return;
    }

    const active = isAccountActive(account);
    await onActivate(account.provider, active ? null : account.id);
  };

  const handleToggleActive = async (account: Account) => {
    const active = isAccountActive(account);
    await onActivate(account.provider, active ? null : account.id);
  };

  const handleConfirmDelete = async () => {
    if (!deleteDialog.isOpen) return;
    setIsDeleting(true);

    try {
      if (deleteDialog.mode === 'single') {
        await onDelete(deleteDialog.accountId);
      } else {
        await onDeleteSelected(deleteDialog.accountIds);
      }
      setDeleteDialog({ isOpen: false });
    } finally {
      setIsDeleting(false);
    }
  };

  const openSingleDelete = (accountId: number) => {
    setDeleteDialog({ isOpen: true, mode: 'single', accountId });
  };

  const openBulkDelete = () => {
    if (selectedIdsList.length === 0) return;
    setDeleteDialog({ isOpen: true, mode: 'bulk', accountIds: selectedIdsList });
  };

  if (isLoading && accounts.length === 0) {
    return (
      <div className="flex h-full flex-col overflow-hidden px-4 pb-4">
        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-white/5 bg-[#0b0b10]/80 p-4">
          <SkeletonLoader variant="table-row" count={6} />
        </div>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title={t('accounts.noAccountsFound')}
        description={t('accounts.noAccountsFoundDesc')}
      />
    );
  }

  const handleShowDetails = (account: Account) => {
    setDetailsModalAccount(account);
    setOpenMenuId(null);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden px-4 pb-4">
      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden rounded-xl border border-white/[0.04] bg-[#0b0b10]/80">
        <div className="min-w-[1100px] h-full">
          <Table
            containerClassName="h-full overflow-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10"
            className="w-full table-fixed text-[13px]"
            aria-label={t('accounts.accountsTable')}
          >
          <TableHeader className="sticky top-0 z-20 border-b border-white/[0.04] bg-slate-900/60 backdrop-blur-sm">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[44px] px-3 py-3 text-xs text-slate-400">
                <Checkbox
                  checked={allSelected}
                  onChange={() => {
                    if (allSelected) onClearSelection();
                    else onSelectAll();
                  }}
                  className="!p-0 hover:bg-transparent"
                  aria-label={t('accounts.selectAll')}
                />
              </TableHead>
              <TableHead className="px-2 py-3 text-xs text-slate-400">
                {t('accounts.provider')}
              </TableHead>
              <TableHead className="px-2 py-3 text-xs text-slate-400">
                {t('accounts.account')}
              </TableHead>
              <TableHead className="px-2 py-3 text-xs text-slate-400">
                {t('accounts.statusHeader')}
              </TableHead>
              <TableHead
                className={
                  visibleColumns.lastLogin
                    ? 'hidden px-2 py-3 text-xs text-slate-400 md:table-cell'
                    : 'hidden'
                }
              >
                {t('accounts.lastLoginAt')}
              </TableHead>
              <TableHead
                className={
                  visibleColumns.proxy
                    ? 'hidden px-2 py-3 text-xs text-slate-400 lg:table-cell'
                    : 'hidden'
                }
              >
                {t('accounts.proxyLabel')}
              </TableHead>
              <TableHead
                className={
                  visibleColumns.tags
                    ? 'hidden px-2 py-3 text-xs text-slate-400 lg:table-cell'
                    : 'hidden'
                }
              >
                {t('accounts.tags')}
              </TableHead>
              <TableHead className="hidden px-2 py-3 text-xs text-slate-400 lg:table-cell w-[160px]">
                {t('accounts.columnQuota')}
              </TableHead>
              <TableHead className="px-2 py-3 text-right text-xs text-slate-400">
                {t('common.actions')}
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {accounts.map(account => (
              <AccountRow
                key={account.id}
                account={account}
                isSelected={selectedIds.has(account.id)}
                isActive={isAccountActive(account)}
                isRefreshing={isAccountRefreshing(account.id)}
                isMenuOpen={openMenuId === account.id}
                visibleColumns={visibleColumns}
                relationHints={relationHintsById?.[account.id]}
                relationEdges={relationEdgesById?.[account.id]}
                onToggleSelection={onToggleSelection}
                onToggleMenu={id => setOpenMenuId(current => (current === id ? null : id))}
                onCloseMenu={() => setOpenMenuId(null)}
                onShowDetails={handleShowDetails}
                onLaunch={handleLaunch}
                onToggleActive={handleToggleActive}
                onCheckStatus={onCheckStatus}
                onOpenBrowser={onOpenBrowser}
                onCopyToken={token =>
                  copy(token, {
                    sensitive: true,
                    autoClear: true,
                    autoClearAfterMs: 15000,
                    requireConfirmation: true,
                    confirmationMessage: t('accounts.copyTokenSensitiveConfirm'),
                  })
                }
                onDelete={openSingleDelete}
                onOpenProfileSession={onOpenProfileSession}
                onConfirmProfileSession={onConfirmProfileSession}
                onClearProfileSession={onClearProfileSession}
                onRelationEdgeClick={onRelationEdgeClick}
              />
            ))}
          </TableBody>
          </Table>
        </div>
      </div>

      <AccountDetailsModal
        account={detailsModalAccount}
        isOpen={Boolean(detailsModalAccount)}
        onClose={() => setDetailsModalAccount(null)}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onOpenProfileSession={onOpenProfileSession}
        onConfirmProfileSession={onConfirmProfileSession}
        onClearProfileSession={onClearProfileSession}
      />

      <ConfirmDialog
        isOpen={deleteDialog.isOpen}
        onClose={() => {
          if (!isDeleting) setDeleteDialog({ isOpen: false });
        }}
        onConfirm={handleConfirmDelete}
        title={
          deleteDialog.isOpen && deleteDialog.mode === 'bulk'
            ? t('accounts.deleteBulkTitle')
            : t('accounts.deleteAccountTitle')
        }
        message={
          deleteDialog.isOpen && deleteDialog.mode === 'bulk'
            ? t('accounts.deleteBulkMessage', { count: deleteDialog.accountIds.length })
            : t('accounts.deleteAccountMessage')
        }
        confirmText={t('accounts.confirmDelete')}
        cancelText={t('common.cancel')}
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
}
