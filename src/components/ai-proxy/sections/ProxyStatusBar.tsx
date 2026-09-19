import { Copy, Power, RefreshCw, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { t } from '@/lib/i18n';
import { Button, IconButton, Tooltip } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { ProxyStatus, ProxySettings } from '../../../types/generated';

export interface ProxyStatusBarProps {
  proxyStatus: ProxyStatus | null;
  proxySettings: ProxySettings | null;
  baseUrl: string;
  clientApiKey: string;
  proxyBusy: boolean;
  proxySaving: boolean;
  onStartStopProxy: () => void;
  onRefreshProxyInfo: () => void;
  onCopy: (label: string, value: string, requireConfirm?: boolean) => void;
  /** When false (default), shows a "Configure" button that links to /ai/routing.
   *  When true, hides it (used inside the Routing tab itself). */
  hideConfigureLink?: boolean;
}

function CopyField({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: (label: string, value: string, requireConfirm?: boolean) => void;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-0.5 flex items-center gap-1 rounded-md border border-white/[0.06] bg-black/30 px-2 py-1">
        <span className="truncate font-mono text-[11px] text-slate-200" title={value}>
          {value}
        </span>
        <Tooltip content={t('aiHub.actions.copy')}>
          <IconButton
            size="sm"
            variant="ghost"
            onClick={() => onCopy(label, value)}
            aria-label={t('aiHub.actions.copy')}
          >
            <Copy size={12} />
          </IconButton>
        </Tooltip>
      </div>
    </div>
  );
}

export function ProxyStatusBar({
  proxyStatus,
  proxySettings,
  baseUrl,
  clientApiKey,
  proxyBusy,
  proxySaving,
  onStartStopProxy,
  onRefreshProxyInfo,
  onCopy,
  hideConfigureLink = false,
}: ProxyStatusBarProps) {
  const navigate = useNavigate();
  const running = Boolean(proxyStatus?.running);
  const unreachable = running && Boolean(proxyStatus && !proxyStatus.networkReachable);

  const tint = unreachable
    ? 'border-red-500/20 bg-red-500/[0.04]'
    : running
      ? 'border-emerald-500/20 bg-emerald-500/[0.04]'
      : 'border-amber-500/20 bg-amber-500/[0.04]';
  const dotTone = unreachable ? 'bg-red-400' : running ? 'bg-emerald-400' : 'bg-amber-400';

  const secondaryLine = [
    proxySettings?.appMode
      ? `${t('aiHub.proxy.modeLabel')}: ${proxySettings.appMode}`
      : null,
    proxyStatus?.port ? `${t('aiHub.proxy.portLabel')}: ${proxyStatus.port}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={cn('rounded-xl border px-4 py-3', tint)}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3 shrink-0 items-center justify-center">
            {running && !unreachable && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
            )}
            <span className={cn('relative h-2.5 w-2.5 rounded-full', dotTone)} />
          </span>
          <div>
            <div className="text-sm font-semibold text-white">
              {running ? t('aiHub.proxy.running') : t('aiHub.proxy.stopped')}
            </div>
            {unreachable && (
              <div className="text-[10px] font-medium text-red-300">
                {t('aiHub.proxy.unreachable')}
              </div>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-4 gap-y-2">
          <CopyField label={t('aiHub.proxy.baseUrl')} value={baseUrl} onCopy={onCopy} />
          <CopyField
            label={t('aiHub.proxy.clientApiKey')}
            value={clientApiKey}
            onCopy={onCopy}
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant={running ? 'danger' : 'primary'}
            size="sm"
            leftIcon={<Power size={14} />}
            onClick={onStartStopProxy}
            disabled={proxyBusy || proxySaving}
          >
            {proxyBusy
              ? t('aiHub.actions.working')
              : running
                ? t('aiHub.actions.stopProxy')
                : t('aiHub.actions.startProxy')}
          </Button>

          <Tooltip content={t('aiHub.actions.refresh')}>
            <IconButton
              size="sm"
              variant="ghost"
              onClick={onRefreshProxyInfo}
              disabled={proxyBusy || proxySaving}
              aria-label={t('aiHub.actions.refresh')}
            >
              <RefreshCw size={14} className={cn(proxyBusy && 'animate-spin')} />
            </IconButton>
          </Tooltip>

          {!hideConfigureLink && (
            <Tooltip content={t('aiHub.tabs.routing')}>
              <IconButton
                size="sm"
                variant="ghost"
                onClick={() => navigate('/ai/routing')}
                aria-label={t('aiHub.tabs.routing')}
              >
                <Settings size={14} />
              </IconButton>
            </Tooltip>
          )}
        </div>
      </div>

      {secondaryLine && (
        <div className="mt-2 text-[10px] uppercase tracking-wider text-slate-500 tabular-nums">
          {secondaryLine}
        </div>
      )}
    </div>
  );
}
