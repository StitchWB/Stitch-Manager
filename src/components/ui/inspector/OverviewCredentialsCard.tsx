import {
  Copy,
  RefreshCw,
  Eye,
  EyeOff,
} from 'lucide-react';
import { t } from '@/lib/i18n';
import { IconButton } from '@/components/ui/IconButton';
import type { Account } from '@/types/generated';

interface OverviewCredentialsCardProps {
  account: Account;
  showToken: boolean;
  setShowToken: (v: boolean) => void;
  showPassword: boolean;
  setShowPassword: (v: boolean) => void;
  isRefreshingToken: boolean;
  handleRefreshToken: () => void;
  onCopyToken: (token: string) => void;
  copy: (text: string, opts?: { sensitive?: boolean; successMessage?: string }) => void;
}

export function OverviewCredentialsCard({
  account,
  showToken,
  setShowToken,
  showPassword,
  setShowPassword,
  isRefreshingToken,
  handleRefreshToken,
  onCopyToken,
  copy,
}: OverviewCredentialsCardProps) {
  return (
    <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
      <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium px-3 pt-2.5 pb-2 border-b border-white/[0.04]">
        {t('accounts.drawer.credentials')}
      </h3>
      <div className="divide-y divide-white/[0.04]">
        {/* Email */}
        <div className="flex items-center justify-between gap-2 px-3 py-1.5">
          <span className="text-[11px] text-slate-500 shrink-0 w-20">{t('accounts.email')}</span>
          <div className="flex items-center gap-1 min-w-0 flex-1 justify-end">
            <span className="text-xs text-slate-200 truncate">{account.email}</span>
            <IconButton type="button" size="sm" variant="ghost" className="h-5 w-5 shrink-0 text-slate-500 hover:text-white"
              onClick={() => copy(account.email, { successMessage: t('accounts.quickActions.emailCopied') })}>
              <Copy size={10} />
            </IconButton>
          </div>
        </div>
        {/* Password */}
        <div className="flex items-center justify-between gap-2 px-3 py-1.5">
          <span className="text-[11px] text-slate-500 shrink-0 w-20">{t('accounts.password')}</span>
          <div className="flex items-center gap-1 min-w-0 flex-1 justify-end">
            {account.registrationPassword ? (
              <>
                <span className="text-xs text-slate-200 font-mono truncate">
                  {showPassword ? account.registrationPassword : '••••••••'}
                </span>
                <IconButton type="button" size="sm" variant="ghost" className="h-5 w-5 shrink-0 text-slate-500 hover:text-white"
                  onClick={() => setShowPassword(!showPassword)}>
                  {showPassword ? <EyeOff size={10} /> : <Eye size={10} />}
                </IconButton>
                <IconButton type="button" size="sm" variant="ghost" className="h-5 w-5 shrink-0 text-slate-500 hover:text-white"
                  onClick={() => copy(account.registrationPassword!, { sensitive: true, successMessage: t('accounts.quickActions.passwordCopied') })}>
                  <Copy size={10} />
                </IconButton>
              </>
            ) : (
              <span className="text-[11px] text-slate-600 italic">{t('accounts.drawer.noData')}</span>
            )}
          </div>
        </div>
        {/* Token */}
        <div className="flex items-center justify-between gap-2 px-3 py-1.5">
          <span className="text-[11px] text-slate-500 shrink-0 w-20">{t('accounts.authToken')}</span>
          <div className="flex items-center gap-1 min-w-0 flex-1 justify-end">
            {account.token ? (
              <>
                <span className="text-xs text-slate-200 font-mono truncate max-w-[140px]">
                  {showToken ? account.token : '••••••••••••'}
                </span>
                <IconButton type="button" size="sm" variant="ghost" className="h-5 w-5 shrink-0 text-slate-500 hover:text-white"
                  onClick={() => setShowToken(!showToken)}>
                  {showToken ? <EyeOff size={10} /> : <Eye size={10} />}
                </IconButton>
                <IconButton type="button" size="sm" variant="ghost" className="h-5 w-5 shrink-0 text-slate-500 hover:text-white"
                  onClick={() => onCopyToken(account.token!)}>
                  <Copy size={10} />
                </IconButton>
                {account.refreshToken && (
                  <IconButton type="button" size="sm" variant="ghost" className="h-5 w-5 shrink-0 text-slate-500 hover:text-indigo-400"
                    disabled={isRefreshingToken} onClick={handleRefreshToken}>
                    <RefreshCw size={10} />
                  </IconButton>
                )}
              </>
            ) : (
              <span className="text-[11px] text-slate-600 italic">{t('accounts.drawer.noData')}</span>
            )}
          </div>
        </div>
        {/* Machine ID */}
        <div className="flex items-center justify-between gap-2 px-3 py-1.5">
          <span className="text-[11px] text-slate-500 shrink-0 w-20">{t('accounts.machineId')}</span>
          <div className="flex items-center gap-1 min-w-0 flex-1 justify-end">
            {account.machineId ? (
              <>
                <span className="text-[10px] text-slate-300 font-mono truncate">{account.machineId}</span>
                <IconButton type="button" size="sm" variant="ghost" className="h-5 w-5 shrink-0 text-slate-500 hover:text-white"
                  onClick={() => copy(account.machineId!, { successMessage: t('accounts.drawer.machineIdCopied') })}>
                  <Copy size={10} />
                </IconButton>
              </>
            ) : (
              <span className="text-[11px] text-slate-600 italic">{t('accounts.drawer.noData')}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
