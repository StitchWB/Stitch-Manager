import { useState } from 'react';
import { ChevronDown, Copy, Power, RefreshCw, Settings } from 'lucide-react';
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
  /** Single-line layout; base URL, client key, refresh and routing move behind a details toggle. */
  compact?: boolean;
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
  compact = false,
}: ProxyStatusBarProps) {
  const navigate = useNavigate();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const running = Boolean(proxyStatus?.running);
  const unreachable = running && Boolean(proxyStatus && !proxyStatus.networkReachable);

  const tint = unreachable
    ? 'border-red-500/20 bg-red-500/[0.04]'
    : running
      ? 'border-emerald-500/20 bg-emerald-500/[0.04]'
      : 'border-white/[0.06] bg-white/[0.02]';
  const dotTone = unreachable ? 'bg-red-400' : running ? 'bg-emerald-400' : 'bg-slate-500';

  const secondaryLine = [
    proxySettings?.appMode
      ? `${t('aiHub.proxy.modeLabel')}: ${proxySettings.appMode}`
      : null,
    proxyStatus?.port ? `${t('aiHub.proxy.portLabel')}: ${proxyStatus.port}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const statusDot = (
    <span className="relative flex h-2.5 w-2.5 shrink-0 items-center justify-center">
      {running && !unreachable && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
      )}
      <span className={cn('relative h-2 w-2 rounded-full', dotTone)} />
    </span>
  );

  const statusLabel = (
    <span
      className={cn(
        'shrink-0 text-xs font-semibold',
        unreachable ? 'text-red-300' : running ? 'text-emerald-300' : 'text-slate-400'
      )}
    >
      {unreachable
        ? t('aiHub.proxy.unreachable')
        : running
          ? t('aiHub.proxy.running')
          : t('aiHub.proxy.stopped')}
    </span>
  );

  const startStopButton = (
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
  );

  const refreshButton = (
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
  );

  const routingButton = !hideConfigureLink && (
    <Tooltip content={t('aiHub.tabs.routing')}>
      <IconButton
        size="sm"
        variant="ghost"
        onClick={() => navigate('/ai/routing?tab=rotation')}
        aria-label={t('aiHub.tabs.routing')}
      >
        <Settings size={13} />
      </IconButton>
    </Tooltip>
  );

  if (compact) {
    return (
      <div
        data-testid="proxy-status-bar"
        role="status"
        className={cn('rounded-lg border px-3 py-1.5', tint)}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {statusDot}
          {statusLabel}
          {proxyStatus?.port ? (
            <span className="shrink-0 text-[10px] uppercase tracking-wider tabular-nums text-slate-500">
              {t('aiHub.proxy.portLabel')}: {proxyStatus.port}
            </span>
          ) : null}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            <Button
              variant="ghost"
              size="xs"
              rightIcon={<ChevronDown size={12} className={cn(detailsOpen && 'rotate-180')} />}
              onClick={() => setDetailsOpen(open => !open)}
              aria-expanded={detailsOpen}
            >
              {t('aiHub.proxy.details')}
            </Button>
            {startStopButton}
          </span>
        </div>
        {detailsOpen && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-white/[0.06] pt-1.5">
            <InlineCopyField label={t('aiHub.proxy.baseUrl')} value={baseUrl} onCopy={onCopy} />
            <InlineCopyField
              label={t('aiHub.proxy.clientApiKey')}
              value={clientApiKey}
              onCopy={onCopy}
            />
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              {refreshButton}
              {routingButton}
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="proxy-status-bar"
      role="status"
      className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-1.5', tint)}
    >
      {statusDot}
      {statusLabel}
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
        {startStopButton}
        {refreshButton}
        {routingButton}
      </span>
    </div>
  );
}
