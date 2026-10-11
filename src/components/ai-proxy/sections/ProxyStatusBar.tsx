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

function InlineCopyField({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: (label: string, value: string, requireConfirm?: boolean) => void;
}) {
  return (
    <span className="flex min-w-0 items-center gap-0.5 rounded-md border border-white/[0.06] bg-black/30 px-2 py-1">
      <span className="max-w-[180px] truncate font-mono text-[11px] text-slate-300" title={value}>
        {value}
      </span>
      <Tooltip content={`${t('aiHub.actions.copy')} · ${label}`}>
        <IconButton
          size="sm"
          variant="ghost"
          onClick={() => onCopy(label, value)}
          aria-label={`${t('aiHub.actions.copy')} ${label}`}
        >
          <Copy size={12} />
        </IconButton>
      </Tooltip>
    </span>
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
    <div
      data-testid="proxy-status-bar"
      role="status"
      className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-1.5', tint)}
    >
      <span className="relative flex h-2.5 w-2.5 shrink-0 items-center justify-center">
        {running && !unreachable && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
        )}
        <span className={cn('relative h-2 w-2 rounded-full', dotTone)} />
      </span>
      <span
        className={cn(
          'shrink-0 text-xs font-semibold',
          unreachable ? 'text-red-300' : running ? 'text-emerald-300' : 'text-amber-300'
        )}
      >
        {unreachable
          ? t('aiHub.proxy.unreachable')
          : running
            ? t('aiHub.proxy.running')
            : t('aiHub.proxy.stopped')}
      </span>
      {secondaryLine && (
        <span className="hidden shrink-0 text-[10px] uppercase tracking-wider tabular-nums text-slate-500 md:inline">
          {secondaryLine}
        </span>
      )}

      <InlineCopyField label={t('aiHub.proxy.baseUrl')} value={baseUrl} onCopy={onCopy} />
      <InlineCopyField
        label={t('aiHub.proxy.clientApiKey')}
        value={clientApiKey}
        onCopy={onCopy}
      />

      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        <Button
          variant={running ? 'danger' : 'primary'}
          size="xs"
          leftIcon={<Power size={12} />}
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
            <RefreshCw size={13} className={cn(proxyBusy && 'animate-spin')} />
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
              <Settings size={13} />
            </IconButton>
          </Tooltip>
        )}
      </span>
    </div>
  );
}
