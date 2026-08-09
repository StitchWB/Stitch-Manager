import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Users } from 'lucide-react';
import type { Account } from '../types/generated';
import { t } from '../lib/i18n';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';
import type { AccountRelationEdge, RelationType } from '../lib/accounts/relations';
import type { AccountsTableVisibleColumns } from '../stores/uiPreferences';
import { useUIPreferencesStore } from '../stores/uiPreferences';
import { AccountRow } from './accounts/AccountRow';
import { AccountInspectorPanel, ConfirmDialog } from '@/components/ui';
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
  onUpdate,
  onRelationEdgeClick,
}: AccountsTableProps) {
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [inspectedAccountId, setInspectedAccountId] = useState<number | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>({ isOpen: false });
  const [isDeleting, setIsDeleting] = useState(false);
  const [panelWidth, setPanelWidth] = useState<number>(
    () => useUIPreferencesStore.getState().getComponentPreference<number>('accountsInspector.width', 500),
  );

  // Track available row width so the panel can adapt: docked on wide screens,
  // non-modal overlay on narrow ones (table keeps full width there).
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const hasMainLayout = !isLoading && accounts.length > 0;
  useEffect(() => {
    if (!hasMainLayout) return;
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    setContainerWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, [hasMainLayout]);

  // Docked master-detail at any size; on narrow containers the panel is capped
  // so the table keeps a usable width (remaining columns via horizontal scroll).
  const displayWidth =
    containerWidth > 0
      ? Math.min(panelWidth, Math.max(340, containerWidth - 620))
      : panelWidth;

  // On tight tables the hover quick-actions column is dead space — hide it
  // (the same actions live in the row ⋯ menu and the inspector action bar).
  const tableAreaWidth = containerWidth > 0 ? containerWidth - displayWidth - 4 : 0;
  const hideQuickActions = tableAreaWidth > 0 && tableAreaWidth < 760;
  // The 2FA column needs ~100px of real estate; below this the chip would be
  // clipped under the pinned actions column — hide it (codes stay in the inspector).
  const hideTotpColumn = tableAreaWidth > 0 && tableAreaWidth < 900;

  const inspectedAccount = accounts.find(a => a.id === inspectedAccountId) ?? null;

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

  // Keyboard navigation: ArrowUp/ArrowDown move inspection, Escape closes panel
  useEffect(() => {
    if (inspectedAccountId == null) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return;
      if (openMenuId != null) return;
      if (deleteDialog.isOpen) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        setInspectedAccountId(null);
        return;
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const currentIdx = accounts.findIndex(a => a.id === inspectedAccountId);
        if (currentIdx === -1) return;
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const newIdx = Math.max(0, Math.min(accounts.length - 1, currentIdx + delta));
        if (newIdx !== currentIdx && accounts[newIdx]) {
          setInspectedAccountId(accounts[newIdx].id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [inspectedAccountId, accounts, openMenuId, deleteDialog.isOpen]);

  // Panel resizer: drag to adjust width (clamp 400–720), persist on mouseup
  const handleResizerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelWidth;

    const handleMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const newWidth = Math.max(340, Math.min(720, startWidth - delta));
      setPanelWidth(newWidth);
    };

    const handleMouseUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Persist final width (computed from the event, not inside a state updater —
      // a zustand set() inside an updater is a render-phase side effect)
      const finalWidth = Math.max(340, Math.min(720, startWidth - (ev.clientX - startX)));
      setPanelWidth(finalWidth);
      useUIPreferencesStore.getState().setComponentPreference('accountsInspector.width', finalWidth);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

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
        if (deleteDialog.accountId === inspectedAccountId) {
          setInspectedAccountId(null);
        }
      } else {
        await onDeleteSelected(deleteDialog.accountIds);
        if (deleteDialog.accountIds.includes(inspectedAccountId ?? -1)) {
          setInspectedAccountId(null);
        }
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
    setInspectedAccountId(account.id);
    setOpenMenuId(null);
  };

  const hasRefData = accounts.some(
    a => a.provider === 'v0_app' || Boolean(a.refUrl) || Boolean(a.refCode)
  );

  return (
    <div ref={rootRef} className="flex h-full overflow-hidden px-4 pb-4">
      <div className="relative min-h-0 flex-1 min-w-0 overflow-hidden rounded-xl border border-vsc-border bg-vsc-terminal/80">
        <div className="w-full h-full">
          <Table
            containerClassName="h-full overflow-y-auto overflow-x-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10"
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
              {!hideQuickActions && (
                <TableHead className="w-[90px] min-w-[90px] px-1 py-1.5 text-[10px] text-slate-400 whitespace-nowrap normal-case tracking-normal">
                </TableHead>
              )}
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
              {/* TOTP column — the row always renders a TOTP cell, so the header
                  must reserve the slot to keep table-fixed columns aligned */}
              {!hideTotpColumn && (
                <TableHead className="w-[100px] min-w-[100px] px-2 py-1.5 text-[10px] text-slate-400 whitespace-nowrap normal-case tracking-normal">
                  {t('totp.columnHeader')}
                </TableHead>
              )}
              {hasRefData && (
                <TableHead className="w-[80px] min-w-[80px] px-2 py-1.5 text-[10px] text-slate-400 whitespace-nowrap normal-case tracking-normal">
                  {t('accounts.account_ref_cell.column_header')}
                </TableHead>
              )}
              <TableHead className="sticky right-0 z-30 w-[68px] min-w-[68px] max-w-[68px] px-1 py-1.5 text-right text-[10px] text-slate-400 whitespace-nowrap normal-case tracking-normal bg-vsc-terminal/95">
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
                isInspected={inspectedAccountId === account.id}
                isRefreshing={isAccountRefreshing(account.id)}
                isMenuOpen={openMenuId === account.id}
                visibleColumns={visibleColumns}
                showRefColumn={hasRefData}
                hideQuickActions={hideQuickActions}
                hideTotpColumn={hideTotpColumn}
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

      {/* Resizer + Inspector Panel */}
      <AnimatePresence>
        {inspectedAccount && (
          <motion.div
            key="inspector-wrapper"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: displayWidth, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="shrink-0 h-full flex"
            style={{ overflow: 'hidden' }}
          >
            {/* Resizer divider */}
            <div
              className="shrink-0 w-1 cursor-col-resize bg-white/5 hover:bg-indigo-500/40 transition-colors"
              onMouseDown={handleResizerMouseDown}
            />
            {/* Panel */}
            <div className="shrink-0 h-full min-w-0 flex-1" style={{ width: displayWidth }}>
              <AccountInspectorPanel
                key={inspectedAccount.id}
                account={inspectedAccount}
                isActive={isAccountActive(inspectedAccount)}
                onToggleActive={() => handleToggleActive(inspectedAccount)}
                onOpenBrowser={onOpenBrowser ? (id) => { void onOpenBrowser(id); } : undefined}
                onAuthorizeKiroAccount={onAuthorizeKiroAccount ? (id) => { void onAuthorizeKiroAccount(id); } : undefined}
                onOpenProfileSession={onOpenProfileSession}
                onConfirmProfileSession={onConfirmProfileSession}
                onClearProfileSession={onClearProfileSession}
                onToggleAutoRefreshQuota={onToggleAutoRefreshQuota}
                onCopyRefUrl={onCopyRefUrl}
                onRefreshRefUrl={onRefreshRefUrl}
                onCopyToken={token =>
                  copy(token, {
                    sensitive: true,
                    autoClear: true,
                    autoClearAfterMs: 15000,
                    requireConfirmation: true,
                    confirmationMessage: t('accounts.copyTokenSensitiveConfirm'),
                  })
                }
                onUpdate={onUpdate}
                onRequestDelete={openSingleDelete}
                onClose={() => setInspectedAccountId(null)}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
