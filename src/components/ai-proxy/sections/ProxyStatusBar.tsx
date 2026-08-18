import { Copy, Power, RefreshCw, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { t } from '@/lib/i18n';
import { Button, IconButton, StatusBadge, Tooltip } from '@/components/ui';
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
  onCopy: (label: string, value: string) => void;
  /** When false (default), shows a "Configure" button that links to /ai/routing.
   *  When true, hides it (used inside the Routing tab itself). */
  hideConfigureLink?: boolean;
}

/**
 * Thin status bar for AI Proxy. Read-only on Providers tab.
 * Shows: state pill, mode, port, base URL + copy, client api key + copy,
 * start/stop button, refresh, and a "Configure" deep-link to Routing.
 */
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
  const isExternallyRunning = Boolean(running && !proxyStatus?.managedByApp);

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl border border-white/[0.06] bg-white/[0.02]">
      <StatusBadge
        status={running ? 'active' : 'inactive'}
        size="sm"
        withDot
        withPulse={running}
      >
        {running
          ? isExternallyRunning
            ? t('aiHub.proxy.running')
            : t('aiHub.proxy.running')
          : t('aiHub.proxy.stopped')}
      </StatusBadge>

      {proxySettings?.appMode && (
        <span className="text-[10px] uppercase tracking-wider text-slate-500">
          {t('aiHub.proxy.modeLabel')}:{' '}
          <span className="text-slate-300 normal-case">{proxySettings.appMode}</span>
        </span>
      )}

      {proxyStatus?.port && (
        <span className="text-[10px] uppercase tracking-wider text-slate-500 tabular-nums">
          {t('aiHub.proxy.portLabel')}:{' '}
          <span className="text-slate-300">{proxyStatus.port}</span>
        </span>
      )}

      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/30 border border-white/10">
        <span className="text-[10px] uppercase tracking-wider text-slate-500">
          {t('aiHub.proxy.baseUrl')}
        </span>
        <span className="font-mono text-[11px] text-slate-200 max-w-[180px] truncate">
          {baseUrl}
        </span>
        <Tooltip content={t('aiHub.actions.copy')}>
          <IconButton
            size="sm"
            variant="ghost"
            onClick={() => onCopy(t('aiHub.proxy.baseUrl'), baseUrl)}
            aria-label={t('aiHub.actions.copy')}
          >
            <Copy size={12} />
          </IconButton>
        </Tooltip>
      </div>

      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/30 border border-white/10">
        <span className="text-[10px] uppercase tracking-wider text-slate-500">
          {t('aiHub.proxy.clientApiKey')}
        </span>
        <span className="font-mono text-[11px] text-slate-200 max-w-[140px] truncate">
          {clientApiKey}
        </span>
        <Tooltip content={t('aiHub.actions.copy')}>
          <IconButton
            size="sm"
            variant="ghost"
            onClick={() => onCopy(t('aiHub.proxy.clientApiKey'), clientApiKey)}
            aria-label={t('aiHub.actions.copy')}
          >
            <Copy size={12} />
          </IconButton>
        </Tooltip>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button
          variant={running ? 'danger' : 'primary'}
          size="xs"
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
  );
}
