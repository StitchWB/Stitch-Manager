import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  RefreshCw,
  Download,
  Upload,
  Users,
  LayoutGrid,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { listen } from '@tauri-apps/api/event';
import { convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import Header from '../components/layout/Header';
import AccountsTable from '../components/AccountsTable';
import AddAccountModal from '../components/AddAccountModal';
import { QuotaFilterChip } from '../components/ui/QuotaFilterChip';
import { FloatingActionBar } from '../components/ui/FloatingActionBar';
import { EmptyState, SkeletonLoader, ActionButtonGroup, Button } from '../components/ui';
import { useAccountsStore } from '../stores/accounts';
import { useUIPreferencesStore } from '../stores/uiPreferences';
import {
  checkAccountStatus,
  openAccountBrowser,
  bulkExportAccounts,
  importAccountsPayload,
  updateAccountNotesTags,
  openAccountProfileSession,
  confirmAccountProfileSession,
  clearAccountProfileSession,
} from '@/lib/tauri';
import { t } from '../lib/i18n';
import { useBulkRefresh } from '../hooks/useBulkRefresh';
import { useUrlState } from '../hooks/useUrlState';
import type { AccountStatus } from '../types';
import { ProviderLogo } from '../components/ui/ProviderLogo';
import { cn } from '../lib/utils';
import { ACCOUNT_STATUS_COLORS } from '../constants/colors';
import { getAccountStatusLabel } from '../lib/accountStatus';
import { FilterDropdown, type FilterOption } from '../components/ui/FilterDropdown';
import {
  extractRelationHints,
  hasAnyRelations,
  hasExplicitRelationLinks,
  isOAuthCapableIdentity,
} from '../lib/accounts/relations';

type ImportAccountPayload = {
  provider?: string;
  email?: string;
  password?: string;
  token?: string;
  refreshToken?: string;
  quotaLimit?: number;
  metadata?: Record<string, unknown> | string;
};

type ParsedAccountsResult = {
  payloads: ImportAccountPayload[];
  errors: string[];
};

const readBlobAsText = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Failed to read file contents'));
    reader.readAsText(blob);
  });

const parseCsvLine = (line: string): string[] => {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  fields.push(current);
  return fields;
};

const parseCsvAccounts = (text: string): ImportAccountPayload[] => {
  const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0]).map(value => value.trim().toLowerCase());
  const records: ImportAccountPayload[] = [];

  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const record: ImportAccountPayload = {};

    header.forEach((key, index) => {
      const rawValue = values[index]?.trim();
      if (!rawValue) return;

      switch (key) {
        case 'provider':
          record.provider = rawValue;
          break;
        case 'email':
          record.email = rawValue;
          break;
        case 'password':
          record.password = rawValue;
          break;
        case 'token':
          record.token = rawValue;
          break;
        case 'refreshtoken':
        case 'refresh_token':
          record.refreshToken = rawValue;
          break;
        case 'quotalimit':
        case 'quota_limit': {
          const parsed = Number(rawValue);
          if (!Number.isNaN(parsed)) record.quotaLimit = parsed;
          break;
        }
        case 'metadata':
          record.metadata = rawValue;
          break;
        default:
          break;
      }
    });

    records.push(record);
  }

  return records;
};

const normalizeJsonAccounts = (data: unknown): ParsedAccountsResult => {
  if (!Array.isArray(data)) {
    throw new Error('JSON must be an array of account records');
  }

  const errors: string[] = [];
  const payloads = data.map((item, index) => {
    if (!item || typeof item !== 'object') {
      errors.push(`Record ${index + 1} is not an object`);
      return {} satisfies ImportAccountPayload;
    }

    const record = item as Record<string, unknown>;
    const getString = (value: unknown): string | undefined =>
      typeof value === 'string' ? value : undefined;

    const quotaRaw = record.quotaLimit ?? record.quota_limit;
    const quotaValue = typeof quotaRaw === 'number' ? quotaRaw : Number(quotaRaw);

    return {
      provider: getString(record.provider),
      email: getString(record.email),
      password: getString(record.password),
      token: getString(record.token),
      refreshToken: getString(record.refreshToken ?? record.refresh_token),
      quotaLimit: Number.isNaN(quotaValue) ? undefined : quotaValue,
      metadata:
        typeof record.metadata === 'string' || typeof record.metadata === 'object'
          ? (record.metadata as Record<string, unknown> | string)
          : undefined,
    };
  });

  return { payloads, errors };
};

const validateImportRecords = (records: ImportAccountPayload[]) => {
  const valid: ImportAccountPayload[] = [];
  const errors: string[] = [];

  records.forEach((record, index) => {
    const provider = typeof record.provider === 'string' ? record.provider.trim() : '';
    const email = typeof record.email === 'string' ? record.email.trim() : '';
    const password = typeof record.password === 'string' ? record.password.trim() : '';

    if (!provider || !email || !password) {
      errors.push(`Record ${index + 1} missing provider, email, or password`);
      return;
    }

    valid.push({
      ...record,
      provider,
      email,
      password,
    });
  });

  return { valid, errors };
};

export default function Accounts() {
  const navigate = useNavigate();
  const {
    accounts: storeAccounts,
    loading,
    fetchAccounts,
    deleteAccount,
    deleteAccounts,
    toggleSelection,
    selectAll,
    clearSelection,
    selectedIds,
    setSelectedIds,
    setSelectedProvider,
    activeAccountIds,
    setActiveAccount,
    setSearchQuery: setStoreSearchQuery,
    setQuotaFilter: setStoreQuotaFilter,
    setStatusFilter: setStoreStatusFilter,
  } = useAccountsStore();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const {
    startBulkRefresh,
    isRefreshing: isBulkRefreshing,
    progress: bulkProgress,
    isAccountRefreshing,
  } = useBulkRefresh({ concurrency: 3, delayMs: 500 });

  // Sync with UI preferences
  const {
    accountsPage,
    setAccountsProviderFilter,
    setAccountsStatusFilter,
    setAccountsQuotaFilter,
    setAccountsSearchQuery,
    setAccountsTagFilter,
    setAccountsRelationFilter,
  } = useUIPreferencesStore();

  // Initialize state from preferences (use preferences as source of truth)
  const [providerFilter, setProviderFilter] = useUrlState(
    'provider',
    accountsPage.providerFilter || 'all'
  );
  const [statusFilter, setStatusFilter] = useUrlState('status', accountsPage.statusFilter || 'all');
  const [searchQuery, setSearchQuery] = useState(accountsPage.searchQuery || '');
  const [quotaFilter, setQuotaFilter] = useState<string>(accountsPage.quotaFilter || 'any');
  const [tagFilter, setTagFilter] = useUrlState('tag', accountsPage.tagFilter || 'all');
  const [relationFilter, setRelationFilter] = useUrlState(
    'relation',
    accountsPage.relationFilter || 'all'
  );

  // Keep store selection in sync with current visible set (so Select All works on derived filters)
  useEffect(() => {
    setSelectedProvider(providerFilter === 'all' ? null : (providerFilter as any));
    setStoreStatusFilter(statusFilter === 'all' ? null : (statusFilter as AccountStatus));
    setStoreQuotaFilter(quotaFilter as any);
    setStoreSearchQuery(searchQuery);
  }, [
    providerFilter,
    statusFilter,
    quotaFilter,
    searchQuery,
    setSelectedProvider,
    setStoreStatusFilter,
    setStoreQuotaFilter,
    setStoreSearchQuery,
  ]);

  const parseTags = (tagsString: string | null): string[] => {
    if (!tagsString) return [];
    try {
      const parsed = JSON.parse(tagsString);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const tagOptions = useMemo((): FilterOption<string>[] => {
    const counts = new Map<string, number>();
    storeAccounts.forEach(acc => {
      parseTags(acc.tags).forEach(tag => {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      });
    });

    const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);

    const profileMetaOrder = [
      'profile:ready',
      'profile:pending',
      'profile:disabled',
      'profile:manual',
      'profile:antidetect',
    ];
    const profileMeta = profileMetaOrder
      .filter(tag => counts.has(tag))
      .map(tag => ({
        value: tag,
        label: tag,
        count: counts.get(tag),
      }));

    const other = entries
      .filter(([tag]) => !profileMetaOrder.includes(tag))
      .slice(0, 12)
      .map(([tag, count]) => ({ value: tag, label: tag, count }));

    return [{ value: 'all', label: t('filters.any') }, ...profileMeta, ...other];
  }, [storeAccounts]);

  // Memoized handlers to prevent unnecessary re-renders
  const handleProviderFilterChange = useCallback(
    (value: string) => {
      setProviderFilter(value);
      setAccountsProviderFilter(value);
      setSelectedProvider(value === 'all' ? null : (value as any));
    },
    [setProviderFilter, setAccountsProviderFilter, setSelectedProvider]
  );

  const handleStatusFilterChange = useCallback(
    (value: string) => {
      setStatusFilter(value);
      setAccountsStatusFilter(value);
      setStoreStatusFilter(value === 'all' ? null : (value as AccountStatus));
    },
    [setStatusFilter, setAccountsStatusFilter, setStoreStatusFilter]
  );

  const handleQuotaFilterChange = useCallback(
    (value: string) => {
      setQuotaFilter(value);
      setAccountsQuotaFilter(value);
      setStoreQuotaFilter(value as any);
    },
    [setAccountsQuotaFilter, setStoreQuotaFilter]
  );

  const handleTagFilterChange = useCallback(
    (value: string) => {
      setTagFilter(value);
      setAccountsTagFilter(value);
    },
    [setTagFilter, setAccountsTagFilter]
  );

  const relationOptions = useMemo((): FilterOption<string>[] => {
    const hasAnyCount = storeAccounts.filter(acc => hasAnyRelations(acc)).length;
    const explicitCount = storeAccounts.filter(acc => hasExplicitRelationLinks(acc)).length;
    const oauthCapableCount = storeAccounts.filter(acc => isOAuthCapableIdentity(acc)).length;

    return [
      { value: 'all', label: t('accounts.relationFilterAll') },
      { value: 'has_any', label: t('accounts.relationFilterHasAny'), count: hasAnyCount },
      {
        value: 'linked_only',
        label: t('accounts.relationFilterLinkedOnly'),
        count: explicitCount,
      },
      {
        value: 'oauth_capable',
        label: t('accounts.relationFilterOauthCapable'),
        count: oauthCapableCount,
      },
    ];
  }, [storeAccounts]);

  const handleRelationFilterChange = useCallback(
    (value: string) => {
      setRelationFilter(value);
      setAccountsRelationFilter(value);
    },
    [setRelationFilter, setAccountsRelationFilter]
  );

  const handleSearchQueryChange = useCallback(
    (value: string) => {
      setSearchQuery(value);
      setAccountsSearchQuery(value);
      setStoreSearchQuery(value);
    },
    [setAccountsSearchQuery, setStoreSearchQuery]
  );

  const providerCounts = useMemo(() => {
    const counts: Record<string, number> = { all: 0 };
    storeAccounts.forEach(acc => {
      counts.all++;

      // Count each provider separately - no mapping
      const provider = acc.provider;
      counts[provider] = (counts[provider] || 0) + 1;
    });
    return counts;
  }, [storeAccounts]);

  useEffect(() => {
    // Initial load
    fetchAccounts();

    // Listen for account-created events from backend
    const unlistenPromise = listen('account-created', () => {
      fetchAccounts();
    });

    // Refresh on tab focus/visibility, not by a tight interval.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchAccounts();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      unlistenPromise.then(unlisten => unlisten());
    };
  }, [fetchAccounts]);

  const handleRemoveSelectedAccounts = useCallback(
    async (ids?: number[]) => {
      const targets = ids || Array.from(selectedIds);
      console.log('[Accounts] handleRemoveSelectedAccounts called with targets:', targets);

      if (!targets.length) {
        console.log('[Accounts] No targets to delete');
        toast.error('No accounts selected');
        return;
      }

      if (!window.confirm(t('accounts.deleteConfirm', { count: targets.length }))) {
        console.log('[Accounts] User cancelled deletion');
        return;
      }

      try {
        console.log('[Accounts] Calling deleteAccounts...');
        await deleteAccounts(targets);
        console.log('[Accounts] deleteAccounts completed successfully');
        toast.success(`Deleted ${targets.length} account${targets.length > 1 ? 's' : ''}`);
        clearSelection();
        await fetchAccounts();
      } catch (e) {
        console.error('[Accounts] Error deleting accounts:', e);
        toast.error(`Failed to delete accounts: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [selectedIds, deleteAccounts, clearSelection, fetchAccounts]
  );

  const handleRemoveAccount = useCallback(
    async (id: number) => {
      try {
        await deleteAccount(id);
        fetchAccounts();
      } catch (e) {
        console.error(e);
      }
    },
    [deleteAccount, fetchAccounts]
  );

  const filteredAccounts = useMemo(() => {
    let filtered = [...storeAccounts];

    // Provider filter
    if (providerFilter !== 'all') {
      if (providerFilter === 'aws') {
        filtered = filtered.filter(a => a.provider === 'aws_builder_id');
      } else {
        filtered = filtered.filter(a => a.provider === providerFilter);
      }
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        a => a.email.toLowerCase().includes(q) || a.provider.toLowerCase().includes(q)
      );
    }
    if (statusFilter !== 'all') filtered = filtered.filter(a => a.status === statusFilter);

    // Tag filter
    if (tagFilter && tagFilter !== 'all') {
      filtered = filtered.filter(a => parseTags(a.tags).includes(tagFilter));
    }

    if (relationFilter !== 'all') {
      if (relationFilter === 'has_any') {
        filtered = filtered.filter(a => hasAnyRelations(a));
      } else if (relationFilter === 'linked_only') {
        filtered = filtered.filter(a => hasExplicitRelationLinks(a));
      } else if (relationFilter === 'oauth_capable') {
        filtered = filtered.filter(a => isOAuthCapableIdentity(a));
      }
    }

    // Apply quota filter (skip if 'any' or 'all')
    if (quotaFilter && quotaFilter !== 'any' && quotaFilter !== 'all') {
      if (quotaFilter === 'low_quota')
        filtered = filtered.filter(
          a => a.quota && a.quota.limit > 0 && a.quota.used / a.quota.limit > 0.8
        );
      else if (quotaFilter === 'has_quota')
        filtered = filtered.filter(
          a => a.quota && a.quota.limit > 0 && a.quota.used / a.quota.limit < 0.5
        );
      else if (quotaFilter === 'empty')
        filtered = filtered.filter(a => !a.quota || a.quota.used === 0);
      else if (quotaFilter === 'full')
        filtered = filtered.filter(
          a => a.quota && a.quota.limit > 0 && a.quota.used >= a.quota.limit
        );
    }
    return filtered;
  }, [
    storeAccounts,
    providerFilter,
    searchQuery,
    statusFilter,
    quotaFilter,
    tagFilter,
    relationFilter,
  ]);

  // Keep selection constrained to visible accounts to avoid mismatched counts/actions
  useEffect(() => {
    const visibleIds = new Set(filteredAccounts.map(a => a.id));
    const nextSelected = Array.from(selectedIds).filter(id => visibleIds.has(id));
    if (nextSelected.length !== selectedIds.size) {
      setSelectedIds(nextSelected);
    }
  }, [filteredAccounts, selectedIds, setSelectedIds]);

  const handleAddAccount = async (d: any) => {
    try {
      await useAccountsStore.getState().addAccount(d.provider, d.email, d.password);
      fetchAccounts();
    } catch (e) {
      console.error(e);
    }
  };
  const handleCheckStatus = async (id: number) => {
    try {
      await checkAccountStatus({ accountId: id });
      await useAccountsStore.getState().refreshAccount(id);
      await fetchAccounts();
    } catch (e) {
      console.error(e);
    }
  };
  const handleOpenBrowser = async (id: number) => {
    try {
      await openAccountBrowser({ accountId: id });
    } catch (error) {
      console.error(error);
    }
  };

  const handleOpenProfileSession = async (_id: number) => {
    try {
      await openAccountProfileSession({ accountId: _id });
      toast.success(t('accounts.profileSessionOpen'));
      await fetchAccounts();
    } catch (error) {
      console.error('[Accounts] Failed to open profile session:', error);
      toast.error(
        `Failed to open profile session: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  const handleConfirmProfileSession = async (_id: number) => {
    try {
      await confirmAccountProfileSession({ accountId: _id });
      toast.success(t('accounts.profileSessionConfirm'));
      await fetchAccounts();
    } catch (error) {
      console.error('[Accounts] Failed to confirm profile session:', error);
      toast.error(
        `Failed to confirm profile session: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  const handleClearProfileSession = async (_id: number) => {
    try {
      await clearAccountProfileSession({ accountId: _id });
      toast.success(t('accounts.profileSessionClear'));
      await fetchAccounts();
    } catch (error) {
      console.error('[Accounts] Failed to clear profile session:', error);
      toast.error(
        `Failed to clear profile session: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

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
  const handleExportCSV = async () => {
    try {
      const targets =
        selectedIds.size > 0 ? Array.from(selectedIds) : filteredAccounts.map(a => a.id);
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
    } catch (e) {
      console.error('[Accounts] Error exporting accounts:', e);
      toast.error(`Failed to export: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleImportAccounts = async () => {
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
              return readBlobAsText(blob);
            })()
          : await selected.text();

      let parsed: ParsedAccountsResult;
      if (extension === 'json') {
        parsed = normalizeJsonAccounts(JSON.parse(fileText));
      } else {
        parsed = { payloads: parseCsvAccounts(fileText), errors: [] };
      }

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
  };

  const handleRefreshAll = async () => {
    try {
      const targets =
        selectedIds.size > 0 ? Array.from(selectedIds) : filteredAccounts.map(a => a.id);

      if (targets.length === 0) {
        toast.info('No accounts to refresh');
        return;
      }

      await startBulkRefresh(targets);
      await fetchAccounts();
    } catch (e) {
      console.error('[Accounts] Error refreshing accounts:', e);
      toast.error(`Failed to refresh: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleRefreshExpired = async () => {
    const expiredAccountIds = filteredAccounts.filter(a => a.status === 'expired').map(a => a.id);
    if (expiredAccountIds.length === 0) {
      toast.info('No expired accounts to refresh');
      return;
    }
    try {
      await startBulkRefresh(expiredAccountIds);
      await fetchAccounts();
    } catch (e) {
      console.error('[Accounts] Error refreshing expired accounts:', e);
      toast.error(`Failed to refresh: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const expiredCount = storeAccounts.filter(a => a.status === 'expired').length;

  const handleBatchProfileAction = useCallback(
    async (action: 'open' | 'confirm' | 'clear') => {
      const targets = Array.from(selectedIds);
      if (!targets.length) return;

      const runner =
        action === 'open'
          ? handleOpenProfileSession
          : action === 'confirm'
            ? handleConfirmProfileSession
            : handleClearProfileSession;

      const settled = await Promise.allSettled(targets.map(id => runner(id)));
      const success = settled.filter(r => r.status === 'fulfilled').length;
      const failed = settled.length - success;

      if (failed === 0) {
        toast.success(t('accounts.batchResultSummary', { success: String(success), failed: '0' }));
        return;
      }

      const errors = settled
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .slice(0, 2)
        .map(r => (r.reason instanceof Error ? r.reason.message : String(r.reason)))
        .join(' • ');

      const summary = t('accounts.batchResultSummary', {
        success: String(success),
        failed: String(failed),
      });

      toast.warning(
        t('accounts.batchResultWithErrors', {
          summary,
          errors,
        })
      );
    },
    [selectedIds]
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#050508]">
      <Header title={t('accounts.title')} icon={<Users size={18} />} />

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar Filter Panel */}
        <aside className="w-[200px] lg:w-[220px] shrink-0 bg-[#111116]/50 backdrop-blur-md border-r border-white/5 flex flex-col overflow-hidden hidden md:flex">
          {/* Providers Section */}
          <div className="p-3">
            <h3 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2 px-2">
              {t('accounts.providers')}
            </h3>
            <div className="space-y-0.5">
              <button
                onClick={() => handleProviderFilterChange('all')}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors duration-150 relative',
                  providerFilter === 'all'
                    ? 'bg-indigo-500/15 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                )}
              >
                {providerFilter === 'all' && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-indigo-500 rounded-r shadow-[0_0_8px_rgba(99,102,241,0.6)]" />
                )}
                <LayoutGrid size={16} className="shrink-0 ml-2" />
                <span className="flex-1 text-left">{t('accounts.allAccounts')}</span>
                <span className="text-xs text-slate-400 font-medium tabular-nums">
                  {providerCounts.all}
                </span>
              </button>

              {[
                { id: 'kiro', label: 'Kiro' },
                { id: 'windsurf', label: 'Windsurf' },
                { id: 'trae', label: 'Trae' },
                { id: 'aws', label: 'AWS Builder ID' },
                { id: 'github', label: 'GitHub' },
              ].map(provider => (
                <button
                  key={provider.id}
                  onClick={() => handleProviderFilterChange(provider.id)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors duration-150 relative',
                    providerFilter === provider.id
                      ? 'bg-indigo-500/15 text-white'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  )}
                >
                  {providerFilter === provider.id && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-indigo-500 rounded-r shadow-[0_0_8px_rgba(99,102,241,0.6)]" />
                  )}
                  <ProviderLogo
                    provider={provider.id as any}
                    size={16}
                    colored={providerFilter === provider.id}
                    className="shrink-0 ml-2"
                  />
                  <span className="flex-1 text-left">{provider.label}</span>
                  {providerCounts[provider.id === 'aws' ? 'aws_builder_id' : provider.id] > 0 && (
                    <span className="text-xs text-slate-400 font-medium tabular-nums">
                      {providerCounts[provider.id === 'aws' ? 'aws_builder_id' : provider.id]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="h-px bg-white/5 mx-4" />

          {/* Status Section */}
          <div className="p-3">
            <h3 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2 px-2">
              {t('accounts.statusHeader')}
            </h3>
            <div className="space-y-0.5">
              {[
                { id: 'all', label: t('filters.anyStatus'), dot: null, color: null },
                {
                  id: 'active',
                  label: getAccountStatusLabel('active'),
                  dot: ACCOUNT_STATUS_COLORS.active.bg,
                  color: ACCOUNT_STATUS_COLORS.active.hex,
                },
                {
                  id: 'banned',
                  label: getAccountStatusLabel('banned'),
                  dot: ACCOUNT_STATUS_COLORS.banned.bg,
                  color: ACCOUNT_STATUS_COLORS.banned.hex,
                },
                {
                  id: 'limit_hit',
                  label: getAccountStatusLabel('limit_hit'),
                  dot: ACCOUNT_STATUS_COLORS.expired.bg,
                  color: ACCOUNT_STATUS_COLORS.expired.hex,
                },
                {
                  id: 'expired',
                  label: getAccountStatusLabel('expired'),
                  dot: ACCOUNT_STATUS_COLORS.expired.bg,
                  color: ACCOUNT_STATUS_COLORS.expired.hex,
                },
                {
                  id: 'unknown',
                  label: getAccountStatusLabel('unknown'),
                  dot: null,
                  color: null,
                },
              ].map(status => (
                <button
                  key={status.id}
                  onClick={() => handleStatusFilterChange(status.id)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors duration-150 relative',
                    statusFilter === status.id
                      ? 'bg-indigo-500/15 text-white'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  )}
                >
                  {statusFilter === status.id && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-indigo-500 rounded-r shadow-[0_0_8px_rgba(99,102,241,0.6)]" />
                  )}
                  {status.dot ? (
                    <div
                      className={cn('w-2 h-2 rounded-full shrink-0 ml-2', status.dot)}
                      style={{
                        boxShadow:
                          statusFilter === status.id && status.color
                            ? `0 0 8px ${status.color}99`
                            : 'none',
                      }}
                    />
                  ) : (
                    <div className="w-2 h-2 shrink-0 ml-2" />
                  )}
                  <span className="flex-1 text-left">{status.label}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header Bar */}
          <div className="shrink-0 flex items-center justify-between gap-4 px-6 py-4 border-b border-white/5 bg-[#0a0a0c]/80 backdrop-blur-xl">
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <div className="relative group flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-indigo-400 transition-colors" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => handleSearchQueryChange(e.target.value)}
                  className="w-full h-9 bg-black/40 rounded-lg pl-10 pr-4 text-sm text-white border border-white/10 focus:border-indigo-500/50 focus:bg-black/60 outline-none transition-colors placeholder-slate-400"
                  placeholder={t('accounts.searchPlaceholder')}
                />
              </div>

              <QuotaFilterChip value={quotaFilter as any} onChange={handleQuotaFilterChange} />

              <FilterDropdown
                value={tagFilter}
                onChange={handleTagFilterChange}
                options={tagOptions}
                placeholder={t('accounts.tags')}
                showActiveState={true}
                className="shrink-0"
              />

              <FilterDropdown
                value={relationFilter}
                onChange={handleRelationFilterChange}
                options={relationOptions}
                placeholder={t('accounts.relationFilterLabel')}
                showActiveState={true}
                className="shrink-0"
              />
            </div>

            <div className="flex items-center gap-3">
              <ActionButtonGroup
                actions={[
                  {
                    icon: RefreshCw,
                    label: t('accounts.refreshAll'),
                    onClick: handleRefreshAll,
                    disabled: isBulkRefreshing,
                    loading: isBulkRefreshing,
                  },
                  {
                    icon: Upload,
                    label: t('accounts.importAccounts') || 'Import',
                    onClick: handleImportAccounts,
                    disabled: isImporting,
                    loading: isImporting,
                  },
                  {
                    icon: Download,
                    label: t('accounts.exportCsv'),
                    onClick: handleExportCSV,
                    disabled: filteredAccounts.length === 0,
                  },
                ]}
                className="h-9 px-3 rounded-lg bg-white/5 border border-white/10"
              />

              <div className="w-px h-6 bg-white/10" />

              <Button onClick={() => navigate('/autoreg')} variant="secondary" size="sm">
                AutoReg
              </Button>
              <Button
                onClick={() => setIsModalOpen(true)}
                variant="primary"
                size="sm"
                leftIcon={<Plus size={18} />}
              >
                Add account
              </Button>
            </div>
          </div>

          {/* Mobile quick filters */}
          <div className="md:hidden shrink-0 px-4 py-3 border-b border-white/5 bg-[#0a0a0c]/70 grid grid-cols-2 gap-2">
            <select
              value={providerFilter}
              onChange={e => handleProviderFilterChange(e.target.value)}
              className="h-9 rounded-lg bg-black/40 border border-white/10 px-2 text-xs text-slate-200"
            >
              <option value="all">All providers</option>
              {Object.values(providerCounts).slice(0, 0) /* no-op: keep lint happy */}
              {/* Keep mobile list aligned with sidebar provider filters */}
              {['kiro', 'windsurf', 'trae', 'aws', 'github', 'openai'].map(id => (
                <option key={id} value={id}>
                  {id === 'aws' ? 'AWS Builder ID' : id.charAt(0).toUpperCase() + id.slice(1)}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={e => handleStatusFilterChange(e.target.value)}
              className="h-9 rounded-lg bg-black/40 border border-white/10 px-2 text-xs text-slate-200"
            >
              <option value="all">Any status</option>
              <option value="active">Active</option>
              <option value="banned">Banned</option>
              <option value="expired">Expired</option>
            </select>

            <select
              value={tagFilter}
              onChange={e => handleTagFilterChange(e.target.value)}
              className="h-9 rounded-lg bg-black/40 border border-white/10 px-2 text-xs text-slate-200 col-span-2"
            >
              <option value="all">{t('accounts.mobileTagFilterLabel')}</option>
              {tagOptions
                .filter(option => option.value !== 'all')
                .map(option => (
                  <option key={String(option.value)} value={String(option.value)}>
                    {option.label}
                  </option>
                ))}
            </select>

            <select
              value={relationFilter}
              onChange={e => handleRelationFilterChange(e.target.value)}
              className="h-9 rounded-lg bg-black/40 border border-white/10 px-2 text-xs text-slate-200 col-span-2"
            >
              {relationOptions.map(option => (
                <option key={String(option.value)} value={String(option.value)}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* Expired Warning */}
          {expiredCount > 0 && (
            <div className="shrink-0 mx-6 mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center gap-3">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="text-sm text-amber-300 flex-1">
                {expiredCount} {expiredCount === 1 ? 'account has' : 'accounts have'} expired
              </span>
              <Button
                onClick={handleRefreshExpired}
                disabled={isBulkRefreshing}
                variant="secondary"
                size="xs"
                className="bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border-amber-500/30"
                leftIcon={
                  <RefreshCw size={12} className={isBulkRefreshing ? 'animate-spin' : ''} />
                }
              >
                Refresh expired
              </Button>
            </div>
          )}

          {/* Table */}
          <div className="flex-1 overflow-hidden">
            {loading && filteredAccounts.length === 0 ? (
              <div className="p-6">
                <SkeletonLoader variant="table-row" count={6} />
              </div>
            ) : filteredAccounts.length === 0 ? (
              <EmptyState
                icon={Users}
                title={t('accounts.noAccountsFound')}
                description={
                  searchQuery.trim() ||
                  statusFilter !== 'all' ||
                  quotaFilter !== 'any' ||
                  tagFilter !== 'all' ||
                  relationFilter !== 'all'
                    ? t('accounts.noAccountsFoundDesc')
                    : t('accounts.addFirstAccountToStart')
                }
              />
            ) : (
              <div className="flex flex-col h-full">
                {(selectedIds.size > 0 || tagFilter.startsWith('profile:')) && (
                  <div className="mx-6 mt-4 rounded-xl border border-white/5 bg-[#0f1115]/60 p-4 shadow-[0_0_30px_rgba(79,70,229,0.12)]">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-white">
                          {t('accounts.profileSessionsTitle')}
                        </h3>
                        <p className="text-xs text-slate-400 mt-1">
                          {t('accounts.profileSessionsSubtitle')}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="xs"
                          variant="secondary"
                          disabled={selectedIds.size === 0}
                          onClick={() => handleBatchProfileAction('open')}
                        >
                          {t('accounts.profileSessionOpen')}
                        </Button>
                        <Button
                          size="xs"
                          variant="secondary"
                          disabled={selectedIds.size === 0}
                          onClick={() => handleBatchProfileAction('confirm')}
                        >
                          {t('accounts.profileSessionConfirm')}
                        </Button>
                        <Button
                          size="xs"
                          variant="secondary"
                          disabled={selectedIds.size === 0}
                          onClick={() => handleBatchProfileAction('clear')}
                        >
                          {t('accounts.profileSessionClear')}
                        </Button>
                      </div>
                    </div>
                    {selectedIds.size === 0 && (
                      <p className="mt-3 text-xs text-slate-500">
                        {t('accounts.profileSessionsSelectionHint')}
                      </p>
                    )}
                  </div>
                )}
                <AccountsTable
                  accounts={filteredAccounts}
                  relationHintsById={Object.fromEntries(
                    filteredAccounts.map(acc => [acc.id, extractRelationHints(acc)])
                  )}
                  selectedIds={selectedIds}
                  activeAccountIds={activeAccountIds}
                  onToggleSelection={toggleSelection}
                  onSelectAll={selectAll}
                  onClearSelection={clearSelection}
                  onDelete={handleRemoveAccount}
                  onDeleteSelected={handleRemoveSelectedAccounts}
                  onActivate={setActiveAccount}
                  onCheckStatus={handleCheckStatus}
                  isAccountRefreshing={isAccountRefreshing}
                  onOpenBrowser={handleOpenBrowser}
                  onOpenProfileSession={handleOpenProfileSession}
                  onConfirmProfileSession={handleConfirmProfileSession}
                  onClearProfileSession={handleClearProfileSession}
                  onUpdate={handleUpdateAccount}
                  selectedProvider={providerFilter === 'all' ? null : providerFilter}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <AddAccountModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleAddAccount}
      />
      {selectedIds.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 px-6 pb-6 pointer-events-none">
          <div className="max-w-2xl mx-auto pointer-events-auto">
            <FloatingActionBar
              selectedCount={selectedIds.size}
              onExport={handleExportCSV}
              onDelete={() => handleRemoveSelectedAccounts()}
              onClear={clearSelection}
              onRefreshAll={handleRefreshAll}
              isRefreshing={isBulkRefreshing}
              refreshProgress={bulkProgress}
            />
          </div>
        </div>
      )}
    </div>
  );
}
