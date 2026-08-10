import { useEffect, useMemo, useState } from 'react';
import type { ProfileItem } from '../components/ProfilesTable';
import type { Account } from '../types/generated';
import { formatProfileAlias } from '../lib/profiles/displayName';
import { getProfileSettings } from '../lib/backend/modules/profiles';
import { normalizeBrowserEngine, type BrowserEngineId } from '../lib/browser/engines';
import { safeInvoke } from '../lib/backend/core';

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
  shardAvailable: boolean;
}

export function useProfilesViewModel({
  profileAliases,
  accounts,
  searchQuery,
  profileListFilter,
}: UseProfilesViewModelParams): UseProfilesViewModelResult {
  const [engineMap, setEngineMap] = useState<Record<string, BrowserEngineId>>({});
  const [shardAvailable, setShardAvailable] = useState(false);

  // Fetch per-profile engine settings once per alias set.
  useEffect(() => {
    if (profileAliases.length === 0) return;
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        profileAliases.map(async alias => {
          try {
            const record = await getProfileSettings({ alias });
            const engine = normalizeBrowserEngine(record?.settings?.engine);
            return [alias, engine] as const;
          } catch {
            return [alias, 'cloakbrowser' as BrowserEngineId] as const;
          }
        })
      );
      if (cancelled) return;
      const next: Record<string, BrowserEngineId> = {};
      for (const [alias, engine] of entries) {
        next[alias] = engine;
      }
      setEngineMap(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [profileAliases]);

  // Fetch engine availability once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await safeInvoke<{ engines: Array<{ id: string; available: boolean }> }>('get_browser_engines', {});
        if (cancelled) return;
        const shard = res?.engines?.find(e => e.id === 'shardbrowser');
        setShardAvailable(shard ? shard.available : false);
      } catch {
        if (!cancelled) setShardAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
        displayName: formatProfileAlias(alias),
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
        engine: engineMap[alias] ?? 'cloakbrowser',
      };
    });
  }, [accounts, profileAliases, engineMap]);

  const visibleProfileItems = useMemo(() => {
    let items = [...profileItems];
    const q = searchQuery.trim().toLowerCase();

    if (q) {
      items = items.filter(
        item =>
          item.alias.toLowerCase().includes(q) || (item.displayName ?? '').toLowerCase().includes(q)
      );
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

  return { profileItems, visibleProfileItems, shardAvailable };
}
