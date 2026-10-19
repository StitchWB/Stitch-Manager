import { useEffect, useMemo, useRef, useState } from 'react';
import { Inbox, Search, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge, ButtonBase, EmptyState, Input, ProviderLogo } from '@/components/ui';
import { listAccounts } from '@/lib/backend/modules/accounts';
import { useUIPersistedState } from '@/hooks/useUIState';
import {
  ACCOUNT_QUERY_PARAM,
  resolveMailboxProfileForAccount,
  type MailboxResolution,
} from '@/lib/mail/runtime';
import type { Account } from '@/types/generated';
import type { EmailInboxProfile } from '@/lib/backend/modules/emailInbox';
import { t } from '@/lib/i18n';

interface MailSidebarAccountsProps {
  profiles: EmailInboxProfile[];
  /** ?account=<id> currently active in URL (highlighted in the list) */
  activeAccountId: number | null;
  /** Maximum number of search/recent rows to render at once. */
  maxVisible?: number;
}

interface AccountWithResolution {
  account: Account;
  resolution: MailboxResolution;
}

const RECENT_ACCOUNTS_KEY = 'mail-recent-account-ids';
const MAX_RECENTS = 8;
const SEARCH_DEBOUNCE_MS = 150;

/**
 * Account-first navigation widget: search across hundreds of accounts by
 * email/provider instead of rendering the entire list up front, plus a
 * "recently opened" shortcut list. Selecting an account deep-links into
 * `?account=<id>` which the Mail page resolves to the right mailbox and
 * applies an inbox filter.
 */
export function MailSidebarAccounts({
  profiles,
  activeAccountId,
  maxVisible = 20,
}: MailSidebarAccountsProps) {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [recentIds, setRecentIds] = useUIPersistedState<number[]>(RECENT_ACCOUNTS_KEY, []);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Load accounts once on mount + reload when profiles change (so newly
  // attached mailbox profiles upgrade unresolved accounts in the list).
  useEffect(() => {
    let cancelled = false;
    void listAccounts()
      .then(list => {
        if (!cancelled) setAccounts(list);
      })
      .catch(error => {
        if (!cancelled) {
          console.warn('[MailSidebarAccounts] listAccounts failed:', error);
          setAccounts([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounce the search input so filtering hundreds of accounts on every
  // keystroke doesn't cause visible jank.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim().toLowerCase());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // Focus the search field with "/" when the user isn't already typing
  // somewhere else on the page (mirrors GitHub/Slack-style quick search).
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== '/') return;
      const active = document.activeElement;
      const isEditable =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable);
      if (isEditable) return;

      event.preventDefault();
      searchInputRef.current?.focus();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const resolved = useMemo<AccountWithResolution[]>(() => {
    if (!accounts) return [];

    return accounts.map(account => ({
      account,
      resolution: resolveMailboxProfileForAccount(
        {
          email: account.email,
          metadata: account.metadata ?? null,
          provider: account.provider,
        },
        profiles
      ),
    }));
  }, [accounts, profiles]);

  const resolvedById = useMemo(() => {
    const map = new Map<number, AccountWithResolution>();
    for (const item of resolved) {
      map.set(item.account.id, item);
    }
    return map;
  }, [resolved]);

  const searchResults = useMemo(() => {
    if (!debouncedSearch) return [];

    return resolved
      .filter(({ account }) => {
        const haystack = `${account.email} ${account.provider} ${account.id}`.toLowerCase();
        return haystack.includes(debouncedSearch);
      })
      .sort((a, b) => {
        const aHas = a.resolution.profile ? 1 : 0;
        const bHas = b.resolution.profile ? 1 : 0;
        if (aHas !== bHas) return bHas - aHas;
        return a.account.email.localeCompare(b.account.email);
      })
      .slice(0, maxVisible);
  }, [debouncedSearch, maxVisible, resolved]);

  const recentAccounts = useMemo(() => {
    return recentIds
      .map(id => resolvedById.get(id))
      .filter((item): item is AccountWithResolution => Boolean(item));
  }, [recentIds, resolvedById]);

  const isLoading = accounts === null;
  const isSearching = debouncedSearch.length > 0;
  const visibleList = isSearching ? searchResults : recentAccounts;

  const handleOpen = (account: Account) => {
    setRecentIds(prev => [account.id, ...prev.filter(id => id !== account.id)].slice(0, MAX_RECENTS));
    navigate(`/mail?${ACCOUNT_QUERY_PARAM}=${account.id}`);
  };

  return (
    <section className="p-3 border-b border-white/[0.06]">
      <header className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-white">
          <UserRound size={14} />
          <h2 className="text-[11px] font-semibold uppercase tracking-wide">
            {t('mail.sidebarAccountsTitle')}
          </h2>
        </div>
        <Badge size="sm" variant="outline">
          {accounts?.length ?? 0}
        </Badge>
      </header>

      <Input
        ref={searchInputRef}
        value={searchInput}
        onChange={event => setSearchInput(event.target.value)}
        placeholder={t('mail.accountSearchPlaceholder')}
        leftIcon={<Search size={13} />}
        containerClassName="mb-2"
        aria-label={t('mail.accountSearchPlaceholder')}
      />

      {isLoading ? (
        <p className="text-[11px] text-slate-500 px-1">{t('common.loading')}</p>
      ) : null}

      {!isLoading && !isSearching && recentAccounts.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title={t('mail.sidebarAccountsEmpty')}
          description={t('mail.accountSearchHint')}
          className="py-4"
        />
      ) : null}

      {!isLoading && isSearching && searchResults.length === 0 ? (
        <p className="text-[11px] text-slate-500 px-1 py-2">{t('mail.accountSearchNoResults')}</p>
      ) : null}

      {!isLoading && !isSearching && recentAccounts.length > 0 ? (
        <p className="text-[10px] uppercase tracking-wider text-slate-500 px-1 mb-1">
          {t('mail.accountRecentLabel')}
        </p>
      ) : null}

      <div className="space-y-1">
        {visibleList.map(({ account, resolution }) => {
          const isActive = activeAccountId === account.id;
          const hasMailbox = Boolean(resolution.profile);
          return (
            <ButtonBase
              key={account.id}
              type="button"
              onClick={() => handleOpen(account)}
              title={
                resolution.profile
                  ? t('mail.openInboxTooltipResolved', { label: resolution.profile.label })
                  : t('mail.openInboxTooltipMissing')
              }
              className={`group w-full text-left rounded-md px-2 py-1.5 transition-colors flex items-center gap-2 ${isActive
                  ? 'bg-indigo-500/15 text-white'
                  : hasMailbox
                    ? 'text-slate-300 hover:bg-white/5 hover:text-white'
                    : 'text-slate-500 hover:bg-white/5 hover:text-slate-300'
                }`}
            >
              <ProviderLogo
                provider={account.provider}
                size={14}
                className="shrink-0 opacity-80"
              />
              <span className="text-[11px] truncate flex-1">{account.email}</span>
              {!hasMailbox ? (
                <span className="text-[9px] text-amber-400/80 shrink-0 uppercase tracking-wider">
                  ?
                </span>
              ) : (
                <Inbox
                  size={11}
                  className="text-slate-500 group-hover:text-indigo-300 shrink-0"
                />
              )}
            </ButtonBase>
          );
        })}
      </div>
    </section>
  );
}
