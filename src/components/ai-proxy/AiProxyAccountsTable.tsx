import { useMemo, useState } from 'react';
import { PlugZap, Trash2, PenSquare, ChevronRight } from 'lucide-react';

import type { AiProxyAccount } from '../../types/generated';
import { cn } from '../../lib/utils';
import { ProviderLogo } from '../ui/ProviderLogo';
import { StatusBadge } from '../ui/StatusBadge';
import { UsageBar } from '../ui/UsageBar';
import { useAiProxyStore } from '../../stores/aiProxy';

type SortKey = 'provider' | 'name' | 'lastUsedAt' | 'requestsToday';

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
  openAiQuota?: { error?: string | null }
) {
  const badges: Array<{ status: 'warning' | 'error' | 'info'; label: string }> = [];

  const meta = account as AiProxyAccount & {
    oauthRefreshError?: string | null;
    oauthRefreshToken?: string | null;
    cooldownUntil?: number | null;
  };

  if (meta.cooldownUntil && meta.cooldownUntil * 1000 > Date.now()) {
    badges.push({ status: 'warning', label: 'Cooldown' });
  }
  if (meta.oauthRefreshToken && meta.oauthRefreshError) {
    badges.push({ status: 'warning', label: 'Refresh error' });
  }
  if (conn?.status === 'error') {
    badges.push({ status: 'error', label: 'Conn error' });
  }
  if (openAiQuota?.error) {
    badges.push({ status: 'warning', label: 'Quota error' });
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

  const rows = useMemo(() => {
    const sorted = [...accounts];
    sorted.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'provider') return dir * a.provider.localeCompare(b.provider);
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
    setSortDir(key === 'name' || key === 'provider' ? 'asc' : 'desc');
  };

  return (
    <div className="rounded-xl border border-white/10 bg-[#111116]/80 overflow-hidden">
      <div className="hidden lg:grid grid-cols-[34px_minmax(220px,1fr)_140px_220px_140px_120px_120px] gap-3 px-4 py-3 border-b border-white/5 bg-black/20 sticky top-0 z-20">
        <button
          type="button"
          className="text-[10px] font-bold text-slate-500 uppercase tracking-widest text-left"
          onClick={() => toggleSort('provider')}
        >
          Provider
        </button>
        <button
          type="button"
          className="text-[10px] font-bold text-slate-500 uppercase tracking-widest text-left"
          onClick={() => toggleSort('name')}
        >
          Account
        </button>
        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Status</div>
        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Quota</div>
        <button
          type="button"
          className="text-[10px] font-bold text-slate-500 uppercase tracking-widest"
          onClick={() => toggleSort('requestsToday')}
        >
          Today
        </button>
        <button
          type="button"
          className="text-[10px] font-bold text-slate-500 uppercase tracking-widest"
          onClick={() => toggleSort('lastUsedAt')}
        >
          Last used
        </button>
        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">
          Actions
        </div>
      </div>

      <div className="max-h-[60vh] overflow-auto">
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

          const status: 'active' | 'inactive' | 'warning' | 'error' = !account.enabled
            ? 'inactive'
            : conn?.status === 'error'
              ? 'error'
              : conn?.status === 'ok'
                ? 'active'
                : 'active';

          const issues = buildIssueBadges(account, conn, openAiQuota);

          const quotaNode =
            account.provider === 'openai' && openAiQuota && !openAiQuota.error ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>Primary</span>
                  <span className="tabular-nums text-slate-300">
                    {Math.round(openAiQuota.primary.usedPercent)}%
                  </span>
                </div>
                <UsageBar used={Math.round(openAiQuota.primary.usedPercent)} limit={100} />
                {openAiQuota.secondary ? (
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>Weekly</span>
                    <span className="tabular-nums text-slate-300">
                      {Math.round(openAiQuota.secondary.usedPercent)}%
                    </span>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="text-xs text-slate-500">—</div>
            );

          return (
            <div
              key={account.id ?? `${account.provider}:${account.name}`}
              className={cn(
                'grid grid-cols-1 lg:grid-cols-[34px_minmax(220px,1fr)_140px_220px_140px_120px_120px] gap-3 px-4 py-3 border-b border-white/5',
                'hover:bg-white/[0.03] cursor-pointer'
              )}
              onClick={() => onRowClick(account)}
            >
              <div className="flex items-center justify-center">
                <ProviderLogo provider={account.provider} size={18} />
              </div>

              <div className="min-w-0">
                <div className="text-sm font-semibold text-white truncate">{account.name}</div>
                <div className="text-[11px] text-slate-500 tabular-nums">
                  {account.requestsToday.toLocaleString()} req today ·{' '}
                  {account.tokensUsed.toLocaleString()} tokens
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <StatusBadge status={status} withDot size="sm" />
                {issues.length ? (
                  <div className="flex flex-wrap gap-1">
                    {issues.slice(0, 3).map((b, idx) => (
                      <span
                        key={idx}
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
              </div>

              <div>{quotaNode}</div>

              <div className="text-xs text-slate-300 tabular-nums">
                {account.requestsToday.toLocaleString()}
              </div>

              <div className="text-xs text-slate-400 tabular-nums">
                {account.lastUsedAt
                  ? new Date(account.lastUsedAt * 1000).toLocaleDateString()
                  : 'Never'}
              </div>

              <div
                className="flex items-center justify-end gap-2"
                onClick={e => e.stopPropagation()}
              >
                <button
                  type="button"
                  className="p-1 rounded hover:bg-white/5 text-slate-400 hover:text-white"
                  title="Test connection"
                  onClick={() => onTestConnection(account)}
                  disabled={!account.id}
                >
                  <PlugZap
                    size={16}
                    className={conn?.status === 'loading' ? 'animate-pulse' : ''}
                  />
                </button>
                <button
                  type="button"
                  className="p-1 rounded hover:bg-white/5 text-slate-400 hover:text-white"
                  title="Edit"
                  onClick={() => onEdit(account)}
                >
                  <PenSquare size={16} />
                </button>
                <button
                  type="button"
                  className="p-1 rounded hover:bg-white/5 text-red-400 hover:text-red-300"
                  title="Delete"
                  onClick={() => account.id && onDelete(account.id)}
                  disabled={!account.id}
                >
                  <Trash2 size={16} />
                </button>
                <ChevronRight size={16} className="text-slate-600" />
              </div>
            </div>
          );
        })}

        {rows.length === 0 && !loading ? (
          <div className="p-6 text-sm text-slate-500">No accounts found</div>
        ) : null}
      </div>
    </div>
  );
}
