import React from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import type { Account } from '@/types/generated';
import { useAccountsStore } from '@/stores/accounts';
import { cn } from '@/lib/utils';

interface AccountQuotaCellProps {
  account: Account;
  onCheckStatus: (id: number) => void;
}

export const AccountQuotaCell = React.memo(function AccountQuotaCell({
  account,
  onCheckStatus,
}: AccountQuotaCellProps) {
  const providerQuota = useAccountsStore(
    state => state.providerQuotaCache[account.id]
  );
  const isChecking = useAccountsStore(
    state => state.quotaCheckProgress[account.id] ?? false
  );
  const checkError = useAccountsStore(
    state => state.quotaCheckErrors[account.id] ?? null
  );

  const hasBackendQuota = account.quota && (account.quota.limit > 0 || account.quota.used > 0);
  const hasProviderQuota = providerQuota && (providerQuota.limit > 0 || providerQuota.used > 0);
  const hasQuota = hasBackendQuota || hasProviderQuota;

  const used = hasBackendQuota
    ? account.quota.used
    : hasProviderQuota
      ? providerQuota!.used
      : 0;
  const limit = hasBackendQuota
    ? account.quota.limit
    : hasProviderQuota
      ? providerQuota!.limit
      : 0;

  const percent = limit > 0 ? Math.min(Math.round((used / limit) * 100), 100) : 0;
  const barColor =
    percent > 90 ? 'bg-red-500' : percent > 75 ? 'bg-amber-500' : 'bg-emerald-500';
  const textColor =
    percent > 90 ? 'text-red-400' : percent > 75 ? 'text-amber-400' : 'text-emerald-400';

  const canRefresh = Boolean(account.token);

  const handleDoubleClick = () => {
    if (canRefresh && !isChecking) {
      onCheckStatus(account.id);
    }
  };

  return (
    <div
      className={cn(
        'min-w-0 select-none',
        canRefresh && !isChecking && !hasQuota && 'cursor-pointer active:scale-95 transition-transform'
      )}
      onClick={canRefresh && !isChecking && !hasQuota ? handleDoubleClick : undefined}
      onDoubleClick={canRefresh && !isChecking && hasQuota ? handleDoubleClick : undefined}
      title={checkError ? `Error: ${checkError}` : canRefresh ? !hasQuota ? 'Click to check quota' : 'Double-click to refresh quota' : undefined}
    >
      {isChecking ? (
        <div className="flex items-center gap-1.5 text-slate-400">
          <Loader2 size={11} className="animate-spin" />
          <span className="text-[10px]">Checking…</span>
        </div>
      ) : checkError ? (
        <div className="flex items-center gap-1 text-red-400">
          <RefreshCw size={11} />
          <span className="text-[10px] truncate" title={checkError}>Failed</span>
        </div>
      ) : hasQuota ? (
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className={cn('text-xs font-bold tabular-nums', textColor)}>{percent}%</span>
            <span className="text-[9px] text-slate-500 tabular-nums">{used}/{limit}</span>
          </div>
          <div className="h-[2px] w-full rounded-full bg-white/[0.04] overflow-hidden mt-0.5">
            <div className={cn('h-full rounded-full', barColor)} style={{ width: `${percent}%` }} />
          </div>
        </div>
      ) : canRefresh ? (
        <div className={cn('flex items-center gap-1', canRefresh && !isChecking && 'text-slate-500')}>
          <RefreshCw size={11} />
          <span className="text-[11px]">—</span>
        </div>
      ) : (
        <span className="text-xs text-slate-500">—</span>
      )}
    </div>
  );
});
