import { useMemo } from 'react';
import type { Account } from '../types/generated';
import {
  extractRelationEdges,
  hasAnyRelations,
  hasExplicitRelationLinks,
  isOAuthCapableIdentity,
} from '../lib/accounts/relations';

type UseAccountsListViewModelArgs = {
  accounts: Account[];
  providerFilter: string;
  searchQuery: string;
  statusFilter: string;
  quotaFilter: string;
  tagFilter: string;
  relationFilter: string;
  parseTags: (tagsString: string | null) => string[];
};

export type AccountsListViewModel = {
  filteredAccounts: Account[];
  filteredAccountIds: number[];
  expiredAccountIds: number[];
  providerCounts: Record<string, number>;
  expiredCount: number;
};

export function useAccountsListViewModel({
  accounts,
  providerFilter,
  searchQuery,
  statusFilter,
  quotaFilter,
  tagFilter,
  relationFilter,
  parseTags,
}: UseAccountsListViewModelArgs): AccountsListViewModel {
  const providerCounts = useMemo(() => {
    const counts: Record<string, number> = { all: 0 };
    accounts.forEach(acc => {
      counts.all++;

      // Count each provider separately - no mapping
      const provider = acc.provider;
      counts[provider] = (counts[provider] || 0) + 1;
    });
    return counts;
  }, [accounts]);

  const expiredCount = useMemo(
    () => accounts.filter(a => a.status === 'expired').length,
    [accounts]
  );

  const filteredAccounts = useMemo(() => {
    let filtered = [...accounts];

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
    accounts,
    providerFilter,
    searchQuery,
    statusFilter,
    tagFilter,
    relationFilter,
    quotaFilter,
    parseTags,
  ]);

  const filteredAccountIds = useMemo(
    () => filteredAccounts.map(account => account.id),
    [filteredAccounts]
  );

  const expiredAccountIds = useMemo(
    () =>
      filteredAccounts.filter(account => account.status === 'expired').map(account => account.id),
    [filteredAccounts]
  );

  return {
    filteredAccounts,
    filteredAccountIds,
    expiredAccountIds,
    providerCounts,
    expiredCount,
  };
}
