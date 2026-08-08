import { t } from "@/lib/i18n";import React, { useState } from 'react';
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
  onCheckStatus
}: AccountQuotaCellProps) {
  const providerQuota = useAccountsStore(
    (state) => state.providerQuotaCache[account.id]
  );
  const isChecking = useAccountsStore(
    (state) => state.quotaCheckProgress[account.id] ?? false
  );
  const checkError = useAccountsStore(
    (state) => state.quotaCheckErrors[account.id] ?? null
  );
  const refreshAccount = useAccountsStore((state) => state.refreshAccount);
  const [isRefreshingQuota, setIsRefreshingQuota] = useState(false);

  const hasBackendQuota = account.quota && (account.quota.limit > 0 || account.quota.used > 0);
  // Provider quota exists in cache even if 0/0 — means "checked, key expired/exhausted"
  const hasProviderQuota = providerQuota !== undefined && providerQuota !== null;
  const hasQuota = hasBackendQuota || hasProviderQuota;

  const used = hasBackendQuota ?
  account.quota.used :
  hasProviderQuota ?
  providerQuota!.used :
  0;
  const limit = hasBackendQuota ?
  account.quota.limit :
  hasProviderQuota ?
  providerQuota!.limit :
  0;

  const percent = limit > 0 ? Math.min(Math.round(used / limit * 100), 100) : 0;

  const isFireworks = account.provider?.toLowerCase() === 'fireworks';
  const suspendState = isFireworks ? providerQuota?.status : undefined;

  // Determine display based on Fireworks suspend state
  const isCreditDepleted = suspendState === 'CREDIT_DEPLETED';
  const isLimitExceeded = suspendState === 'MONTHLY_SPEND_LIMIT_EXCEEDED';
  const isPaymentFailed = suspendState === 'FAILED_PAYMENTS';
  const isBlocked = suspendState === 'BLOCKED_BY_ABUSE_RULE';
  const isFrozen = isCreditDepleted || isLimitExceeded || isPaymentFailed || isBlocked;

  const displayPercent = isFrozen ? 100 : percent;
  const barColor = isCreditDepleted || isPaymentFailed || isBlocked ?
  'bg-red-500' :
  isLimitExceeded ?
  'bg-amber-500' :
  percent >= 90 ?
  'bg-red-500' :
  percent >= 70 ?
  'bg-amber-500' :
  'bg-emerald-500';
  const textColor = isCreditDepleted || isPaymentFailed || isBlocked ?
  'text-red-400' :
  isLimitExceeded ?
  'text-amber-400' :
  percent >= 90 ?
  'text-red-400' :
  percent >= 70 ?
  'text-amber-400' :
  'text-emerald-400';

  const canRefresh = Boolean(account.token);
  const isBusy = isChecking || isRefreshingQuota;

  // Per-row persisted-quota refresh: calls store.refreshAccount which invokes
  // the backend refresh_account command and updates the row from the returned
  // account object. Only for accounts that have a token.
  const handleRefreshQuota = () => {
    if (!canRefresh || isBusy) return;
    setIsRefreshingQuota(true);
    refreshAccount(account.id).catch(() => {
      // store sets error state; nothing to surface here
    }).finally(() => {
      setIsRefreshingQuota(false);
    });
  };

  // Live status check (existing behavior) — triggered by double-click on quota.
  const handleDoubleClick = () => {
    if (canRefresh && !isChecking) {
      onCheckStatus(account.id);
    }
  };

  // Text label for Fireworks status
  const getFireworksLabel = () => {
    if (isCreditDepleted) return 'Кредиты кончились';
    if (isLimitExceeded) return 'Лимит месяца';
    if (isPaymentFailed) return 'Платёж провален';
    if (isBlocked) return 'Блокировка';
    if (limit === 0) return 'Нет квоты';
    return `~$${used.toFixed(2)}/$${limit.toFixed(2)}`;
  };

  return (
    <div
      className={cn(
        'min-w-0 select-none',
        canRefresh && !isBusy && !hasQuota && 'cursor-pointer active:scale-95 transition-transform'
      )}
      onClick={canRefresh && !isBusy && !hasQuota ? handleRefreshQuota : undefined}
      onDoubleClick={canRefresh && !isChecking && hasQuota ? handleDoubleClick : undefined}
      title={checkError ? `Error: ${checkError}` : canRefresh ? !hasQuota ? t('accounts.quotaNoDataTooltip') : 'Double-click to refresh quota' : undefined}>

      {isBusy ?
      <div className="flex items-center gap-1.5 text-slate-400">
          <Loader2 size={11} className="animate-spin" />
          <span className="text-[10px]">{t("accounts.account_quota_cell.checking")}</span>
        </div> :
      hasQuota ?
      <div className="min-w-0">
          <div className="flex items-baseline gap-1">
            <span className={cn('text-xs font-bold tabular-nums shrink-0', textColor)}>{displayPercent}%</span>
            <span className="text-[9px] text-slate-500 tabular-nums shrink-0 whitespace-nowrap">
              {isFireworks ? getFireworksLabel() : `${used}/${limit}`}
            </span>
          </div>
          <div className="h-[2px] w-full rounded-full bg-white/[0.04] overflow-hidden mt-0.5">
            <div className={cn('h-full rounded-full', barColor)} style={{ width: `${displayPercent}%` }} />
          </div>
        </div> :
      checkError ?
      <div className="flex items-center gap-1 text-red-400">
          <RefreshCw size={11} />
          <span className="text-[10px] truncate" title={checkError}>{t("accounts.account_quota_cell.failed")}</span>
        </div> :
      canRefresh ?
      <div className={cn('flex items-center gap-1', canRefresh && !isChecking && 'text-slate-600')} title={t('accounts.quotaNoDataTooltip')}>
          <RefreshCw size={11} className={canRefresh && !isBusy ? 'cursor-pointer hover:text-slate-300' : ''} onClick={handleRefreshQuota} />
          <span className="text-[11px]">—</span>
        </div> :

      <span className="text-[11px] text-slate-600" title={t('accounts.notAvailable')}>—</span>
      }
    </div>);

});