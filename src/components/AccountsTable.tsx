import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import type { Account } from '../types/generated';
import { t } from '../lib/i18n';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';
import type { AccountRelationEdge, RelationType } from '../lib/accounts/relations';
import type { AccountsTableVisibleColumns } from '../stores/uiPreferences';
import { AccountRow } from './accounts/AccountRow';
import { AccountDrawer, ConfirmDialog } from '@/components/ui';
import {
  Checkbox,
  EmptyState,
  SkeletonLoader,
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
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
  onToggleAutoRefreshQuota?: (account: Account) => Promise<void>;
  onOpenProfileSession?: (accountId: number) => Promise<void>;
  onConfirmProfileSession?: (accountId: number) => Promise<void>;
  onClearProfileSession?: (accountId: number) => Promise<void>;
  onAuthorizeKiroAccount?: (accountId: number) => Promise<void>;
  onCopyRefUrl?: (refUrl: string) => Promise<void>;
  onRefreshRefUrl?: (accountId: number) => Promise<void>;
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
  visibleColumns = { lastLogin: true, apiKey: true, quota: true },
  onToggleSelection,
  onSelectAll,
  onClearSelection,
  onDelete,
  onDeleteSelected,
  onActivate,
  onCheckStatus,
  isAccountRefreshing,
  onOpenBrowser,
  onToggleAutoRefreshQuota,
  onOpenProfileSession,
  onConfirmProfileSession,
  onClearProfileSession,
  onAuthorizeKiroAccount,
  onCopyRefUrl,
  onRefreshRefUrl,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onUpdate: _onUpdate,
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

  if (isLoading && accounts.length === 0) {
    return (
      <div className="flex h-full flex-col overflow-hidden px-4 pb-4">
        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-vsc-border bg-vsc-terminal/80 p-4">
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

  const hasRefData = accounts.some(
    a => a.provider === 'v0_app' || Boolean(a.refUrl) || Boolean(a.refCode)
  );

  return (
    <div className="flex h-full flex-col overflow-hidden px-4 pb-4">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-vsc-border bg-vsc-terminal/80">
        <div className="w-full h-full">
          <Table
            containerClassName="h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10"
            className="w-full table-fixed text-xs"
            aria-label={t('accounts.accountsTable')}
          >
          <TableHeader className="sticky top-0 z-20 border-b border-white/[0.08] bg-vsc-terminal/95 backdrop-blur-sm">
            <TableRow className="hover:bg-transparent h-[36px]">
              <TableHead className="sticky left-0 z-30 w-[40px] min-w-[40px] max-w-[40px] px-2 py-1.5 text-xs text-slate-400 whitespace-nowrap bg-vsc-terminal/95">
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
              <TableHead className="sticky left-[40px] z-30 w-[80px] min-w-[80px] px-2 py-1.5 text-[10px] text-slate-400 whitespace-nowrap normal-case tracking-normal bg-vsc-terminal/95">
                {t('accounts.provider')}
              </TableHead>
              <TableHead className="sticky left-[120px] z-30 w-[160px] min-w-[160px] max-w-[180px] px-2 py-1.5 text-[10px] text-slate-400 whitespace-nowrap normal-case tracking-normal bg-vsc-terminal/95">
                {t('accounts.account')}
              </TableHead>
              <TableHead className="w-[90px] min-w-[90px] px-1 py-1.5 text-[10px] text-slate-400 whitespace-nowrap normal-case tracking-normal">
              </TableHead>
              <TableHead className="w-[70px] min-w-[70px] px-2 py-1.5 text-[10px] text-slate-400 whitespace-nowrap normal-case tracking-normal">
                {t('accounts.statusHeader')}
              </TableHead>
              <TableHead
                className={
                  visibleColumns.lastLogin
                    ? 'w-[120px] min-w-[120px] px-2 py-1.5 text-[10px] text-slate-400 whitespace-nowrap normal-case tracking-normal'
                    : 'hidden'
                }
              >
                {t('accounts.lastLoginAt')}
              </TableHead>
              <TableHead
                className={
                  visibleColumns.apiKey
                    ? 'w-[70px] min-w-[70px] px-2 py-1.5 text-[10px] text-slate-400 whitespace-nowrap normal-case tracking-normal'
                    : 'hidden'
                }
              >
                {t('accounts.apiKeyLabel')}
              </TableHead>
              <TableHead
                className={
                  visibleColumns.quota
                    ? 'w-[80px] min-w-[80px] px-2 py-1.5 text-[10px] text-slate-400 whitespace-nowrap normal-case tracking-normal'
                    : 'hidden'
                }
              >
                {t('accounts.columnQuota')}
              </TableHead>
              {hasRefData && (
                <TableHead className="w-[80px] min-w-[80px] px-2 py-1.5 text-[10px] text-slate-400 whitespace-nowrap normal-case tracking-normal">
                  {t('accounts.account_ref_cell.column_header')}
                </TableHead>
              )}
              <TableHead className="w-[48px] min-w-[48px] max-w-[48px] px-1 py-1.5 text-right text-[10px] text-slate-400 whitespace-nowrap normal-case tracking-normal">
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
                showRefColumn={hasRefData}
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
                onToggleAutoRefreshQuota={onToggleAutoRefreshQuota}
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
                onAuthorizeKiroAccount={onAuthorizeKiroAccount}
                onCopyRefUrl={onCopyRefUrl}
                onRefreshRefUrl={onRefreshRefUrl}
                onRelationEdgeClick={onRelationEdgeClick}
              />
            ))}
          </TableBody>
          </Table>
        </div>
      </div>

      <AccountDrawer
        account={detailsModalAccount}
        isOpen={Boolean(detailsModalAccount)}
        onClose={() => setDetailsModalAccount(null)}
        onCopyToken={(token) => { navigator.clipboard.writeText(token); }}
        onRefresh={() => { /* refresh handled by parent */ }}
        onDelete={(accountId) => {
          if (onDelete) onDelete(accountId);
          setDetailsModalAccount(null);
        }}
        onOpenBrowser={onOpenBrowser ? (id) => { void onOpenBrowser(id); } : undefined}
        onAuthorizeKiroAccount={onAuthorizeKiroAccount ? (id) => { void onAuthorizeKiroAccount(id); } : undefined}
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
