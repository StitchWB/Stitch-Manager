import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Users, AlertCircle, Share2, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { listen } from '@tauri-apps/api/event';
import { convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import Header from '../components/layout/Header';
import AccountsTable from '../components/AccountsTable';
import ProfilesTable from '../components/ProfilesTable';
import type { ProfileItem } from '../components/ProfilesTable';
import AddAccountModal from '../components/AddAccountModal';
import { ProfileSettingsModal } from '../components/profiles/ProfileSettingsModal';
import { FloatingActionBar } from '../components/ui/FloatingActionBar';
import { EmptyState, SkeletonLoader, Button } from '../components/ui';
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
  getOrCreateFingerprintProfile,
  saveFingerprintProfile,
  listFingerprintProfiles,
  deleteFingerprintProfile,
  openStandaloneFingerprintProfileAndRememberUrl,
} from '@/lib/tauri';
import { t } from '../lib/i18n';
import { useBulkRefresh } from '../hooks/useBulkRefresh';
import { useUrlState } from '../hooks/useUrlState';
import type { AccountStatus } from '../types';
import type { FilterOption } from '../components/ui/FilterDropdown';
import { AccountsTabContent } from '../components/accounts/AccountsTabContent';
import { ServiceAccountsPanel } from '../components/accounts/ServiceAccountsPanel';
import { DolphinProfilesPanel } from '../components/accounts/DolphinProfilesPanel';
import { IdentityGraphPanel } from '../components/accounts/IdentityGraphPanel';
import { SheetsExplorerPanel } from '../components/accounts/SheetsExplorerPanel';
import { AccountsToolbar } from '../components/accounts/AccountsToolbar';
import { AccountsFiltersRail } from '../components/accounts/AccountsFiltersRail';
import { ProfileSessionsPanel } from '../components/accounts/ProfileSessionsPanel';
import { SheetsConfigPanel } from '../components/accounts/SheetsConfigPanel';
import type { AccountsVisibleColumns } from '../components/accounts/AccountsColumnsMenu';
import { useGoogleSheetsDataset } from '../hooks/useGoogleSheetsDataset';
import { useRegistrationStore } from '../stores/registration';
import {
  extractRelationHints,
  extractRelationEdges,
  hasAnyRelations,
  hasExplicitRelationLinks,
  isOAuthCapableIdentity,
} from '../lib/accounts/relations';
import {
  normalizeJsonAccounts,
  parseCsvAccounts,
  type ParsedAccountsResult,
  readBlobText,
  validateImportRecords,
} from '../lib/accounts/importParser';

export default function Accounts() {
  const navigate = useNavigate();
  const {
    accounts: storeAccounts,
    loading,
    error: accountsError,
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
    setAccountsEntityFilter,
    setAccountsVisibleColumns,
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
  const [entityFilter, setEntityFilter] = useUrlState(
    'entity',
    accountsPage.entityFilter || 'accounts'
  );
  const [viewMode, setViewMode] = useUrlState<'list' | 'graph' | 'sheets'>('view', 'list');
  const [visibleColumns, setVisibleColumns] = useState<AccountsVisibleColumns>(
    accountsPage.tableVisibleColumns ?? {
      lastLogin: true,
      proxy: true,
      tags: true,
    }
  );
  const [profileAliases, setProfileAliases] = useState<string[]>([]);
  const [profileSettingsAlias, setProfileSettingsAlias] = useState<string | null>(null);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profileListFilter, setProfileListFilter] = useState<
    'all' | 'standalone' | 'linked' | 'used_kiro'
  >('all');
  const registrationConfig = useRegistrationStore(state => state.config);
  const setAdvancedSettings = useRegistrationStore(state => state.setAdvancedSettings);
  const saveRegistrationSettings = useRegistrationStore(state => state.saveImmediately);

  const [sheetsSpreadsheetId, setSheetsSpreadsheetId] = useState(
    registrationConfig.advanced.googleSheetsSpreadsheetId || ''
  );
  const [sheetsServiceAccountJson, setSheetsServiceAccountJson] = useState(
    registrationConfig.advanced.googleSheetsServiceAccountJson || ''
  );
  const [sheetsTestStatus, setSheetsTestStatus] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle');
  const [sheetsTestMessage, setSheetsTestMessage] = useState<string | null>(null);
  const [sheetsTouched, setSheetsTouched] = useState(false);
  const [showSheetsConfig, setShowSheetsConfig] = useState(false);

  // Persist Google Sheets settings back to DB (plaintext; encryption deferred)
  useEffect(() => {
    if (!sheetsTouched) return;
    const timer = setTimeout(() => {
      setAdvancedSettings({
        googleSheetsSpreadsheetId: sheetsSpreadsheetId,
        googleSheetsServiceAccountJson: sheetsServiceAccountJson,
      });
      void saveRegistrationSettings();
    }, 500);
    return () => clearTimeout(timer);
  }, [
    sheetsTouched,
    sheetsSpreadsheetId,
    sheetsServiceAccountJson,
    saveRegistrationSettings,
    setAdvancedSettings,
  ]);

  // NOTE: showSheetsConfig auto-open effect is defined after resolvedViewMode/sheetsParams.

  const loadProfiles = useCallback(async () => {
    setProfilesLoading(true);
    try {
      const aliases = await listFingerprintProfiles();
      setProfileAliases(aliases);
    } catch (error) {
      console.error('[Accounts] Failed to list fingerprint profiles:', error);
    } finally {
      setProfilesLoading(false);
    }
  }, []);

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

  const parseTags = useCallback((tagsString: string | null): string[] => {
    if (!tagsString) return [];
    try {
      const parsed = JSON.parse(tagsString);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, []);

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
  }, [parseTags, storeAccounts]);

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

    const dynamicEdgeCounts = new Map<string, { label: string; count: number }>();
    storeAccounts.forEach(account => {
      const edges = extractRelationEdges(account);
      edges.forEach(edge => {
        const key = `edge:${edge.type}:${edge.targetProvider}`;
        const existing = dynamicEdgeCounts.get(key);
        dynamicEdgeCounts.set(key, {
          label: edge.label,
          count: (existing?.count ?? 0) + 1,
        });
      });
    });

    const dynamicOptions = Array.from(dynamicEdgeCounts.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 8)
      .map(([value, payload]) => ({ value, label: payload.label, count: payload.count }));

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
      ...dynamicOptions,
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

  const handleEntityFilterChange = useCallback(
    (value: string) => {
      setEntityFilter(value);
      setAccountsEntityFilter(value);
      if (value === 'profiles') {
        clearSelection();
      }
    },
    [setEntityFilter, setAccountsEntityFilter, clearSelection]
  );

  const handleViewModeChange = useCallback(
    (value: string) => {
      const normalized = value === 'graph' || value === 'sheets' ? value : 'list';
      setViewMode(normalized);
    },
    [setViewMode]
  );

  const normalizedEntityFilter = useMemo(() => {
    if (entityFilter === 'profiles') return 'profiles';
    return 'accounts';
  }, [entityFilter]);

  const showAccountsModes = true;
  const resolvedViewMode = viewMode === 'graph' || viewMode === 'sheets' ? viewMode : 'list';

  const sheetsParams = useMemo(() => {
    if (!sheetsSpreadsheetId.trim() || !sheetsServiceAccountJson.trim()) return null;
    return {
      spreadsheetId: sheetsSpreadsheetId.trim(),
      serviceAccountJson: sheetsServiceAccountJson.trim(),
    };
  }, [sheetsSpreadsheetId, sheetsServiceAccountJson]);

  // If user switches to Graph/Sheets without config, open config panel.
  useEffect(() => {
    if (resolvedViewMode === 'list') return;
    if (!sheetsParams) {
      setShowSheetsConfig(true);
    }
  }, [resolvedViewMode, sheetsParams]);

  const {
    dataset: sheetsDataset,
    isLoading: sheetsLoading,
    error: sheetsError,
    lastUpdatedAt: sheetsUpdatedAt,
    refresh: refreshSheetsDataset,
    testConnection: testSheetsConnection,
  } = useGoogleSheetsDataset({
    autoFetch: resolvedViewMode === 'graph' || resolvedViewMode === 'sheets',
    params: sheetsParams,
  });

  const handleTestSheets = useCallback(async () => {
    setSheetsTouched(true);
    setSheetsTestStatus('loading');
    setSheetsTestMessage(null);
    const ok = await testSheetsConnection();
    setSheetsTestStatus(ok ? 'success' : 'error');
    setSheetsTestMessage(ok ? 'Connection ok' : 'Connection failed');
  }, [testSheetsConnection]);

  const handleRefreshSheets = useCallback(async () => {
    setSheetsTouched(true);
    await refreshSheetsDataset();
  }, [refreshSheetsDataset]);

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

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

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
      } else if (relationFilter.startsWith('edge:')) {
        const [, edgeType, targetProvider] = relationFilter.split(':');
        if (edgeType && targetProvider) {
          filtered = filtered.filter(a => {
            const edges = extractRelationEdges(a);
            return edges.some(
              edge => edge.type === edgeType && edge.targetProvider === targetProvider
            );
          });
        }
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
    parseTags,
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

  const handleOpenProfileSession = useCallback(
    async (_id: number) => {
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
    },
    [fetchAccounts]
  );

  const handleConfirmProfileSession = useCallback(
    async (_id: number) => {
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
    },
    [fetchAccounts]
  );

  const handleClearProfileSession = useCallback(
    async (_id: number) => {
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
              return readBlobText(blob);
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
    [handleClearProfileSession, handleConfirmProfileSession, handleOpenProfileSession, selectedIds]
  );

  const handleCreateStandaloneProfile = useCallback(async () => {
    try {
      const profile = await getOrCreateFingerprintProfile({ email: null });
      const alias = `standalone_profile_${Date.now()}@local.profile`;
      await saveFingerprintProfile({ email: alias, profile });
      toast.success(`${t('accounts.profileCreateSuccess')}: ${alias}`);
      await loadProfiles();
      handleEntityFilterChange('profiles');
    } catch (error) {
      console.error('[Accounts] Failed to create standalone profile:', error);
      toast.error(
        `${t('accounts.profileCreateFailed')}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }, [loadProfiles, handleEntityFilterChange]);

  const profileItems = useMemo<ProfileItem[]>(() => {
    const linkedByAlias = new Map(
      storeAccounts
        .filter(acc => !!acc.browserProfilePath)
        .map(acc => [acc.email.toLowerCase(), acc] as const)
    );

    return profileAliases.map(alias => {
      const linkedAccount = linkedByAlias.get(alias.toLowerCase()) ?? null;
      const hasProviderLink = Boolean(linkedAccount && linkedAccount.provider);
      const hasSessionPath = Boolean(linkedAccount?.browserProfilePath);

      const healthStatus: 'ready' | 'needs_link' | 'no_session_path' = !hasProviderLink
        ? 'needs_link'
        : hasSessionPath
          ? 'ready'
          : 'no_session_path';

      const usedTargets = Array.from(
        new Set(
          storeAccounts.flatMap(acc => {
            if (!acc.tags) return [] as string[];
            try {
              const parsed = JSON.parse(acc.tags);
              if (!Array.isArray(parsed)) return [] as string[];
              const launchedFromAlias = parsed.includes(`launch-profile:${alias}`);
              if (!launchedFromAlias) return [] as string[];
              return parsed
                .filter((tag: string) => tag.startsWith('registered-for:'))
                .map((tag: string) => tag.replace('registered-for:', ''));
            } catch {
              return [] as string[];
            }
          })
        )
      );

      return {
        alias,
        linkedAccountEmail: linkedAccount?.email ?? null,
        linkedProvider: linkedAccount?.provider ?? null,
        linkedAccountId: linkedAccount?.id ?? null,
        usedForKiro: storeAccounts.some(
          acc =>
            acc.provider === 'kiro' &&
            (() => {
              if (!acc.tags) return false;
              try {
                const parsed = JSON.parse(acc.tags);
                return (
                  Array.isArray(parsed) &&
                  parsed.some(
                    tag => tag === `launch-profile:${alias}` || tag === 'registered-for:kiro'
                  )
                );
              } catch {
                return false;
              }
            })()
        ),
        usedTargets,
        healthStatus,
      };
    });
  }, [profileAliases, storeAccounts]);

  const visibleProfileItems = useMemo(() => {
    let items = [...profileItems];
    const q = searchQuery.trim().toLowerCase();

    if (q) {
      items = items.filter(item => item.alias.toLowerCase().includes(q));
    }

    if (profileListFilter === 'standalone') {
      items = items.filter(item => !item.linkedAccountEmail);
    } else if (profileListFilter === 'linked') {
      items = items.filter(item => !!item.linkedAccountEmail);
    } else if (profileListFilter === 'used_kiro') {
      items = items.filter(item => item.usedForKiro);
    }

    return items;
  }, [profileItems, searchQuery, profileListFilter]);

  const handleDeleteProfile = useCallback(
    async (alias: string) => {
      if (!window.confirm(t('accounts.deleteProfileConfirm', { alias }))) return;
      try {
        await deleteFingerprintProfile({ email: alias });
        toast.success(t('accounts.profileDeleteSuccess'));
        await loadProfiles();
      } catch (error) {
        console.error('[Accounts] Failed to delete profile:', error);
        toast.error(t('accounts.profileDeleteFailed'));
      }
    },
    [loadProfiles]
  );

  const handleOpenStandaloneProfile = useCallback(
    async (alias: string, target: string, customUrl?: string) => {
      const isCustom = target === 'custom';
      const provider = isCustom ? 'kiro' : target;
      const url = isCustom ? customUrl?.trim() : undefined;

      if (isCustom && !url) {
        toast.error(t('accounts.profileOpenFailed'));
        return;
      }

      try {
        await openStandaloneFingerprintProfileAndRememberUrl({ alias, provider, url });
        toast.success(t('accounts.profileOpenSuccess'));
      } catch (error) {
        console.error('[Accounts] Failed to open standalone profile:', error);
        toast.error(
          `${t('accounts.profileOpenFailed')}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },
    []
  );

  const handleCreateProfilesForSelected = useCallback(async () => {
    const selectedAccounts = filteredAccounts.filter(acc => selectedIds.has(acc.id));
    if (!selectedAccounts.length) return;
    const settled = await Promise.allSettled(
      selectedAccounts.map(async acc => {
        const profile = await getOrCreateFingerprintProfile({ email: acc.email });
        await saveFingerprintProfile({ email: acc.email, profile });
      })
    );
    const success = settled.filter(s => s.status === 'fulfilled').length;
    const failed = settled.length - success;
    if (failed === 0) toast.success(t('accounts.profileCreateSuccess'));
    else if (success > 0)
      toast.warning(
        `${t('accounts.profileCreateSuccess')} (${success}), ${t('accounts.profileCreateFailed')} (${failed})`
      );
    else toast.error(t('accounts.profileCreateFailed'));
    await loadProfiles();
  }, [filteredAccounts, selectedIds, loadProfiles]);

  const handleSheetsSpreadsheetIdChange = useCallback((value: string) => {
    setSheetsTouched(true);
    setSheetsSpreadsheetId(value);
    setSheetsTestStatus('idle');
    setSheetsTestMessage(null);
  }, []);

  const handleSheetsServiceAccountJsonChange = useCallback((value: string) => {
    setSheetsTouched(true);
    setSheetsServiceAccountJson(value);
    setSheetsTestStatus('idle');
    setSheetsTestMessage(null);
  }, []);

  const handleToggleVisibleColumn = useCallback(
    (column: keyof AccountsVisibleColumns, value: boolean) => {
      setVisibleColumns(current => {
        const next = { ...current, [column]: value };
        setAccountsVisibleColumns(next);
        return next;
      });
    },
    [setAccountsVisibleColumns]
  );

  const handleResetVisibleColumns = useCallback(() => {
    const next: AccountsVisibleColumns = {
      lastLogin: true,
      proxy: true,
      tags: true,
    };
    setVisibleColumns(next);
    setAccountsVisibleColumns(next);
  }, [setAccountsVisibleColumns]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0a0a0c] font-sans">
      <Header title={t('accounts.title')} icon={<Users size={18} />} />

      <div className="flex-1 flex overflow-hidden">
        <AccountsFiltersRail
          entityFilter={entityFilter}
          providerFilter={providerFilter}
          statusFilter={statusFilter}
          accountsCount={storeAccounts.length}
          profilesCount={profileAliases.length}
          providerCounts={providerCounts}
          onEntityFilterChange={handleEntityFilterChange}
          onProviderFilterChange={handleProviderFilterChange}
          onStatusFilterChange={handleStatusFilterChange}
        />

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <AccountsToolbar
            resolvedViewMode={resolvedViewMode}
            showAccountsModes={showAccountsModes}
            normalizedEntityFilter={normalizedEntityFilter}
            accountsCount={storeAccounts.length}
            profilesCount={profileAliases.length}
            searchQuery={searchQuery}
            statusFilter={statusFilter}
            tagFilter={tagFilter}
            relationFilter={relationFilter}
            quotaFilter={quotaFilter}
            tagOptions={tagOptions}
            relationOptions={relationOptions}
            sheetsUpdatedAt={sheetsUpdatedAt ?? null}
            isBulkRefreshing={isBulkRefreshing}
            isImporting={isImporting}
            filteredAccountsCount={filteredAccounts.length}
            sheetsTestStatus={sheetsTestStatus}
            sheetsLoading={sheetsLoading}
            hasSheetsParams={Boolean(sheetsParams)}
            showSheetsConfig={showSheetsConfig}
            visibleColumns={visibleColumns}
            onEntityFilterChange={value => handleEntityFilterChange(value)}
            onViewModeChange={handleViewModeChange}
            onSearchQueryChange={handleSearchQueryChange}
            onStatusFilterChange={handleStatusFilterChange}
            onTagFilterChange={handleTagFilterChange}
            onRelationFilterChange={handleRelationFilterChange}
            onQuotaFilterChange={handleQuotaFilterChange}
            onRefreshAll={handleRefreshAll}
            onImportAccounts={handleImportAccounts}
            onExportCSV={handleExportCSV}
            onTestSheets={handleTestSheets}
            onRefreshSheets={handleRefreshSheets}
            onToggleSheetsConfig={() => setShowSheetsConfig(current => !current)}
            onOpenAutoReg={() => navigate('/autoreg')}
            onCreateStandaloneProfile={handleCreateStandaloneProfile}
            onAddAccount={() => setIsModalOpen(true)}
            onToggleVisibleColumn={handleToggleVisibleColumn}
            onResetVisibleColumns={handleResetVisibleColumns}
          />

          {resolvedViewMode !== 'list' && showSheetsConfig && (
            <SheetsConfigPanel
              spreadsheetId={sheetsSpreadsheetId}
              serviceAccountJson={sheetsServiceAccountJson}
              testStatus={sheetsTestStatus}
              testMessage={sheetsTestMessage}
              onSpreadsheetIdChange={handleSheetsSpreadsheetIdChange}
              onServiceAccountJsonChange={handleSheetsServiceAccountJsonChange}
            />
          )}

          {resolvedViewMode === 'list' && entityFilter !== 'profiles' && accountsError ? (
            <div className="shrink-0 mx-6 mt-4 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {t('accounts.loadAccountsErrorPrefix')}: {accountsError}
            </div>
          ) : null}

          {/* Expired Warning */}
          {resolvedViewMode === 'list' && expiredCount > 0 && (
            <div className="shrink-0 mx-6 mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center gap-3">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="text-sm text-amber-300 flex-1">
                {t('accounts.expiredCountLabel')}: {expiredCount}
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
                {t('accounts.refreshAllExpired')}
              </Button>
            </div>
          )}

          {/* Table */}
          <div className="flex-1 overflow-hidden">
            <AccountsTabContent>
              {resolvedViewMode === 'graph' ? (
                <ServiceAccountsPanel
                  header={
                    <div className="px-6 py-3 border-b border-white/5 bg-[#0a0a0c]/60 flex items-center justify-between text-xs text-slate-400">
                      <div className="flex items-center gap-2">
                        <Share2 className="w-4 h-4 text-indigo-400" />
                        <span className="font-semibold text-white">
                          {t('accounts.relationGraphTitle')}
                        </span>
                      </div>
                      {sheetsUpdatedAt && (
                        <span className="text-[11px] text-slate-500">
                          {t('logs.lastUpdated')} {new Date(sheetsUpdatedAt).toLocaleString()}
                        </span>
                      )}
                    </div>
                  }
                  body={
                    <IdentityGraphPanel
                      dataset={sheetsDataset}
                      isLoading={sheetsLoading}
                      error={sheetsError}
                      onRetry={handleRefreshSheets}
                      localProfiles={profileAliases}
                    />
                  }
                />
              ) : resolvedViewMode === 'sheets' ? (
                <ServiceAccountsPanel
                  header={
                    <div className="px-6 py-3 border-b border-white/5 bg-[#0a0a0c]/60 flex items-center justify-between text-xs text-slate-400">
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                        <span className="font-semibold text-white">
                          {t('accounts.sheetsExplorerTitle')}
                        </span>
                      </div>
                      {sheetsUpdatedAt && (
                        <span className="text-[11px] text-slate-500">
                          {t('logs.lastUpdated')} {new Date(sheetsUpdatedAt).toLocaleString()}
                        </span>
                      )}
                    </div>
                  }
                  body={
                    <SheetsExplorerPanel
                      dataset={sheetsDataset}
                      isLoading={sheetsLoading}
                      error={sheetsError}
                      onRetry={handleRefreshSheets}
                      onNavigateToGraph={target => {
                        console.log('[Accounts] Navigate to graph target:', target);
                        handleViewModeChange('graph');
                      }}
                    />
                  }
                />
              ) : entityFilter === 'profiles' ? (
                <DolphinProfilesPanel
                  body={
                    profilesLoading ? (
                      <div className="p-6">
                        <SkeletonLoader variant="table-row" count={6} />
                      </div>
                    ) : (
                      <ProfilesTable
                        profiles={visibleProfileItems}
                        onEdit={alias => setProfileSettingsAlias(alias)}
                        onOpen={handleOpenStandaloneProfile}
                        onStartAutoreg={(alias, targetProvider, preset, awsBootstrapAccountId) => {
                          const query = new URLSearchParams({
                            source: 'profile',
                            profile: alias,
                            target: targetProvider,
                          });
                          if (preset) query.set('preset', preset);
                          if (typeof awsBootstrapAccountId === 'number') {
                            query.set('awsBootstrapAccountId', String(awsBootstrapAccountId));
                          }
                          navigate(`/autoreg?${query.toString()}`);
                        }}
                        onDelete={handleDeleteProfile}
                        profileFilter={profileListFilter}
                        onProfileFilterChange={setProfileListFilter}
                      />
                    )
                  }
                />
              ) : entityFilter === 'all' ? (
                <div className="flex flex-col h-full overflow-auto">
                  <div className="px-6 pt-4 pb-2 text-xs uppercase tracking-widest text-slate-500">
                    {t('accounts.entityAccounts')}
                  </div>
                  <div className="flex flex-col h-[55%] min-h-[260px]">
                    {(selectedIds.size > 0 || tagFilter.startsWith('profile:')) && (
                      <ProfileSessionsPanel
                        selectedCount={selectedIds.size}
                        className="mx-6 mt-2 rounded-xl border border-white/5 bg-[#0f1115]/60 p-4"
                        onCreateProfiles={handleCreateProfilesForSelected}
                        onOpen={() => handleBatchProfileAction('open')}
                        onConfirm={() => handleBatchProfileAction('confirm')}
                        onClear={() => handleBatchProfileAction('clear')}
                      />
                    )}
                    <AccountsTable
                      accounts={filteredAccounts}
                      isLoading={loading}
                      visibleColumns={visibleColumns}
                      relationEdgesById={Object.fromEntries(
                        filteredAccounts.map(acc => [acc.id, extractRelationEdges(acc)])
                      )}
                      relationHintsById={Object.fromEntries(
                        filteredAccounts.map(acc => [acc.id, extractRelationHints(acc)])
                      )}
                      onRelationEdgeClick={(edgeType, targetProvider) => {
                        handleRelationFilterChange(`edge:${edgeType}:${targetProvider}`);
                        handleEntityFilterChange('accounts');
                      }}
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

                  <div className="px-6 pt-4 pb-2 text-xs uppercase tracking-widest text-slate-500 border-t border-white/5">
                    {t('accounts.entityProfiles')}
                  </div>
                  <div className="flex flex-col h-[45%] min-h-[220px] pb-4">
                    {profilesLoading ? (
                      <div className="p-6">
                        <SkeletonLoader variant="table-row" count={4} />
                      </div>
                    ) : (
                      <ProfilesTable
                        profiles={visibleProfileItems}
                        onEdit={alias => setProfileSettingsAlias(alias)}
                        onOpen={handleOpenStandaloneProfile}
                        onStartAutoreg={(alias, targetProvider, preset, awsBootstrapAccountId) => {
                          const query = new URLSearchParams({
                            source: 'profile',
                            profile: alias,
                            target: targetProvider,
                          });
                          if (preset) query.set('preset', preset);
                          if (typeof awsBootstrapAccountId === 'number') {
                            query.set('awsBootstrapAccountId', String(awsBootstrapAccountId));
                          }
                          navigate(`/autoreg?${query.toString()}`);
                        }}
                        onDelete={handleDeleteProfile}
                        profileFilter={profileListFilter}
                        onProfileFilterChange={setProfileListFilter}
                      />
                    )}
                  </div>
                </div>
              ) : (
                <ServiceAccountsPanel
                  body={
                    (entityFilter === 'accounts' || entityFilter === 'all') &&
                    loading &&
                    filteredAccounts.length === 0 ? (
                      <div className="p-6">
                        <SkeletonLoader variant="table-row" count={6} />
                      </div>
                    ) : (entityFilter === 'accounts' || entityFilter === 'all') &&
                      filteredAccounts.length === 0 ? (
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
                          <ProfileSessionsPanel
                            selectedCount={selectedIds.size}
                            showHintWhenEmpty
                            className="mx-6 mt-4 rounded-xl border border-white/5 bg-[#0f1115]/60 p-4"
                            onCreateProfiles={handleCreateProfilesForSelected}
                            onOpen={() => handleBatchProfileAction('open')}
                            onConfirm={() => handleBatchProfileAction('confirm')}
                            onClear={() => handleBatchProfileAction('clear')}
                          />
                        )}

                        <AccountsTable
                          accounts={filteredAccounts}
                          isLoading={loading}
                          visibleColumns={visibleColumns}
                          relationEdgesById={Object.fromEntries(
                            filteredAccounts.map(acc => [acc.id, extractRelationEdges(acc)])
                          )}
                          relationHintsById={Object.fromEntries(
                            filteredAccounts.map(acc => [acc.id, extractRelationHints(acc)])
                          )}
                          onRelationEdgeClick={(edgeType, targetProvider) => {
                            handleRelationFilterChange(`edge:${edgeType}:${targetProvider}`);
                          }}
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
                    )
                  }
                />
              )}
            </AccountsTabContent>
          </div>
        </div>
      </div>

      <AddAccountModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleAddAccount}
      />

      <ProfileSettingsModal
        alias={profileSettingsAlias}
        isOpen={Boolean(profileSettingsAlias)}
        onClose={() => setProfileSettingsAlias(null)}
        onSaved={() => {
          void loadProfiles();
        }}
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
