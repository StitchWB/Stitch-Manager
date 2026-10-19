import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { t } from '@/lib/i18n';
import { cn, formatDate } from '@/lib/utils';
import { ButtonBase } from '@/components/ui/ButtonBase';
import { Tooltip } from '@/components/ui/Tooltip';
import { useUIPreferencesStore } from '@/stores/uiPreferences';
import type { Account } from '@/types/generated';
import type { ProviderInfo } from '@/types/ui';

import { TweenNumber } from './TweenNumber';

interface ParkSectionProps {
  accounts: Account[];
  providers: ProviderInfo[];
}

const FALLBACK_GRADIENT = 'from-slate-600 to-slate-700';

export function ParkSection({ accounts, providers }: ParkSectionProps) {
  const navigate = useNavigate();
  const total = accounts.length;

  const openProvider = useCallback(
    (provider: string) => {
      useUIPreferencesStore.getState().setAccountsProviderFilter(provider);
      navigate('/accounts');
    },
    [navigate],
  );

  const openNearLimit = useCallback(() => {
    useUIPreferencesStore.getState().setAccountsProviderFilter('all');
    useUIPreferencesStore.getState().setAccountsQuotaFilter('low_quota');
    navigate('/accounts');
  }, [navigate]);

  const distribution = useMemo(() => {
    const counts = new Map<string, number>();
    for (const account of accounts) {
      counts.set(account.provider, (counts.get(account.provider) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([provider, count]) => {
        const info = providers.find(p => p.id === provider);
        return {
          provider,
          name: info?.name ?? provider,
          color: info?.color ?? null,
          count,
        };
      })
      .sort((a, b) => b.count - a.count);
  }, [accounts, providers]);

  const nearLimit = useMemo(
    () =>
      accounts
        .filter(a => a.quota && a.quota.limit > 0)
        .map(a => ({ id: a.id, email: a.email, provider: a.provider, used: a.quota.used, limit: a.quota.limit, ratio: a.quota.used / a.quota.limit }))
        .sort((a, b) => b.ratio - a.ratio)
        .slice(0, 5),
    [accounts],
  );

  const recent = useMemo(
    () =>
      accounts
        .filter(a => Boolean(a.createdAt) && Number.isFinite(new Date(a.createdAt).getTime()))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 5),
    [accounts],
  );

  return (
    <section
      className="shrink-0 rounded-lg bg-black/40 backdrop-blur-sm border border-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-shadow hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_28px_rgba(99,102,241,0.07)] py-2"
      data-testid="park-section"
    >
      <div className="flex items-center gap-1.5 h-6 px-2">
        <span
          aria-hidden="true"
          className="w-0.5 h-3 rounded-full bg-gradient-to-b from-indigo-400 to-violet-500 shrink-0"
        />
        <h3 className="text-[10px] uppercase tracking-[0.14em] text-slate-400 font-medium select-none">
          {t('dashboard.cc.park.title')}
        </h3>
        <span className="flex items-baseline gap-1.5 min-w-0">
          <TweenNumber
            value={total}
            className="text-[24px] bg-gradient-to-r from-indigo-300 via-violet-300 to-indigo-200 bg-clip-text text-transparent font-semibold tabular-nums leading-none"
          />
          <span className="text-[10px] tabular-nums text-slate-500 truncate">
            {t('dashboard.cc.park.summary', { total: '' }).trim()}
          </span>
        </span>
      </div>

      <div className="grid gap-3 px-2 pb-2 grid-cols-1 min-[1200px]:grid-cols-3">
        <div className="flex flex-col gap-1.5 min-w-0">
          <h4 className="text-[10px] uppercase tracking-wider text-slate-500">
            {t('dashboard.cc.park.distribution')}
          </h4>
          {total === 0 ? (
            <span className="text-[11px] text-slate-400">{t('dashboard.cc.park.empty')}</span>
          ) : (
            <>
              <div className="h-2 rounded overflow-hidden flex">
                {distribution.map(entry => (
                  <span
                    key={entry.provider}
                    className={cn('h-full bg-gradient-to-br', entry.color ?? FALLBACK_GRADIENT)}
                    style={{ width: `${(entry.count / total) * 100}%` }}
                    aria-hidden="true"
                  />
                ))}
              </div>
              {distribution.map(entry => (
                <Tooltip
                  key={entry.provider}
                  content={t('dashboard.cc.park.openAccounts')}
                  side="top"
                  wrapperClassName="w-full min-w-0"
                >
                  <ButtonBase
                    type="button"
                    onClick={() => openProvider(entry.provider)}
                    className="w-full flex items-center gap-1.5 min-w-0 cursor-pointer hover:bg-white/[0.03] rounded px-1 -mx-1 transition-colors"
                  >
                    <span
                      className={cn('w-4 h-4 rounded shrink-0 bg-gradient-to-br', entry.color ?? FALLBACK_GRADIENT)}
                      aria-hidden="true"
                    />
                    <span className="text-[11px] text-slate-300 truncate">{entry.name}</span>
                    <span className="text-[11px] text-slate-300 tabular-nums shrink-0">{entry.count}</span>
                    <span className="text-[10px] text-slate-500 tabular-nums shrink-0">
                      {t('dashboard.cc.park.share', { pct: Math.round((entry.count / total) * 100) })}
                    </span>
                  </ButtonBase>
                </Tooltip>
              ))}
            </>
          )}
        </div>

        <div className="flex flex-col gap-1 min-w-0">
          <h4 className="text-[10px] uppercase tracking-wider text-slate-500">
            {t('dashboard.cc.park.nearLimit')}
          </h4>
          {nearLimit.length === 0 ? (
            <span className="text-[11px] text-slate-400">{t('dashboard.cc.park.empty')}</span>
          ) : (
            nearLimit.map(entry => (
              <Tooltip
                key={entry.id}
                content={t('dashboard.cc.park.openAccounts')}
                side="top"
                wrapperClassName="w-full min-w-0"
              >
                <ButtonBase
                  type="button"
                  onClick={openNearLimit}
                  className="w-full flex items-center gap-1.5 min-w-0 cursor-pointer hover:bg-white/[0.03] rounded px-1 -mx-1 transition-colors"
                >
                  <span className="text-[11px] text-slate-300 truncate">{entry.email}</span>
                  <span className="text-[10px] text-slate-500 shrink-0">{entry.provider}</span>
                  <span
                    className={cn(
                      'text-[11px] tabular-nums shrink-0 ml-auto',
                      entry.ratio > 0.8 ? 'text-amber-400' : 'text-slate-300',
                    )}
                  >
                    {`${entry.used}/${entry.limit}`}
                  </span>
                </ButtonBase>
              </Tooltip>
            ))
          )}
        </div>

        <div className="flex flex-col gap-1 min-w-0">
          <h4 className="text-[10px] uppercase tracking-wider text-slate-500">
            {t('dashboard.cc.park.recent')}
          </h4>
          {recent.length === 0 ? (
            <span className="text-[11px] text-slate-400">{t('dashboard.cc.park.empty')}</span>
          ) : (
            recent.map(account => (
              <Tooltip
                key={account.id}
                content={t('dashboard.cc.park.openAccounts')}
                side="top"
                wrapperClassName="w-full min-w-0"
              >
                <ButtonBase
                  type="button"
                  onClick={() => openProvider(account.provider)}
                  className="w-full flex items-center gap-1.5 min-w-0 cursor-pointer hover:bg-white/[0.03] rounded px-1 -mx-1 transition-colors"
                >
                  <span className="text-[11px] text-slate-300 truncate">{account.email}</span>
                  <span className="text-[10px] text-slate-500 shrink-0">{account.provider}</span>
                  <span className="text-[10px] text-slate-500 tabular-nums shrink-0 ml-auto">
                    {formatDate(account.createdAt)}
                  </span>
                </ButtonBase>
              </Tooltip>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
