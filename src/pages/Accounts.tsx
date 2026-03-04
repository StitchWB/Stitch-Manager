import { useEffect, useState, useCallback, useMemo, type ChangeEvent } from 'react';
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
  List,
  Share2,
  FileSpreadsheet,
} from 'lucide-react';
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
import {
  EmptyState,
  SkeletonLoader,
  ActionButtonGroup,
  Button,
  SegmentedControl,
  FormField,
  Input,
  Select,
  Tooltip,
} from '../components/ui';
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
import { ProviderLogo } from '../components/ui/ProviderLogo';
import { cn } from '../lib/utils';
import { ACCOUNT_STATUS_COLORS } from '../constants/colors';
import { getAccountStatusLabel } from '../lib/accountStatus';
import { FilterDropdown, type FilterOption } from '../components/ui/FilterDropdown';
import { AccountsEntityTabs } from '../components/accounts/AccountsEntityTabs';
import { AccountsTabContent } from '../components/accounts/AccountsTabContent';
import { ServiceAccountsPanel } from '../components/accounts/ServiceAccountsPanel';
import { DolphinProfilesPanel } from '../components/accounts/DolphinProfilesPanel';
import { IdentityGraphPanel } from '../components/accounts/IdentityGraphPanel';
import { SheetsExplorerPanel } from '../components/accounts/SheetsExplorerPanel';
import { useGoogleSheetsDataset } from '../hooks/useGoogleSheetsDataset';
import { useRegistrationStore } from '../stores/registration';
import {
  extractRelationHints,
  extractRelationEdges,
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

  const entityOptions = useMemo((): FilterOption<string>[] => {
    return [
      { value: 'accounts', label: t('accounts.entityAccounts'), count: storeAccounts.length },
      { value: 'profiles', label: t('accounts.entityProfiles'), count: profileAliases.length },
      {
        value: 'all',
        label: t('accounts.entityAll'),
        count: storeAccounts.length + profileAliases.length,
      },
    ];
  }, [storeAccounts.length, profileAliases.length]);

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

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0a0a0c] font-sans">
      <Header title={t('accounts.title')} icon={<Users size={18} />} />

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar Filter Panel */}
        <aside className="hidden lg:flex w-16 shrink-0 bg-[#0f1218]/50 border-r border-white/5 backdrop-blur-md flex-col items-center py-3 gap-3">
          <div className="flex flex-col items-center gap-1.5">
            <Tooltip content={`${t('accounts.entityAll')} · ${storeAccounts.length}`} side="right">
              <button
                type="button"
                onClick={() => handleEntityFilterChange('all')}
                className={cn(
                  'relative h-9 w-9 rounded-r-lg rounded-l-none border border-l-0 transition-colors flex items-center justify-center',
                  entityFilter === 'all'
                    ? 'border-cyan-400/30 bg-cyan-500/[0.05] text-cyan-100'
                    : 'border-white/10 bg-white/[0.02] text-slate-400 hover:text-white hover:bg-white/8'
                )}
              >
                <span
                  className={cn(
                    'absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full',
                    entityFilter === 'all' ? 'bg-cyan-400/80' : 'bg-transparent'
                  )}
                />
                <LayoutGrid size={15} />
              </button>
            </Tooltip>

            <Tooltip
              content={`${t('accounts.entityAccounts')} · ${storeAccounts.length}`}
              side="right"
            >
              <button
                type="button"
                onClick={() => handleEntityFilterChange('accounts')}
                className={cn(
                  'relative h-9 w-9 rounded-r-lg rounded-l-none border border-l-0 transition-colors flex items-center justify-center',
                  entityFilter === 'accounts'
                    ? 'border-cyan-400/30 bg-cyan-500/[0.05] text-cyan-100'
                    : 'border-white/10 bg-white/[0.02] text-slate-400 hover:text-white hover:bg-white/8'
                )}
              >
                <span
                  className={cn(
                    'absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full',
                    entityFilter === 'accounts' ? 'bg-cyan-400/80' : 'bg-transparent'
                  )}
                />
                <Users size={15} />
              </button>
            </Tooltip>

            <Tooltip
              content={`${t('accounts.entityBrowserProfiles')} · ${profileAliases.length}`}
              side="right"
            >
              <button
                type="button"
                onClick={() => handleEntityFilterChange('profiles')}
                className={cn(
                  'relative h-9 w-9 rounded-r-lg rounded-l-none border border-l-0 transition-colors flex items-center justify-center',
                  entityFilter === 'profiles'
                    ? 'border-cyan-400/30 bg-cyan-500/[0.05] text-cyan-100'
                    : 'border-white/10 bg-white/[0.02] text-slate-400 hover:text-white hover:bg-white/8'
                )}
              >
                <span
                  className={cn(
                    'absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full',
                    entityFilter === 'profiles' ? 'bg-cyan-400/80' : 'bg-transparent'
                  )}
                />
                <LayoutGrid size={15} />
                {profileAliases.length > 0 ? (
                  <span className="absolute -right-1.5 -top-1.5 rounded-full border border-white/10 bg-[#141822] px-1 text-[9px] text-slate-300">
                    {profileAliases.length}
                  </span>
                ) : null}
              </button>
            </Tooltip>
          </div>

          <div className="h-px w-8 bg-white/10" />

          <div className="flex flex-col items-center gap-1.5">
            <Tooltip content={`Все провайдеры · ${providerCounts.all ?? 0}`} side="right">
              <button
                type="button"
                onClick={() => handleProviderFilterChange('all')}
                className={cn(
                  'relative h-9 w-9 rounded-r-lg rounded-l-none border border-l-0 transition-colors flex items-center justify-center',
                  providerFilter === 'all'
                    ? 'border-indigo-400/35 bg-indigo-500/[0.05] text-indigo-100'
                    : 'border-white/10 bg-white/[0.02] text-slate-400 hover:text-white hover:bg-white/8'
                )}
              >
                <span
                  className={cn(
                    'absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full',
                    providerFilter === 'all' ? 'bg-indigo-400/80' : 'bg-transparent'
                  )}
                />
                <LayoutGrid size={15} />
              </button>
            </Tooltip>

            {[
              { id: 'kiro', label: 'Kiro' },
              { id: 'windsurf', label: 'Windsurf' },
              { id: 'trae', label: 'Trae' },
              { id: 'aws', label: 'AWS Builder ID' },
              { id: 'github', label: 'GitHub' },
            ].map(provider => {
              const countKey = provider.id === 'aws' ? 'aws_builder_id' : provider.id;
              const count = providerCounts[countKey] ?? 0;
              return (
                <Tooltip key={provider.id} content={`${provider.label} · ${count}`} side="right">
                  <button
                    type="button"
                    onClick={() => handleProviderFilterChange(provider.id)}
                    className={cn(
                      'relative h-9 w-9 rounded-r-lg rounded-l-none border border-l-0 transition-colors flex items-center justify-center',
                      providerFilter === provider.id
                        ? 'border-indigo-400/35 bg-indigo-500/[0.05] text-indigo-100'
                        : 'border-white/10 bg-white/[0.02] text-slate-400 hover:text-white hover:bg-white/8'
                    )}
                  >
                    <span
                      className={cn(
                        'absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full',
                        providerFilter === provider.id ? 'bg-indigo-400/80' : 'bg-transparent'
                      )}
                    />
                    <ProviderLogo
                      provider={provider.id}
                      size={14}
                      colored={providerFilter === provider.id}
                    />
                  </button>
                </Tooltip>
              );
            })}
          </div>

          <div className="h-px w-8 bg-white/10" />

          <div className="flex flex-col items-center gap-1.5">
            {[
              { id: 'all', label: t('filters.anyStatus'), dot: 'bg-slate-500' },
              {
                id: 'active',
                label: getAccountStatusLabel('active'),
                dot: ACCOUNT_STATUS_COLORS.active.bg,
              },
              {
                id: 'banned',
                label: getAccountStatusLabel('banned'),
                dot: ACCOUNT_STATUS_COLORS.banned.bg,
              },
              {
                id: 'limit_hit',
                label: getAccountStatusLabel('limit_hit'),
                dot: ACCOUNT_STATUS_COLORS.expired.bg,
              },
              {
                id: 'expired',
                label: getAccountStatusLabel('expired'),
                dot: ACCOUNT_STATUS_COLORS.expired.bg,
              },
              { id: 'unknown', label: getAccountStatusLabel('unknown'), dot: 'bg-slate-500' },
            ].map(status => (
              <Tooltip key={status.id} content={status.label} side="right">
                <button
                  type="button"
                  onClick={() => handleStatusFilterChange(status.id)}
                  className={cn(
                    'relative h-9 w-9 rounded-r-lg border border-l-0 transition-colors flex items-center justify-center',
                    statusFilter === status.id
                      ? 'border-indigo-400/30 bg-indigo-500/[0.08] text-indigo-100'
                      : 'border-white/10 bg-white/[0.02] text-slate-300 hover:bg-white/8'
                  )}
                >
                  <span
                    className={cn(
                      'absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full',
                      statusFilter === status.id ? 'bg-indigo-400/80' : 'bg-transparent'
                    )}
                  />
                  <span className={cn('h-2.5 w-2.5 rounded-full', status.dot)} />
                </button>
              </Tooltip>
            ))}
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header Bar */}
          <div className="shrink-0 px-6 py-4 border-b border-white/5 bg-[#0b0b10]/85 backdrop-blur-xl">
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_auto] gap-4">
              <div className="flex flex-col gap-4 min-w-0">
                <div className="flex flex-wrap items-center gap-3 min-w-0">
                  <AccountsEntityTabs
                    value={normalizedEntityFilter}
                    onChange={value => handleEntityFilterChange(value)}
                    accountsCount={storeAccounts.length}
                    profilesCount={profileAliases.length}
                  />

                  {showAccountsModes && (
                    <SegmentedControl
                      value={resolvedViewMode}
                      onChange={value => handleViewModeChange(value)}
                      options={[
                        { value: 'list', label: t('accounts.viewList'), icon: <List size={14} /> },
                        {
                          value: 'graph',
                          label: t('accounts.viewGraph'),
                          icon: <Share2 size={14} />,
                        },
                        {
                          value: 'sheets',
                          label: t('accounts.viewSheets'),
                          icon: <FileSpreadsheet size={14} />,
                        },
                      ]}
                      size="sm"
                      className="shrink-0"
                    />
                  )}
                </div>

                {resolvedViewMode === 'list' ? (
                  <div className="flex min-w-0 flex-col gap-4">
                    <div className="flex w-full items-center gap-3">
                      <Input
                        value={searchQuery}
                        onChange={e => handleSearchQueryChange(e.target.value)}
                        placeholder={t('accounts.searchPlaceholder')}
                        leftIcon={<Search className="w-4 h-4" />}
                        className="h-9 text-sm text-white placeholder-slate-400"
                        shellClassName="bg-black/40 border-white/10 focus-within:border-indigo-500/40 focus-within:bg-black/60"
                        containerClassName="w-full min-w-[260px] max-w-md"
                      />
                    </div>

                    <div className="relative z-20 hidden lg:flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2 py-2">
                      <FilterDropdown
                        value={statusFilter}
                        onChange={handleStatusFilterChange}
                        options={[
                          { value: 'all', label: t('filters.anyStatus') },
                          { value: 'active', label: getAccountStatusLabel('active') },
                          { value: 'banned', label: getAccountStatusLabel('banned') },
                          { value: 'limit_hit', label: getAccountStatusLabel('limit_hit') },
                          { value: 'expired', label: getAccountStatusLabel('expired') },
                          { value: 'unknown', label: getAccountStatusLabel('unknown') },
                        ]}
                        label={t('filters.status')}
                        triggerClassName="h-9 min-w-[148px]"
                        menuClassName="min-w-[220px]"
                        showActiveState={true}
                      />
                      <FilterDropdown
                        value={tagFilter}
                        onChange={handleTagFilterChange}
                        options={tagOptions}
                        label={t('accounts.tags')}
                        triggerClassName="h-9 min-w-[132px]"
                        menuClassName="min-w-[220px]"
                        showActiveState={true}
                      />
                      <FilterDropdown
                        value={relationFilter}
                        onChange={handleRelationFilterChange}
                        options={relationOptions}
                        label={t('accounts.relationFilterLabel')}
                        triggerClassName="h-9 min-w-[132px]"
                        menuClassName="min-w-[220px]"
                        showActiveState={true}
                      />
                      <FilterDropdown
                        value={quotaFilter}
                        onChange={handleQuotaFilterChange}
                        options={[
                          { value: 'any', label: t('filters.any') },
                          { value: 'has_quota', label: t('filters.hasQuota') },
                          { value: 'low_quota', label: t('filters.lowQuota') },
                          { value: 'empty', label: t('filters.empty') },
                          { value: 'full', label: t('filters.full') },
                        ]}
                        label={t('filters.quota')}
                        triggerClassName="h-9 min-w-[132px]"
                        menuClassName="min-w-[220px]"
                        showActiveState={true}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-500">
                    {t('accounts.sheetsIntegration')}
                    {sheetsUpdatedAt
                      ? ` • ${t('logs.lastUpdated')} ${new Date(sheetsUpdatedAt).toLocaleString()}`
                      : ''}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 justify-start xl:justify-end">
                {resolvedViewMode === 'list' ? (
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
                        label: t('accounts.importAccounts'),
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
                    spacing="tight"
                    size="sm"
                    className="h-9 px-2 rounded-lg bg-transparent"
                  />
                ) : (
                  <>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleTestSheets}
                      isLoading={sheetsTestStatus === 'loading'}
                      disabled={!sheetsParams}
                    >
                      {t('validation.testConnection')}
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleRefreshSheets}
                      disabled={!sheetsParams || sheetsLoading}
                      leftIcon={
                        <RefreshCw size={14} className={sheetsLoading ? 'animate-spin' : ''} />
                      }
                    >
                      {t('common.refresh')}
                    </Button>
                    <Button
                      variant={showSheetsConfig ? 'secondary' : 'outline'}
                      size="sm"
                      onClick={() => setShowSheetsConfig(current => !current)}
                    >
                      {t('common.settings')}
                    </Button>
                  </>
                )}

                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => navigate('/autoreg')}
                    variant="secondary"
                    size="sm"
                    className="h-9 rounded-lg"
                  >
                    <span className="hidden sm:inline">{t('sidebar.autoReg')}</span>
                    <span className="sm:hidden">АР</span>
                  </Button>
                  <Button
                    onClick={handleCreateStandaloneProfile}
                    variant="secondary"
                    size="sm"
                    className="h-9 rounded-lg"
                    leftIcon={<LayoutGrid size={16} />}
                  >
                    <span className="hidden sm:inline">{t('accounts.profilesCreateButton')}</span>
                    <span className="sm:hidden">{t('accounts.entityProfiles')}</span>
                  </Button>
                  <Button
                    onClick={() => setIsModalOpen(true)}
                    variant="primary"
                    size="sm"
                    leftIcon={<Plus size={18} />}
                    className="h-9 rounded-lg shadow-none"
                  >
                    <span className="hidden sm:inline">{t('accounts.addAccount')}</span>
                    <span className="sm:hidden">{t('common.add')}</span>
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {resolvedViewMode !== 'list' && showSheetsConfig && (
            <div className="shrink-0 px-6 pb-4 border-b border-white/5 bg-[#0a0a0c]/65">
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_minmax(260px,2fr)]">
                  <FormField
                    inputProps={{
                      label: t('accounts.sheetsSpreadsheetId'),
                      value: sheetsSpreadsheetId,
                      onChange: (event: ChangeEvent<HTMLInputElement>) => {
                        setSheetsTouched(true);
                        setSheetsSpreadsheetId(event.target.value);
                        setSheetsTestStatus('idle');
                        setSheetsTestMessage(null);
                      },
                      placeholder: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
                    }}
                  />
                  <FormField
                    type="textarea"
                    textareaProps={{
                      label: t('accounts.sheetsServiceAccountJson'),
                      value: sheetsServiceAccountJson,
                      onChange: (event: ChangeEvent<HTMLTextAreaElement>) => {
                        setSheetsTouched(true);
                        setSheetsServiceAccountJson(event.target.value);
                        setSheetsTestStatus('idle');
                        setSheetsTestMessage(null);
                      },
                      placeholder: '{"type":"service_account", ...}',
                      rows: 4,
                      className: 'font-mono text-[11px]',
                    }}
                  />
                </div>

                <div className="mt-2 text-[11px] text-slate-500">
                  {sheetsTestStatus === 'success' && t('validation.connectionSuccess')}
                  {sheetsTestStatus === 'error' &&
                    (sheetsTestMessage || t('validation.connectionFailed'))}
                </div>
              </div>
            </div>
          )}

          {/* Mobile quick filters */}
          {resolvedViewMode === 'list' ? (
            <div className="lg:hidden shrink-0 px-4 py-3 border-b border-white/5 bg-[#0d1016]/60 grid grid-cols-2 gap-2">
              <Select
                value={providerFilter}
                onChange={e => handleProviderFilterChange(e.target.value)}
                className="h-9 rounded-lg bg-black/40 border border-white/10 px-2 text-xs text-slate-200"
                shellClassName="bg-black/40 border-white/10"
                containerClassName="w-full"
              >
                <option value="all">{t('accounts.allProviders')}</option>
                {Object.values(providerCounts).slice(0, 0) /* no-op: keep lint happy */}
                {/* Keep mobile list aligned with sidebar provider filters */}
                {['kiro', 'windsurf', 'trae', 'aws', 'github', 'openai'].map(id => (
                  <option key={id} value={id}>
                    {id === 'aws' ? 'AWS Builder ID' : id.charAt(0).toUpperCase() + id.slice(1)}
                  </option>
                ))}
              </Select>

              <Select
                value={statusFilter}
                onChange={e => handleStatusFilterChange(e.target.value)}
                className="h-9 rounded-lg bg-black/40 border border-white/10 px-2 text-xs text-slate-200"
                shellClassName="bg-black/40 border-white/10"
                containerClassName="w-full"
              >
                <option value="all">{t('filters.anyStatus')}</option>
                <option value="active">{getAccountStatusLabel('active')}</option>
                <option value="banned">{getAccountStatusLabel('banned')}</option>
                <option value="expired">{getAccountStatusLabel('expired')}</option>
              </Select>

              <Select
                value={tagFilter}
                onChange={e => handleTagFilterChange(e.target.value)}
                className="h-9 rounded-lg bg-black/40 border border-white/10 px-2 text-xs text-slate-200"
                shellClassName="bg-black/40 border-white/10"
                containerClassName="col-span-2"
              >
                <option value="all">{t('accounts.mobileTagFilterLabel')}</option>
                {tagOptions
                  .filter(option => option.value !== 'all')
                  .map(option => (
                    <option key={String(option.value)} value={String(option.value)}>
                      {option.label}
                    </option>
                  ))}
              </Select>

              <Select
                value={relationFilter}
                onChange={e => handleRelationFilterChange(e.target.value)}
                className="h-9 rounded-lg bg-black/40 border border-white/10 px-2 text-xs text-slate-200"
                shellClassName="bg-black/40 border-white/10"
                containerClassName="col-span-2"
              >
                {relationOptions.map(option => (
                  <option key={String(option.value)} value={String(option.value)}>
                    {option.label}
                  </option>
                ))}
              </Select>

              <Select
                value={entityFilter}
                onChange={e => handleEntityFilterChange(e.target.value)}
                className="h-9 rounded-lg bg-black/40 border border-white/10 px-2 text-xs text-slate-200"
                shellClassName="bg-black/40 border-white/10"
                containerClassName="col-span-2"
              >
                {entityOptions.map(option => (
                  <option key={String(option.value)} value={String(option.value)}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

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
                      <div className="mx-6 mt-2 rounded-xl border border-white/5 bg-[#0f1115]/60 p-4">
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
                              onClick={async () => {
                                const selectedAccounts = filteredAccounts.filter(acc =>
                                  selectedIds.has(acc.id)
                                );
                                if (!selectedAccounts.length) return;
                                const settled = await Promise.allSettled(
                                  selectedAccounts.map(async acc => {
                                    const profile = await getOrCreateFingerprintProfile({
                                      email: acc.email,
                                    });
                                    await saveFingerprintProfile({ email: acc.email, profile });
                                  })
                                );
                                const success = settled.filter(
                                  s => s.status === 'fulfilled'
                                ).length;
                                const failed = settled.length - success;
                                if (failed === 0) toast.success(t('accounts.profileCreateSuccess'));
                                else if (success > 0)
                                  toast.warning(
                                    `${t('accounts.profileCreateSuccess')} (${success}), ${t('accounts.profileCreateFailed')} (${failed})`
                                  );
                                else toast.error(t('accounts.profileCreateFailed'));
                                await loadProfiles();
                              }}
                            >
                              {t('accounts.profilesCreateButton')}
                            </Button>
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
                      </div>
                    )}
                    <AccountsTable
                      accounts={filteredAccounts}
                      isLoading={loading}
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
                          <div className="mx-6 mt-4 rounded-xl border border-white/5 bg-[#0f1115]/60 p-4">
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
                                  onClick={async () => {
                                    const selectedAccounts = filteredAccounts.filter(acc =>
                                      selectedIds.has(acc.id)
                                    );
                                    if (!selectedAccounts.length) return;
                                    const settled = await Promise.allSettled(
                                      selectedAccounts.map(async acc => {
                                        const profile = await getOrCreateFingerprintProfile({
                                          email: acc.email,
                                        });
                                        await saveFingerprintProfile({ email: acc.email, profile });
                                      })
                                    );
                                    const success = settled.filter(
                                      s => s.status === 'fulfilled'
                                    ).length;
                                    const failed = settled.length - success;
                                    if (failed === 0)
                                      toast.success(t('accounts.profileCreateSuccess'));
                                    else if (success > 0)
                                      toast.warning(
                                        `${t('accounts.profileCreateSuccess')} (${success}), ${t('accounts.profileCreateFailed')} (${failed})`
                                      );
                                    else toast.error(t('accounts.profileCreateFailed'));
                                    await loadProfiles();
                                  }}
                                >
                                  {t('accounts.profilesCreateButton')}
                                </Button>
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
                          isLoading={loading}
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
