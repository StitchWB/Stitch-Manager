import React, { useMemo, useState } from 'react';
import { PlugZap, Trash2, PenSquare, ChevronRight } from 'lucide-react';
import { ButtonBase, ProviderLogo, StatusBadge, UsageBar } from '@/components/ui';

import type { AiProxyAccount } from '../../types/generated';
import { cn } from '../../lib/utils';
import { useAiProxyStore } from '../../stores/aiProxy';
import { t } from '@/lib/i18n';

type SortKey = 'name' | 'lastUsedAt' | 'requestsToday';

interface AiProxyAccountsTableProps {
  accounts: AiProxyAccount[];
  loading: boolean;
  connectionState: Record<
    number,
    { status: 'idle' | 'loading' | 'ok' | 'error'; message?: string }
  >;
  onRowClick: (account: AiProxyAccount) => void;
  onEdit: (account: AiProxyAccount) => void;
  onDelete: (id: number) => void;
  onTestConnection: (account: AiProxyAccount) => void;
}

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

function extractFileTail(accountName: string): string | null {
  const m = accountName.match(/\(([^)]+\.(?:json|jsonc))\)/i);
  return m?.[1] ?? null;
}

function buildIssueBadges(
  account: AiProxyAccount,
  conn?: { status: string },
  openAiQuota?: { error?: string | null },
  kiroQuota?: { error?: string | null }
) {
  const badges: Array<{ status: 'warning' | 'error' | 'info'; label: string }> = [];

  const meta = account as AiProxyAccount & {
    oauthRefreshError?: string | null;
    oauthRefreshToken?: string | null;
    cooldownUntil?: number | null;
  };

  if (meta.cooldownUntil && meta.cooldownUntil * 1000 > Date.now()) {
    badges.push({ status: 'warning', label: t('aiHub.table.badges.cooldown') });
  }
  if (meta.oauthRefreshToken && meta.oauthRefreshError) {
    badges.push({ status: 'warning', label: t('aiHub.table.badges.refreshError') });
  }
  if (conn?.status === 'error') {
    badges.push({ status: 'error', label: t('aiHub.table.badges.connectionError') });
  }
  if (openAiQuota?.error) {
    badges.push({ status: 'warning', label: t('aiHub.table.badges.quotaError') });
  }
  if (kiroQuota?.error) {
    badges.push({ status: 'warning', label: t('aiHub.table.badges.quotaError') });
  }

  return badges;
}

export function AiProxyAccountsTable({
  accounts,
  loading,
  connectionState,
  onRowClick,
  onEdit,
  onDelete,
  onTestConnection,
}: AiProxyAccountsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('lastUsedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const openAiQuotaMap = useAiProxyStore(state => state.openAiAccountQuotas);
  const kiroQuotaMap = useAiProxyStore(state => state.kiroAccountQuotas);

  const rows = useMemo(() => {
    const sorted = [...accounts];
    sorted.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'name') return dir * a.name.localeCompare(b.name);
      if (sortKey === 'requestsToday') return dir * (a.requestsToday - b.requestsToday);
      const av = a.lastUsedAt ?? 0;
      const bv = b.lastUsedAt ?? 0;
      return dir * (av - bv);
    });
    return sorted;
  }, [accounts, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(key === 'name' ? 'asc' : 'desc');
  };

  return (
    <div className="rounded-xl border border-white/10 bg-ds-surface-overlay/80 overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-[860px]">
          <div className="hidden lg:grid grid-cols-[34px_minmax(220px,1fr)_140px_220px_120px_120px] gap-4 px-4 py-3 border-b border-white/5 bg-black/20 sticky top-0 z-20">
            <div aria-hidden="true" />
            <ButtonBase
              type="button"
              className="text-[10px] font-bold text-slate-500 uppercase tracking-widest text-left"
              onClick={() => toggleSort('name')}
            >
              {t('aiHub.table.account')}
            </ButtonBase>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              {t('aiHub.table.status')}
            </div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              {t('aiHub.table.quota')}
            </div>
            <ButtonBase
              type="button"
              className="text-[10px] font-bold text-slate-500 uppercase tracking-widest"
              onClick={() => toggleSort('lastUsedAt')}
            >
              {t('aiHub.table.lastUsed')}
            </ButtonBase>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">
              {t('aiHub.table.actions')}
            </div>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
        {rows.map(account => {
          const conn = account.id ? connectionState[account.id] : undefined;

          const fileTail = extractFileTail(account.name);
          const quotaKeyCandidates = [
            account.name,
            fileTail ?? '',
            fileTail ? fileTail.replace(/\.(json|jsonc)$/i, '') : '',
          ]
            .filter(Boolean)
            .map(normalize);
          const openAiQuota = quotaKeyCandidates.map(k => openAiQuotaMap[k]).find(Boolean);
          const kiroQuota = account.id ? kiroQuotaMap[account.id] : undefined;

          const status: 'active' | 'inactive' | 'warning' | 'error' = !account.enabled
            ? 'inactive'
            : conn?.status === 'error'
              ? 'error'
              : conn?.status === 'ok'
                ? 'active'
                : 'active';

          const issues = buildIssueBadges(account, conn, openAiQuota, kiroQuota);

          let quotaNode: React.ReactNode;
          if (account.provider === 'openai' && openAiQuota && !openAiQuota.error) {
            quotaNode = (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>{t('aiHub.table.quotaPrimary')}</span>
                  <span className="tabular-nums text-slate-300">
                    {Math.round(openAiQuota.primary.usedPercent)}%
                  </span>
                </div>
                <UsageBar used={Math.round(openAiQuota.primary.usedPercent)} limit={100} />
                {openAiQuota.secondary ? (
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>{t('aiHub.table.quotaWeekly')}</span>
                    <span className="tabular-nums text-slate-300">
                      {Math.round(openAiQuota.secondary.usedPercent)}%
                    </span>
                  </div>
                ) : null}
              </div>
            );
          } else if (account.provider === 'kiro' && kiroQuota && !kiroQuota.error) {
            quotaNode = (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>{t('aiHub.table.quotaPrimary')}</span>
                  <span className="tabular-nums text-slate-300">
                    {Math.round(kiroQuota.percentUsed)}%
                  </span>
                </div>
                <UsageBar used={Math.round(kiroQuota.percentUsed)} limit={100} />
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>{kiroQuota.used.toLocaleString()} / {kiroQuota.limit > 0 ? kiroQuota.limit.toLocaleString() : '∞'}</span>
                  {kiroQuota.daysUntilReset ? (
                    <span className="tabular-nums text-slate-300">
                      {t('aiHub.table.resetsIn', { days: kiroQuota.daysUntilReset })}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          } else {
            quotaNode = (
              <div className="text-xs text-slate-500">{t('aiHub.table.emptyValue')}</div>
            );
          }

          return (
            <div
              key={account.id ?? `${account.provider}:${account.name}`}
              className={cn(
                'relative grid grid-cols-1 lg:grid-cols-[34px_minmax(220px,1fr)_140px_220px_120px_120px] gap-3 px-4 py-3 border-b border-white/5 text-left',
                'hover:bg-white/[0.03]'
              )}
            >
              <ButtonBase
                type="button"
                className="absolute inset-0 z-10 focus:outline-none"
                onClick={() => onRowClick(account)}
                aria-label={account.name}
              />
              <div className="relative z-0 flex items-center justify-center">
                <ProviderLogo provider={account.provider} size={18} />
              </div>

              <div className="relative z-0 min-w-0">
                <div className="text-sm font-semibold text-white truncate">{account.name}</div>
                <div className="text-[11px] text-slate-500 tabular-nums">
                  {t('aiHub.table.requestsLine', {
                    requests: account.requestsToday.toLocaleString(),
                    tokens: account.tokensUsed.toLocaleString(),
                  })}
                </div>
              </div>

              <div className="relative z-0 flex flex-col gap-1">
                <StatusBadge status={status} withDot size="sm" />
                {issues.length ? (
                  <div className="flex flex-wrap gap-1">
                    {issues.slice(0, 3).map(b => (
                      <span
                        key={`${b.status}-${b.label}`}
                        className={cn(
                          'text-[10px] px-2 py-0.5 rounded-full border border-white/10 bg-white/5 text-slate-300',
                          b.status === 'error' && 'border-red-500/30 bg-red-500/10 text-red-200',
                          b.status === 'warning' &&
                            'border-amber-500/30 bg-amber-500/10 text-amber-200'
                        )}
                      >
                        {b.label}
                      </span>
                    ))}
                  </div>
                ) : null}
                {conn?.status === 'error' && conn.message ? (
                  <div className="text-[10px] text-red-300 truncate" title={conn.message}>
                    {conn.message}
                  </div>
                ) : null}
                {account.provider === 'kiro' && kiroQuota?.error ? (
                  <div className="text-[10px] text-amber-300 truncate" title={kiroQuota.error}>
                    {kiroQuota.error}
                  </div>
                ) : null}
              </div>

              <div className="relative z-0">{quotaNode}</div>

              <div className="relative z-0 text-xs text-slate-400 tabular-nums">
                {account.lastUsedAt
                  ? new Date(account.lastUsedAt * 1000).toLocaleDateString()
                  : t('aiHub.table.never')}
              </div>

              <div className="relative z-20 flex items-center justify-end gap-2">
                <ButtonBase
                  type="button"
                  className="p-1 rounded hover:bg-white/5 text-slate-400 hover:text-white"
                  title={t('aiHub.table.testConnection')}
                  onClick={() => onTestConnection(account)}
                  disabled={!account.id}
                >
                  <PlugZap
                    size={16}
                    className={cn(conn?.status === 'loading' && 'animate-pulse')}
                  />
                </ButtonBase>
                <ButtonBase
                  type="button"
                  className="p-1 rounded hover:bg-white/5 text-slate-400 hover:text-white"
                  title={t('aiHub.table.edit')}
                  onClick={() => onEdit(account)}
                >
                  <PenSquare size={16} />
                </ButtonBase>
                <ButtonBase
                  type="button"
                  className="p-1 rounded hover:bg-white/5 text-red-400 hover:text-red-300"
                  title={t('aiHub.table.delete')}
                  onClick={() => account.id && onDelete(account.id)}
                  disabled={!account.id}
                >
                  <Trash2 size={16} />
                </ButtonBase>
                <ChevronRight size={16} className="text-slate-600" />
              </div>
            </div>
          );
        })}

        {rows.length === 0 && !loading ? (
          <div className="p-6 text-sm text-slate-500">
            <div className="text-white font-medium">{t('aiHub.empty.noAccountsFound')}</div>
            <div className="text-xs text-slate-500 mt-1">{t('aiHub.empty.noAccountsHint')}</div>
          </div>
        ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
