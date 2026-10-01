import { AlertTriangle, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { Toggle } from '@/components/ui/Toggle';
import { ButtonBase } from '@/components/ui/ButtonBase';
import type { Account } from '@/types/generated';
import { formatRelativeTime } from './helpers';

interface ActivityTabProps {
  account: Account;
  autoRefreshEnabled: boolean;
  onToggleAutoRefreshQuota?: (account: Account) => void;
  onOpenLogs: () => void;
}

export function ActivityTab({ account, autoRefreshEnabled, onToggleAutoRefreshQuota, onOpenLogs }: ActivityTabProps) {
  return (
    <>
      {/* Last error prominent block */}
      {account.lastError && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle size={12} className="text-red-400 shrink-0" />
            <span className="text-[10px] uppercase tracking-wider text-red-400/70 font-medium">
              {t('accounts.lastError')}
            </span>
          </div>
          <p className="text-xs text-red-300 break-words">{account.lastError}</p>
        </div>
      )}

      {/* Activity rows */}
      <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
        <div className="divide-y divide-white/[0.04]">
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="text-[11px] text-slate-500">{t('accounts.inspector.useCount')}</span>
            <span className="text-xs text-slate-200 tabular-nums">{account.useCount || 0}</span>
          </div>
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="text-[11px] text-slate-500">{t('accounts.inspector.loginCount')}</span>
            <span className="text-xs text-slate-200 tabular-nums">{account.loginCount || 0}</span>
          </div>
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="text-[11px] text-slate-500">{t('accounts.errorsLabel')}</span>
            <span className={cn('text-xs tabular-nums', account.errorCount > 0 ? 'text-red-400' : 'text-slate-200')}>
              {account.errorCount || 0}
            </span>
          </div>
          {account.lastLoginAt && (
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="text-[11px] text-slate-500">{t('accounts.lastLoginAt')}</span>
              <span className="text-xs text-slate-300">{formatRelativeTime(account.lastLoginAt)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Auto-refresh quota toggle */}
      {onToggleAutoRefreshQuota && (
        <div className="rounded-lg bg-white/[0.02] border border-white/10 px-3 py-2.5">
          <Toggle
            label={t('accounts.inspector.autoRefreshQuota')}
            checked={autoRefreshEnabled}
            onChange={() => onToggleAutoRefreshQuota(account)}
            size="sm"
          />
        </div>
      )}

      {/* Open logs button */}
      <ButtonBase
        type="button"
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
        onClick={onOpenLogs}
      >
        <FileText size={12} />
        {t('accounts.inspector.openLogsForAccount')}
      </ButtonBase>
    </>
  );
}
