import {
  Activity,
  LogIn,
  Gauge,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { Tooltip } from '@/components/ui/Tooltip';
import { Badge } from '@/components/ui/Badge';
import { TotpBadge } from '@/components/totp/TotpBadge';
import type { Account } from '@/types/generated';
import type { AccountStatusInfo } from '@/types/ui';
import { formatRelativeTime } from './helpers';
import { OverviewCredentialsCard } from './OverviewCredentialsCard';

interface OverviewTabProps {
  account: Account;
  showToken: boolean;
  setShowToken: (v: boolean) => void;
  showPassword: boolean;
  setShowPassword: (v: boolean) => void;
  isRefreshingToken: boolean;
  handleRefreshToken: () => void;
  onCopyToken: (token: string) => void;
  copy: (text: string, opts?: { sensitive?: boolean; successMessage?: string }) => void;
  statusInfo: AccountStatusInfo | null;
  statusError: string | null;
  kiro: boolean;
  totpKeys: { secret: string; period: number }[];
}

export function OverviewTab({
  account,
  showToken,
  setShowToken,
  showPassword,
  setShowPassword,
  isRefreshingToken,
  handleRefreshToken,
  onCopyToken,
  copy,
  statusInfo,
  statusError,
  kiro,
  totpKeys,
}: OverviewTabProps) {
  return (
    <>
      {/* Credentials */}
      <OverviewCredentialsCard
        account={account}
        showToken={showToken}
        setShowToken={setShowToken}
        showPassword={showPassword}
        setShowPassword={setShowPassword}
        isRefreshingToken={isRefreshingToken}
        handleRefreshToken={handleRefreshToken}
        onCopyToken={onCopyToken}
        copy={copy}
      />

      {/* Stats 2x2 Grid */}
      <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
        <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium px-3 pt-2.5 pb-2 border-b border-white/[0.04]">
          {t('accounts.drawer.statsTitle')}
        </h3>
        <div className="grid grid-cols-2 divide-x divide-y divide-white/[0.04]">
          <div className="p-2.5 flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-indigo-500/10 border border-indigo-500/15 flex items-center justify-center shrink-0">
              <Activity size={13} className="text-indigo-300" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] text-slate-500 uppercase tracking-wide">{t('accounts.activations')}</p>
              <p className="text-sm font-semibold text-white tabular-nums">{account.useCount || 0}</p>
            </div>
          </div>
          <div className="p-2.5 flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-sky-500/10 border border-sky-500/15 flex items-center justify-center shrink-0">
              <LogIn size={13} className="text-sky-300" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] text-slate-500 uppercase tracking-wide">{t('accounts.logins')}</p>
              <p className="text-sm font-semibold text-white tabular-nums">{account.loginCount || 0}</p>
            </div>
          </div>
          <div className="p-2.5 flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-emerald-500/10 border border-emerald-500/15 flex items-center justify-center shrink-0">
              <Gauge size={13} className="text-emerald-300" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] text-slate-500 uppercase tracking-wide">{t('accounts.successRate')}</p>
              <p className={cn(
                'text-sm font-semibold tabular-nums',
                account.successRate == null && 'text-slate-500',
                account.successRate >= 0.9 && 'text-emerald-400',
                account.successRate >= 0.7 && account.successRate < 0.9 && 'text-amber-400',
                account.successRate < 0.7 && account.useCount > 0 && 'text-red-400',
                !account.useCount && 'text-slate-500',
              )}>
                {account.successRate == null ? '—' : account.useCount > 0 ? `${Math.round(account.successRate * 100)}%` : '—'}
              </p>
            </div>
          </div>
          <div className="p-2.5 flex items-center gap-2">
            <div className={cn(
              'w-7 h-7 rounded-md flex items-center justify-center shrink-0 border',
              account.errorCount > 0 ? 'bg-red-500/10 border-red-500/15' : 'bg-white/[0.04] border-white/[0.06]',
            )}>
              <AlertTriangle size={13} className={account.errorCount > 0 ? 'text-red-300' : 'text-slate-500'} />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] text-slate-500 uppercase tracking-wide">{t('accounts.errorsLabel')}</p>
              {account.errorCount > 0 ? (
                <div className="flex items-center gap-1">
                  <p className="text-sm font-semibold text-red-400 tabular-nums">{account.errorCount}</p>
                  {account.lastError && (
                    <Tooltip content={account.lastError}>
                      <span className="text-[10px] text-slate-500 truncate max-w-[60px] cursor-help underline decoration-dotted underline-offset-2">
                        {account.lastError}
                      </span>
                    </Tooltip>
                  )}
                </div>
              ) : (
                <p className="text-sm font-semibold text-slate-400 tabular-nums">0</p>
              )}
            </div>
          </div>
        </div>
        {account.lastLoginAt && (
          <div className="px-3 py-1.5 border-t border-white/[0.04] flex items-center justify-between">
            <span className="text-[10px] text-slate-500">{t('accounts.drawer.lastLogin')}</span>
            <span className="text-[11px] text-slate-300">{formatRelativeTime(account.lastLoginAt)}</span>
          </div>
        )}
      </div>

      {/* TOTP section */}
      {totpKeys.length > 0 && (
        <div className="rounded-lg bg-white/[0.02] border border-white/10 px-3 py-2.5">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-2">TOTP</h3>
          <div className="space-y-2">
            {totpKeys.map((key, idx) => (
              <TotpBadge key={idx} secret={key.secret} period={key.period} variant="compact" />
            ))}
          </div>
        </div>
      )}

      {/* Live status */}
      {statusError && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
          {statusError}
        </div>
      )}
      {statusInfo && (
        <div className="p-3 rounded-lg bg-white/[0.02] border border-white/10 space-y-2">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium flex items-center gap-1.5">
            <Activity size={10} />
            {t('accounts.liveStatus')}
          </h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-slate-500 text-[10px]">{t('accounts.plan')}</div>
              <div className="text-slate-200 font-medium">{statusInfo.plan}</div>
            </div>
            <div>
              <div className="text-slate-500 text-[10px]">{t('common.status')}</div>
              <div className={cn('font-medium', statusInfo.isActive ? 'text-emerald-400' : 'text-red-400')}>
                {statusInfo.isActive ? t('status.active') : t('status.offline')}
              </div>
            </div>
            <div className="col-span-2">
              <div className="text-slate-500 text-[10px]">{t('accounts.quotaUsage')}</div>
              <div className="text-xs text-slate-300">
                {!statusInfo.isActive && statusInfo.quotaLimit === 0 ? (
                  <span className="text-red-400">{t('usageBar.errorBanned')}</span>
                ) : statusInfo.quotaLimit < 0 ? (
                  <span className="text-emerald-400">{t('usageBar.unlimited')}</span>
                ) : (
                  <>{account.provider?.toLowerCase() === 'fireworks' ? '~' : ''}{statusInfo.quotaUsed} / {statusInfo.quotaLimit} ({Math.round(statusInfo.quotaPercent)}%)</>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Billing (kiro only) */}
      {kiro && (
        <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-3 py-1.5">
            <span className="text-[11px] text-slate-500 shrink-0 w-20">{t('accounts.drawer.billing')}</span>
            <Badge variant="default" size="sm" className="normal-case tracking-normal">
              {statusInfo?.plan || t('accounts.drawer.noData')}
            </Badge>
          </div>
        </div>
      )}
    </>
  );
}
