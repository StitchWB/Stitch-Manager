import { useMemo } from 'react';
import type { ProfileItem } from '../components/ProfilesTable';
import type { Account } from '../types';

export type ProfileListFilter = 'all' | 'standalone' | 'linked' | 'used_kiro';

interface UseProfilesViewModelParams {
  profileAliases: string[];
  accounts: Account[];
  searchQuery: string;
  profileListFilter: ProfileListFilter;
}

interface UseProfilesViewModelResult {
  profileItems: ProfileItem[];
  visibleProfileItems: ProfileItem[];
}

export function useProfilesViewModel({
  profileAliases,
  accounts,
  searchQuery,
  profileListFilter,
}: UseProfilesViewModelParams): UseProfilesViewModelResult {
  const profileItems = useMemo<ProfileItem[]>(() => {
    const linkedByAlias = new Map(
      accounts
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
          accounts.flatMap(acc => {
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
        usedForKiro: accounts.some(
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
  }, [accounts, profileAliases]);

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

  return { profileItems, visibleProfileItems };
}
