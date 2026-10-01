import { FolderOpen, Cookie } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { getProvider } from '@/constants/providers';
import type { ProviderName } from '@/types/ui';
import { Badge } from '@/components/ui/Badge';
import { IconButton } from '@/components/ui/IconButton';
import { Tooltip } from '@/components/ui/Tooltip';
import { ButtonBase } from '@/components/ui/ButtonBase';
import { AccountProxySection } from '@/components/ui/AccountProxySection';
import { AccountProfileSessionSection } from '@/components/ui/account-details/AccountProfileSessionSection';
import { openInFileManager } from '@/lib/backend';
import type { Account } from '@/types/generated';
import type { useAccountRowData } from '@/hooks/useAccountRow';

interface SessionTabProps {
  account: Account;
  cookiesCount: number;
  showSessionData: boolean;
  setShowSessionData: (v: boolean) => void;
  copy: (text: string, opts?: { sensitive?: boolean; successMessage?: string }) => void;
  data: ReturnType<typeof useAccountRowData>;
  onOpenProfileSession?: (id: number) => void;
  onConfirmProfileSession?: (id: number) => void;
  onClearProfileSession?: (id: number) => void;
  onOpenWebLogin?: (id: number) => void;
  onCaptureWebCookies?: (id: number) => void;
  onRefresh?: (id: number) => void;
}

export function SessionTab({
  account,
  cookiesCount,
  showSessionData,
  setShowSessionData,
  copy,
  data,
  onOpenProfileSession,
  onConfirmProfileSession,
  onClearProfileSession,
  onOpenWebLogin,
  onCaptureWebCookies,
  onRefresh,
}: SessionTabProps) {
  const formatSessionJSON = (jsonString: string | null): string => {
    if (!jsonString) return t('accounts.notAvailable');
    try {
      return JSON.stringify(JSON.parse(jsonString), null, 2);
    } catch {
      return jsonString;
    }
  };

  return (
    <>
      {/* Session & Profile */}
      <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
        <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium px-3 pt-2.5 pb-2 border-b border-white/[0.04]">
          {t('accounts.drawer.sessionProfile')}
        </h3>
        <div className="divide-y divide-white/[0.04]">
          {/* Browser Profile */}
          <div className="flex items-center justify-between gap-2 px-3 py-1.5">
            <span className="text-[11px] text-slate-500 shrink-0 w-20">{t('accounts.browserProfilePath')}</span>
            <div className="flex items-center gap-1 min-w-0 flex-1 justify-end">
              {account.browserProfilePath ? (
                <>
                  <FolderOpen size={11} className="text-slate-500 shrink-0" />
                  <span className="text-[10px] text-slate-300 font-mono truncate max-w-[180px]" title={account.browserProfilePath}>
                    {account.browserProfilePath.split(/[/\\]/).slice(-2).join('/')}
                  </span>
                  <Tooltip content={t('accounts.drawer.openFolder')}>
                    <IconButton type="button" size="sm" variant="ghost" className="h-5 w-5 shrink-0 text-slate-500 hover:text-white"
                      onClick={() => { void openInFileManager({ path: account.browserProfilePath! }); }}>
                      <FolderOpen size={10} />
                    </IconButton>
                  </Tooltip>
                </>
              ) : (
                <span className="text-[11px] text-slate-600 italic">{t('accounts.drawer.noData')}</span>
              )}
            </div>
          </div>
          {/* Cookies */}
          <div className="flex items-center justify-between gap-2 px-3 py-1.5">
            <span className="text-[11px] text-slate-500 shrink-0 w-20">{t('accounts.drawer.cookies')}</span>
            <div className="flex items-center gap-1">
              {cookiesCount > 0 ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/15 text-[10px] text-amber-300">
                  <Cookie size={9} />
                  {cookiesCount} {t('accounts.drawer.cookies')}
                </span>
              ) : (
                <span className="text-[11px] text-slate-600 italic">{t('accounts.drawer.noCookies')}</span>
              )}
            </div>
          </div>
          {/* Session Status */}
          <div className="flex items-center justify-between gap-2 px-3 py-1.5">
            <span className="text-[11px] text-slate-500 shrink-0 w-20">{t('accounts.drawer.session')}</span>
            <Badge variant={account.sessionData ? 'success' : 'default'} size="sm" withDot className="normal-case tracking-normal">
              {account.sessionData ? t('status.active') : t('status.offline')}
            </Badge>
          </div>
        </div>
      </div>

      {/* Session data with show/copy */}
      {account.sessionData && (
        <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-3 pt-2.5 pb-2 border-b border-white/[0.04]">
            <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">{t('accounts.sessionData')}</h3>
            <div className="flex items-center gap-2">
              {showSessionData && (
                <ButtonBase
                  onClick={() => copy(account.sessionData!, { sensitive: true, successMessage: t('common.copy') })}
                  className="text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-white transition-colors"
                >
                  {t('common.copy')}
                </ButtonBase>
              )}
              <ButtonBase
                onClick={() => setShowSessionData(!showSessionData)}
                className={cn(
                  'text-[10px] font-bold uppercase tracking-widest transition-colors',
                  showSessionData ? 'text-amber-300 hover:text-amber-200' : 'text-slate-400 hover:text-white',
                )}
              >
                {showSessionData ? t('accounts.hide') : t('accounts.reveal')}
              </ButtonBase>
            </div>
          </div>
          {!showSessionData ? (
            <div className="text-[10px] font-mono p-2 bg-black/20 text-slate-500">
              {t('accounts.sessionDataHidden')}
            </div>
          ) : (
            <pre className="text-[10px] font-mono p-2 bg-black/20 text-slate-400 overflow-auto max-h-32 whitespace-pre-wrap break-all">
              {formatSessionJSON(account.sessionData)}
            </pre>
          )}
        </div>
      )}

      {/* Profile session controls (+ web-session harvest for web2api providers) */}
      <AccountProfileSessionSection
        tagsList={data.tags}
        onOpenProfileSession={onOpenProfileSession ? () => onOpenProfileSession(account.id) : undefined}
        onConfirmProfileSession={onConfirmProfileSession ? () => onConfirmProfileSession(account.id) : undefined}
        onClearProfileSession={onClearProfileSession ? () => onClearProfileSession(account.id) : undefined}
        isWebSession={getProvider(account.provider as ProviderName)?.webSession === true}
        onOpenWebLogin={onOpenWebLogin ? () => onOpenWebLogin(account.id) : undefined}
        onCaptureWebCookies={onCaptureWebCookies ? () => onCaptureWebCookies(account.id) : undefined}
        compact
      />

      {/* Proxy — rendered directly, not inside CollapsibleSection */}
      <div>
        <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-2">
          {t('accounts.drawer.proxy')}
        </h3>
        <AccountProxySection
          accountId={account.id}
          proxyId={account.proxyId}
          onProxyChanged={() => onRefresh?.(account.id)}
        />
      </div>
    </>
  );
}
