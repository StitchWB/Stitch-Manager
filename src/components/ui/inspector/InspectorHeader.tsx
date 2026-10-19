import { X, Clock, Cpu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { ProviderLogo } from '@/components/ui/ProviderLogo';
import { Tooltip } from '@/components/ui/Tooltip';
import { Badge } from '@/components/ui/Badge';
import { IconButton } from '@/components/ui/IconButton';
import type { Account } from '@/types/generated';
import { formatRelativeTime } from './helpers';

interface InspectorHeaderProps {
  account: Account;
  tokenExpiryDiff: number | null;
  copy: (text: string, opts?: { sensitive?: boolean; successMessage?: string }) => void;
  onClose: () => void;
}

export function InspectorHeader({ account, tokenExpiryDiff, copy, onClose }: InspectorHeaderProps) {
  return (
    <div className="shrink-0 p-4 border-b border-white/5">
      {/* Row 1: logo + email + status + close */}
      <div className="flex items-center gap-2">
        <ProviderLogo provider={account.provider} size={20} className="shrink-0" />
        <Tooltip content={t('accounts.quickActions.copyEmail')}>
          <button
            onClick={() => copy(account.email, { successMessage: t('accounts.quickActions.emailCopied') })}
            className="flex-1 truncate text-sm font-semibold text-white hover:text-indigo-200 transition-colors text-left"
          >
            {account.email}
          </button>
        </Tooltip>
        <Badge
          variant={account.status === 'active' ? 'success' : account.status === 'banned' ? 'danger' : 'default'}
          size="sm"
          withDot
          className="shrink-0 normal-case tracking-normal"
        >
          {account.status}
        </Badge>
        <IconButton
          type="button"
          size="sm"
          variant="ghost"
          onClick={onClose}
          className="shrink-0 text-slate-400 hover:text-white"
          aria-label={t('common.close')}
        >
          <X size={16} />
        </IconButton>
      </div>
      {/* Row 2: meta line */}
      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500 flex-wrap">
        {account.registrationMethod && (
          <span className="text-slate-400">{account.registrationMethod}</span>
        )}
        {account.registrationMethod && (account.createdAt || account.registrationDate) && (
          <span className="text-slate-600">·</span>
        )}
        {(account.createdAt || account.registrationDate) && (
          <span>{formatRelativeTime(account.createdAt || account.registrationDate)}</span>
        )}
        {account.machineId && (
          <>
            <span className="text-slate-600">·</span>
            <Tooltip content={t('accounts.drawer.copyMachineId')}>
              <button
                onClick={() => copy(account.machineId!, { successMessage: t('accounts.drawer.machineIdCopied') })}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.06] transition-colors font-mono text-[10px] text-slate-300 hover:text-slate-100"
              >
                <Cpu size={9} className="text-slate-500" />
                <span className="truncate max-w-[80px]">{account.machineId.slice(-8)}</span>
              </button>
            </Tooltip>
          </>
        )}
      </div>
      {/* Row 3: status strip — quota + token expiry */}
      {((account.quota && account.quota.limit > 0) || account.expiresAt) && (
        <div className="mt-2 flex items-center gap-3">
          {account.quota && account.quota.limit > 0 && (() => {
            const pct = account.quota.limit > 0
              ? Math.min(Math.round(account.quota.used / account.quota.limit * 100), 100)
              : 0;
            const barColor = pct > 90 ? 'bg-red-500' : pct > 75 ? 'bg-amber-500' : 'bg-emerald-500';
            const textColor = pct > 90 ? 'text-red-400' : pct > 75 ? 'text-amber-400' : 'text-emerald-400';
            return (
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <div className="h-1.5 flex-1 rounded-full bg-white/[0.04] overflow-hidden">
                  <div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[10px] text-slate-400 tabular-nums shrink-0">
                  {account.quota.used}/{account.quota.limit}
                </span>
                <span className={cn('text-[10px] font-bold tabular-nums shrink-0', textColor)}>{pct}%</span>
              </div>
            );
          })()}
          {account.expiresAt && tokenExpiryDiff != null && (
            <div className="flex items-center gap-1 shrink-0">
              <Clock size={11} className="text-slate-500" />
              {tokenExpiryDiff <= 0 ? (
                <span className="text-[10px] text-red-400">{t('accounts.drawer.tokenExpired')}</span>
              ) : tokenExpiryDiff < 86400000 ? (
                <span className="text-[10px] text-amber-400">
                  {t('accounts.inspector.tokenHoursRemaining', { hours: Math.floor(tokenExpiryDiff / 3600000) })}
                </span>
              ) : (
                <span className="text-[10px] text-slate-300">
                  {t('accounts.inspector.tokenDaysRemaining', { days: Math.floor(tokenExpiryDiff / 86400000) })}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
