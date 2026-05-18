import { useEffect, useMemo, useState } from 'react';
import { Inbox, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge, ButtonBase, EmptyState, ProviderLogo } from '@/components/ui';
import { listAccounts } from '@/lib/tauri/modules/accounts';
import {
  ACCOUNT_QUERY_PARAM,
  resolveMailboxProfileForAccount,
  type MailboxResolution,
} from '@/lib/mail/runtime';
import type { Account } from '@/types/generated';
import type { EmailInboxProfile } from '@/lib/tauri/modules/emailInbox';
import { t } from '@/lib/i18n';

interface MailSidebarAccountsProps {
  profiles: EmailInboxProfile[];
  /** ?account=<id> currently active in URL (highlighted in the list) */
  activeAccountId: number | null;
  /** Maximum number of accounts to render (overflow goes behind a "show more"). */
  maxVisible?: number;
}

interface AccountWithResolution {
  account: Account;
  resolution: MailboxResolution;
}

/**
 * Renders the auto-reg accounts that have a mailbox available, with one click
 * to deep-link into the corresponding `?account=<id>` mail view. Accounts
 * whose mailbox cannot be resolved are still shown but greyed out so the user
 * can attach a mailbox via AccountDetailsModal later.
 */
export function MailSidebarAccounts({
  profiles,
  activeAccountId,
  maxVisible = 12,
}: MailSidebarAccountsProps) {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [showAll, setShowAll] = useState(false);

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

  const resolved = useMemo<AccountWithResolution[]>(() => {
    if (!accounts) return [];

    return accounts
      .map(account => ({
        account,
        resolution: resolveMailboxProfileForAccount(
          {
            email: account.email,
            metadata: account.metadata ?? null,
            provider: account.provider,
          },
          profiles
        ),
      }))
      // Newest first to surface freshly-registered accounts at the top.
      .sort((a, b) => {
        // Prefer accounts that resolve to a mailbox, then by creation desc.
        const aHas = a.resolution.profile ? 1 : 0;
        const bHas = b.resolution.profile ? 1 : 0;
        if (aHas !== bHas) return bHas - aHas;
        return (b.account.createdAt ?? '').localeCompare(a.account.createdAt ?? '');
      });
  }, [accounts, profiles]);

  const visible = showAll ? resolved : resolved.slice(0, maxVisible);
  const overflow = Math.max(0, resolved.length - maxVisible);

  const handleOpen = (account: Account) => {
    navigate(`/mail?${ACCOUNT_QUERY_PARAM}=${account.id}`);
  };

  const isLoading = accounts === null;

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
          {resolved.length}
        </Badge>
      </header>

      {isLoading ? (
        <p className="text-[11px] text-slate-500 px-1">{t('common.loading')}</p>
      ) : null}

      {!isLoading && resolved.length === 0 ? (
        <EmptyState
          icon={UserRound}
          title={t('mail.sidebarAccountsEmpty')}
          className="py-4"
        />
      ) : null}

      <div className="space-y-1">
        {visible.map(({ account, resolution }) => {
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
              className={`group w-full text-left rounded-md px-2 py-1.5 transition-colors flex items-center gap-2 ${
                isActive
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

      {overflow > 0 ? (
        <ButtonBase
          type="button"
          onClick={() => setShowAll(value => !value)}
          className="mt-2 w-full text-[10px] uppercase tracking-wider text-slate-500 hover:text-slate-300 transition-colors text-left"
        >
          {showAll ? t('mail.sidebarAccountsCollapse') : t('mail.sidebarAccountsShowMore', { count: overflow })}
        </ButtonBase>
      ) : null}
    </section>
  );
}
