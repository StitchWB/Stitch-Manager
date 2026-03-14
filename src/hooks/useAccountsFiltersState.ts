import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Account, AccountStatus } from '../types';

import { useUrlState } from './useUrlState';
import { t } from '../lib/i18n';
import {
  extractRelationEdges,
  hasAnyRelations,
  hasExplicitRelationLinks,
  isOAuthCapableIdentity,
} from '../lib/accounts/relations';
import { type FilterOption } from '@/components/ui';

type AccountsPagePreferences = {
  providerFilter: string;
  statusFilter: string;
  quotaFilter: string;
  searchQuery: string;
  tagFilter: string;
  relationFilter: string;
  entityFilter: string;
};

type UseAccountsFiltersStateArgs = {
  accounts: Account[];
  accountsPage: AccountsPagePreferences;
  setAccountsProviderFilter: (provider: string) => void;
  setAccountsStatusFilter: (status: string) => void;
  setAccountsQuotaFilter: (quota: string) => void;
  setAccountsSearchQuery: (query: string) => void;
  setAccountsTagFilter: (tag: string) => void;
  setAccountsRelationFilter: (relation: string) => void;
  setAccountsEntityFilter: (entity: string) => void;
  setSelectedProvider: (provider: any) => void;
  setStoreStatusFilter: (status: AccountStatus | null) => void;
  setStoreQuotaFilter: (filter: 'any' | 'has_quota' | 'empty' | 'full' | 'low_quota') => void;
  setStoreSearchQuery: (query: string) => void;
  clearSelection: () => void;
};

export type UseAccountsFiltersState = {
  providerFilter: string;
  statusFilter: string;
  searchQuery: string;
  quotaFilter: string;
  tagFilter: string;
  relationFilter: string;
  entityFilter: string;
  resolvedViewMode: 'list' | 'graph' | 'sheets';
  normalizedEntityFilter: 'accounts' | 'profiles';
  tagOptions: FilterOption<string>[];
  relationOptions: FilterOption<string>[];
  parseTags: (tagsString: string | null) => string[];
  handleProviderFilterChange: (value: string) => void;
  handleStatusFilterChange: (value: string) => void;
  handleQuotaFilterChange: (value: string) => void;
  handleTagFilterChange: (value: string) => void;
  handleRelationFilterChange: (value: string) => void;
  handleSearchQueryChange: (value: string) => void;
  handleEntityFilterChange: (value: string) => void;
  handleViewModeChange: (value: string) => void;
};

export function useAccountsFiltersState({
  accounts,
  accountsPage,
  setAccountsProviderFilter,
  setAccountsStatusFilter,
  setAccountsQuotaFilter,
  setAccountsSearchQuery,
  setAccountsTagFilter,
  setAccountsRelationFilter,
  setAccountsEntityFilter,
  setSelectedProvider,
  setStoreStatusFilter,
  setStoreQuotaFilter,
  setStoreSearchQuery,
  clearSelection,
}: UseAccountsFiltersStateArgs): UseAccountsFiltersState {
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
    accounts.forEach(acc => {
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
  }, [accounts, parseTags]);

  const relationOptions = useMemo((): FilterOption<string>[] => {
    const hasAnyCount = accounts.filter(acc => hasAnyRelations(acc)).length;
    const explicitCount = accounts.filter(acc => hasExplicitRelationLinks(acc)).length;
    const oauthCapableCount = accounts.filter(acc => isOAuthCapableIdentity(acc)).length;

    const dynamicEdgeCounts = new Map<string, { label: string; count: number }>();
    accounts.forEach(account => {
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
  }, [accounts]);

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

  const resolvedViewMode = viewMode === 'graph' || viewMode === 'sheets' ? viewMode : 'list';

  return useMemo(
    () => ({
      providerFilter,
      statusFilter,
      searchQuery,
      quotaFilter,
      tagFilter,
      relationFilter,
      entityFilter,
      resolvedViewMode,
      normalizedEntityFilter,
      tagOptions,
      relationOptions,
      parseTags,
      handleProviderFilterChange,
      handleStatusFilterChange,
      handleQuotaFilterChange,
      handleTagFilterChange,
      handleRelationFilterChange,
      handleSearchQueryChange,
      handleEntityFilterChange,
      handleViewModeChange,
    }),
    [
      providerFilter,
      statusFilter,
      searchQuery,
      quotaFilter,
      tagFilter,
      relationFilter,
      entityFilter,
      resolvedViewMode,
      normalizedEntityFilter,
      tagOptions,
      relationOptions,
      parseTags,
      handleProviderFilterChange,
      handleStatusFilterChange,
      handleQuotaFilterChange,
      handleTagFilterChange,
      handleRelationFilterChange,
      handleSearchQueryChange,
      handleEntityFilterChange,
      handleViewModeChange,
    ]
  );
}
