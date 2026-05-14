import { useCallback } from 'react';
import { toast } from 'sonner';
import { convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { Account } from '../types/generated';
import {
  bulkExportAccounts,
  importAccountsPayload,
  openAccountBrowser,
  openAccountProfileSession,
  confirmAccountProfileSession,
  clearAccountProfileSession,
  updateAccountNotesTags,
  checkAccountStatus,
  checkFireworksApiKey,
  updateAccountMetadata,
} from '@/lib/tauri/modules/accounts';
import { useAccountsStore } from '../stores/accounts';
import { t } from '../lib/i18n';
import {
  normalizeJsonAccounts,
  parseCsvAccounts,
  readBlobText,
  validateImportRecords,
} from '../lib/accounts/importParser';

interface UseAccountsActionsParams {
  selectedIds: Set<number>;
  filteredAccountIds: number[];
  expiredAccountIds: number[];
  isImporting: boolean;
  setIsImporting: (value: boolean) => void;
  startBulkRefresh: (accountIds: number[]) => Promise<{ success: number; failed: number } | void>;
  fetchAccounts: () => Promise<void>;
  deleteAccounts: (ids: number[]) => Promise<void>;
  clearSelection: () => void;
}

export function useAccountsActions({
  selectedIds,
  filteredAccountIds,
  expiredAccountIds,
  isImporting,
  setIsImporting,
  startBulkRefresh,
  fetchAccounts,
  deleteAccounts,
  clearSelection,
}: UseAccountsActionsParams) {
  // Helper: extract Fireworks API key from account (token or parsed metadata)
  const getFireworksApiKey = (account: Account): string | null => {
    if (account.token?.trim()) return account.token.trim();
    if (account.metadata) {
      try {
        const meta = JSON.parse(account.metadata);
        return meta.api_key || meta.apiKey || null;
      } catch {
        return null;
      }
    }
    return null;
  };

  const handleCheckStatus = useCallback(
    async (id: number) => {
      const store = useAccountsStore.getState();
      store.setQuotaChecking(id, true);
      store.clearQuotaCheckError(id);
      try {
        const account = store.accounts.find(a => a.id === id);
        if (account?.provider?.toLowerCase() === 'fireworks') {
          const apiKey = getFireworksApiKey(account);
          if (apiKey) {
            const status = await checkFireworksApiKey({ apiKey });
            if (!status.valid) {
              // Key expired or invalid — show as exhausted
              store.setProviderQuota(id, {
                limit: 0,
                used: 0,
                remaining: 0,
                checkedAt: Date.now(),
                status: status.suspendState || status.accountState || undefined,
              });
              return;
            }
            if (typeof status.monthlySpendLimit === 'number' && typeof status.monthlySpendUsed === 'number') {
              const limit = status.monthlySpendLimit;
              const used = status.monthlySpendUsed;
              const remaining = status.monthlySpendRemaining ?? Math.max(0, limit - used);
              store.setProviderQuota(id, {
                limit,
                used,
                remaining,
                checkedAt: Date.now(),
                status: status.suspendState || status.accountState || undefined,
              });
            }
            return;
          }
        }
        await checkAccountStatus({ accountId: id });
        await store.refreshAccount(id);
        await fetchAccounts();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Do NOT set quota on API error — let it show "Failed" for retry
        store.setQuotaCheckError(id, message);
        console.error(`[QuotaCheck] Account ${id}: ${message}`);
      } finally {
        store.setQuotaChecking(id, false);
      }
    },
    [fetchAccounts]
  );

  const handleOpenBrowser = useCallback(async (id: number) => {
    try {
      toast.info(t('accounts.openingBrowser'));
      await openAccountBrowser({ accountId: id });
      toast.success(t('accounts.browserOpened'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[Accounts] Failed to open browser:', error);
      toast.error(t('accounts.browserOpenFailed', { message }));
    }
  }, []);

  const handleOpenProfileSession = useCallback(
    async (id: number) => {
      try {
        await openAccountProfileSession({ accountId: id });
        toast.success(t('accounts.profileSessionOpen'));
        await fetchAccounts();
      } catch (error) {
        console.error('[Accounts] Failed to open profile session:', error);
        toast.error(
          `Failed to open profile session: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },
    [fetchAccounts]
  );

  const handleConfirmProfileSession = useCallback(
    async (id: number) => {
      try {
        await confirmAccountProfileSession({ accountId: id });
        toast.success(t('accounts.profileSessionConfirm'));
        await fetchAccounts();
      } catch (error) {
        console.error('[Accounts] Failed to confirm profile session:', error);
        toast.error(
          `Failed to confirm profile session: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },
    [fetchAccounts]
  );

  const handleClearProfileSession = useCallback(
    async (id: number) => {
      try {
        await clearAccountProfileSession({ accountId: id });
        toast.success(t('accounts.profileSessionClear'));
        await fetchAccounts();
      } catch (error) {
        console.error('[Accounts] Failed to clear profile session:', error);
        toast.error(
          `Failed to clear profile session: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },
    [fetchAccounts]
  );

  const handleUpdateAccount = useCallback(
    async (accountId: number, updates: { notes?: string; tags?: string }) => {
      await updateAccountNotesTags({
        accountId,
        notes: updates.notes,
        tags: updates.tags,
      });
      await fetchAccounts();
    },
    [fetchAccounts]
  );

  const handleExportCSV = useCallback(async () => {
    try {
      const targets = selectedIds.size > 0 ? Array.from(selectedIds) : filteredAccountIds;
      if (!targets.length) {
        toast.info('No accounts to export');
        return;
      }

      const csv = await bulkExportAccounts({ accountIds: targets, format: 'csv' });
      const blob = new Blob([csv], { type: 'text/csv' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `accounts_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      toast.success(`Exported ${targets.length} account${targets.length > 1 ? 's' : ''}`);
    } catch (error) {
      console.error('[Accounts] Error exporting accounts:', error);
      toast.error(`Failed to export: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [filteredAccountIds, selectedIds]);

  const handleImportAccounts = useCallback(async () => {
    if (isImporting) return;
    setIsImporting(true);

    try {
      const selection = await open({
        multiple: false,
        filters: [{ name: 'Accounts', extensions: ['json', 'csv'] }],
      });

      if (!selection) return;

      const selected = Array.isArray(selection) ? selection[0] : selection;
      if (!selected) return;

      const fileName = typeof selected === 'string' ? selected : selected.name;
      const extension = fileName.split('.').pop()?.toLowerCase();
      if (extension !== 'json' && extension !== 'csv') {
        toast.error('Unsupported file type. Please use .json or .csv');
        return;
      }

      const fileText =
        typeof selected === 'string'
          ? await (async () => {
              const fileUrl = convertFileSrc(selected);
              const response = await fetch(fileUrl);
              if (!response.ok) {
                throw new Error('Failed to read selected file');
              }

              const blob = await response.blob();
              return readBlobText(blob);
            })()
          : await selected.text();

      const parsed =
        extension === 'json'
          ? normalizeJsonAccounts(JSON.parse(fileText))
          : { payloads: parseCsvAccounts(fileText), errors: [] };

      const { valid, errors: validationErrors } = validateImportRecords(parsed.payloads);
      const frontendErrors = [...parsed.errors, ...validationErrors];

      if (parsed.payloads.length === 0) {
        toast.info('No account records found in file');
        return;
      }

      if (valid.length === 0) {
        const detailSummary = frontendErrors.length
          ? ` ${frontendErrors.slice(0, 3).join(' • ')}`
          : '';
        toast.error(`No valid account records found.${detailSummary}`);
        return;
      }

      const skippedInvalid = parsed.payloads.length - valid.length;
      const result = await importAccountsPayload(JSON.stringify(valid));

      const combinedTotal = parsed.payloads.length;
      const combinedSucceeded = result.succeeded;
      const combinedFailed = result.failed + skippedInvalid;
      const combinedErrors = [...frontendErrors, ...result.errors];

      const baseSummary = `Imported ${combinedSucceeded}/${combinedTotal}. Failed ${combinedFailed}.`;
      const skipSummary = skippedInvalid > 0 ? ` Skipped ${skippedInvalid} invalid.` : '';
      const detailSummary = combinedErrors.length
        ? ` ${combinedErrors.slice(0, 3).join(' • ')}`
        : '';

      if (combinedSucceeded > 0 && combinedFailed === 0) {
        toast.success(`${baseSummary}${skipSummary}${detailSummary}`);
      } else if (combinedSucceeded > 0) {
        toast.info(`${baseSummary}${skipSummary}${detailSummary}`);
      } else {
        toast.error(`${baseSummary}${skipSummary}${detailSummary}`);
      }

      await fetchAccounts();
    } catch (error) {
      console.error('[Accounts] Import failed:', error);
      toast.error(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsImporting(false);
    }
  }, [fetchAccounts, isImporting, setIsImporting]);

  const handleRefreshAll = useCallback(async () => {
    try {
      const targets = selectedIds.size > 0 ? Array.from(selectedIds) : filteredAccountIds;
      if (!targets.length) {
        toast.info('No accounts to refresh');
        return;
      }
      await startBulkRefresh(targets);
      await fetchAccounts();
    } catch (error) {
      console.error('[Accounts] Error refreshing accounts:', error);
      toast.error(`Failed to refresh: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [fetchAccounts, filteredAccountIds, selectedIds, startBulkRefresh]);

  const handleRefreshExpired = useCallback(async () => {
    if (expiredAccountIds.length === 0) {
      toast.info('No expired accounts to refresh');
      return;
    }
    try {
      await startBulkRefresh(expiredAccountIds);
      await fetchAccounts();
    } catch (error) {
      console.error('[Accounts] Error refreshing expired accounts:', error);
      toast.error(`Failed to refresh: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [expiredAccountIds, fetchAccounts, startBulkRefresh]);

  const handleRemoveSelectedAccounts = useCallback(
    async (ids?: number[]) => {
      const targets = ids || Array.from(selectedIds);

      if (!targets.length) {
        toast.error('No accounts selected');
        return;
      }

      if (!window.confirm(t('accounts.deleteConfirm', { count: targets.length }))) {
        return;
      }

      try {
        await deleteAccounts(targets);
        toast.success(`Deleted ${targets.length} account${targets.length > 1 ? 's' : ''}`);
        clearSelection();
        await fetchAccounts();
      } catch (error) {
        console.error('[Accounts] Error deleting accounts:', error);
        toast.error(
          `Failed to delete accounts: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },
    [selectedIds, deleteAccounts, clearSelection, fetchAccounts]
  );

  const handleToggleAutoRefreshQuota = useCallback(
    async (account: Account) => {
      try {
        let meta: Record<string, unknown> = {};
        if (account.metadata) {
          try {
            meta = JSON.parse(account.metadata);
          } catch {
            meta = {};
          }
        }
        const newValue = !meta.autoRefreshQuota;
        meta.autoRefreshQuota = newValue;
        await updateAccountMetadata({
          accountId: account.id,
          metadata: JSON.stringify(meta),
        });
        toast.success(
          newValue
            ? t('accounts.autoRefreshEnabled')
            : t('accounts.autoRefreshDisabled')
        );
        await fetchAccounts();
      } catch (error) {
        console.error('[Accounts] Failed to toggle auto refresh:', error);
        toast.error(
          `Failed to toggle auto refresh: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },
    [fetchAccounts]
  );

  return {
    handleCheckStatus,
    handleOpenBrowser,
    handleOpenProfileSession,
    handleConfirmProfileSession,
    handleClearProfileSession,
    handleUpdateAccount,
    handleExportCSV,
    handleImportAccounts,
    handleRefreshAll,
    handleRefreshExpired,
    handleRemoveSelectedAccounts,
    handleToggleAutoRefreshQuota,
  };
}
