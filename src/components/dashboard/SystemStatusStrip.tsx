import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Calendar,
  Loader2,
  Pause,
  Play,
  Repeat,
  Server,
  Shield,
} from 'lucide-react';
import { toast } from 'sonner';

import { t } from '@/lib/i18n';
import { GlassCard, IconButton, Toggle, Tooltip } from '@/components/ui';
import { cn } from '@/lib/utils';

import { useAiProxyStore, startProxyStatusPolling, stopProxyStatusPolling } from '../../stores/aiProxy';
import {
  startAiProxy,
  stopAiProxy,
} from '../../lib/backend/modules/aiProxy';
import { updateSettings } from '../../lib/backend/modules/settings';
import {
  updateBackgroundManagerConfig,
  type BackgroundManagerConfig,
} from '../../lib/backend/modules/backgroundManager';
import {
  useSchedulerStore,
  startTaskPolling,
  stopTaskPolling,
  startSchedulerStatusPolling,
  stopSchedulerStatusPolling,
} from '../../stores/scheduler';
import { useSettingsStore } from '../../stores/settings';

function formatNextRun(unixSeconds: number | null): string {
  if (!unixSeconds) return t('dashboard.systemStrip.scheduler.noNextRun');
  const date = new Date(unixSeconds * 1000);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const sameDay = date.toDateString() === now.toDateString();
  if (diffMs <= 0) return t('dashboard.systemStrip.scheduler.due');
  if (sameDay) {
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface CellProps {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  active: boolean;
  warning?: boolean;
  loading?: boolean;
  control?: React.ReactNode;
  tooltip?: string;
}

function StatusCell({
  icon,
  label,
  value,
  active,
  warning,
  loading,
  control,
  tooltip,
}: CellProps) {
  const dotClass = warning
    ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]'
    : active
      ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]'
      : 'bg-slate-600';

  const content = (
    <GlassCard className="flex items-center gap-2 px-3 py-2 h-full">
      <span className="relative flex items-center justify-center w-7 h-7 rounded-md bg-white/[0.04] text-slate-300 shrink-0">
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
      </span>
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', dotClass)} />
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-[10px] uppercase tracking-wider text-slate-500 truncate">
          {label}
        </span>
        <span className="text-xs text-slate-200 font-medium tabular-nums truncate">{value}</span>
      </div>
      {control && <div className="ml-auto shrink-0">{control}</div>}
    </GlassCard>
  );

  return tooltip ? <Tooltip content={tooltip}>{content}</Tooltip> : content;
}

export function SystemStatusStrip() {
  const proxyStatus = useAiProxyStore(state => state.status);
  const setProxyStatus = useAiProxyStore(state => state.setStatus);

  // Read from settings store instead of fetching
  const settings = useSettingsStore(state => state.settings);
  const bgConfig = useSettingsStore(state => state.backgroundManagerConfig);
  
  const autoReplenishEnabled = Boolean(settings?.autoReplenishEnabled);
  const [nextRunUnix, setNextRunUnix] = useState<number | null>(null);

  const tasks = useSchedulerStore(state => state.tasks);
  const isRunning = useSchedulerStore(state => state.isRunning);
  const startScheduler = useSchedulerStore(state => state.startScheduler);
  const stopScheduler = useSchedulerStore(state => state.stopScheduler);

  const [proxyBusy, setProxyBusy] = useState(false);
  const [schedulerBusy, setSchedulerBusy] = useState(false);

  const proxyRunning = proxyStatus?.running ?? false;
  const proxyPort = proxyStatus?.port ?? null;
  const bridgeOnline = true; // Python backend always available

  // Derive nextRun from store tasks (polled centrally) instead of fetching.
  useEffect(() => {
    const enabled = tasks.filter(task => task.enabled && task.nextRun > 0);
    setNextRunUnix(
      enabled.length > 0 ? Math.min(...enabled.map(task => task.nextRun)) : null
    );
  }, [tasks]);

  useEffect(() => {
    startProxyStatusPolling();
    startSchedulerStatusPolling();
    startTaskPolling();
    return () => {
      stopProxyStatusPolling();
      stopSchedulerStatusPolling();
      stopTaskPolling();
    };
  }, []);

  const handleToggleProxy = useCallback(async () => {
    setProxyBusy(true);
    try {
      const next = proxyRunning ? await stopAiProxy() : await startAiProxy();
      setProxyStatus(next);
    } catch (err) {
      console.error('[SystemStatusStrip] proxy toggle:', err);
      toast.error(t('dashboard.systemStrip.proxy.toggleFailed'));
    } finally {
      setProxyBusy(false);
    }
  }, [proxyRunning, setProxyStatus]);

  const handleToggleReplenish = useCallback(
    async (next: boolean) => {
      // Optimistic update
      const prev = useSettingsStore.getState().settings;
      useSettingsStore.setState({ settings: { ...prev, autoReplenishEnabled: next } as any });
      try {
        await updateSettings({ autoReplenishEnabled: next });
      } catch (err) {
        console.error('[SystemStatusStrip] replenish toggle:', err);
        useSettingsStore.setState({ settings: prev });
        toast.error(t('dashboard.systemStrip.replenish.toggleFailed'));
      }
    },
    []
  );

  const handleToggleAutoSwitch = useCallback(
    async (next: boolean) => {
      if (!bgConfig) return;
      const previous = bgConfig;
      const updated: BackgroundManagerConfig = { ...bgConfig, autoSwitchEnabled: next };
      // Optimistic update
      useSettingsStore.getState().setBackgroundManagerConfig(updated);
      try {
        await updateBackgroundManagerConfig(updated);
      } catch (err) {
        console.error('[SystemStatusStrip] auto-switch toggle:', err);
        useSettingsStore.getState().setBackgroundManagerConfig(previous);
        toast.error(t('dashboard.systemStrip.autoSwitch.toggleFailed'));
      }
    },
    [bgConfig]
  );

  const handleToggleScheduler = useCallback(async () => {
    setSchedulerBusy(true);
    try {
      if (isRunning) {
        await stopScheduler();
      } else {
        await startScheduler();
      }
    } catch (err) {
      console.error('[SystemStatusStrip] scheduler toggle:', err);
      toast.error(t('dashboard.systemStrip.scheduler.toggleFailed'));
    } finally {
      setSchedulerBusy(false);
    }
  }, [isRunning, startScheduler, stopScheduler]);

  const proxyValue = useMemo(() => {
    if (proxyBusy) return t('common.loading');
    if (proxyRunning) {
      return proxyPort
        ? t('dashboard.systemStrip.proxy.runningAt', { port: proxyPort })
        : t('dashboard.systemStrip.proxy.running');
    }
    return t('dashboard.systemStrip.proxy.stopped');
  }, [proxyBusy, proxyRunning, proxyPort]);

  const schedulerValue = useMemo(() => {
    if (schedulerBusy) return t('common.loading');
    if (!isRunning) return t('dashboard.systemStrip.scheduler.stopped');
    if (nextRunUnix === null) {
      return t('dashboard.systemStrip.scheduler.runningNoNext');
    }
    return t('dashboard.systemStrip.scheduler.runningWithNext', {
      next: formatNextRun(nextRunUnix),
    });
  }, [schedulerBusy, isRunning, nextRunUnix]);

  return (
    <section
      aria-label={t('dashboard.systemStrip.ariaLabel')}
      className="flex flex-wrap gap-2 p-2 rounded-xl bg-white/[0.02] border border-white/[0.06]"
    >
      <div className="flex-1 basis-[200px] min-w-[180px]">
        <StatusCell
          icon={<Server size={14} />}
          label={t('dashboard.systemStrip.proxy.label')}
          value={proxyValue}
          active={proxyRunning}
          loading={proxyBusy}
          tooltip={
            proxyRunning
              ? t('dashboard.systemStrip.proxy.tooltipStop')
              : t('dashboard.systemStrip.proxy.tooltipStart')
          }
          control={
            <IconButton
              size="sm"
              variant={proxyRunning ? 'danger' : 'success'}
              onClick={handleToggleProxy}
              disabled={proxyBusy}
              aria-label={
                proxyRunning
                  ? t('dashboard.systemStrip.proxy.tooltipStop')
                  : t('dashboard.systemStrip.proxy.tooltipStart')
              }
            >
              {proxyRunning ? <Pause size={12} /> : <Play size={12} />}
            </IconButton>
          }
        />
      </div>

      <div className="flex-1 basis-[200px] min-w-[180px]">
        <StatusCell
          icon={<Activity size={14} />}
          label={t('dashboard.systemStrip.replenish.label')}
          value={
            autoReplenishEnabled
              ? t('dashboard.systemStrip.stateOn')
              : t('dashboard.systemStrip.stateOff')
          }
          active={autoReplenishEnabled}
          tooltip={t('dashboard.systemStrip.replenish.tooltip')}
          control={
            <Toggle
              label=""
              checked={autoReplenishEnabled}
              onChange={handleToggleReplenish}
            />
          }
        />
      </div>

      <div className="flex-1 basis-[200px] min-w-[180px]">
        <StatusCell
          icon={<Repeat size={14} />}
          label={t('dashboard.systemStrip.autoSwitch.label')}
          value={
            bgConfig?.autoSwitchEnabled
              ? t('dashboard.systemStrip.stateOn')
              : t('dashboard.systemStrip.stateOff')
          }
          active={Boolean(bgConfig?.autoSwitchEnabled)}
          warning={Boolean(bgConfig?.autoSwitchEnabled) && !proxyRunning}
          tooltip={
            proxyRunning
              ? t('dashboard.systemStrip.autoSwitch.tooltip')
              : t('dashboard.systemStrip.autoSwitch.tooltipDisabled')
          }
          control={
            <Toggle
              label=""
              checked={Boolean(bgConfig?.autoSwitchEnabled)}
              onChange={handleToggleAutoSwitch}
              disabled={!bgConfig || !proxyRunning}
            />
          }
        />
      </div>

      <div className="flex-1 basis-[200px] min-w-[180px]">
        <StatusCell
          icon={<Calendar size={14} />}
          label={t('dashboard.systemStrip.scheduler.label')}
          value={schedulerValue}
          active={isRunning}
          loading={schedulerBusy}
          tooltip={
            isRunning
              ? t('dashboard.systemStrip.scheduler.tooltipStop')
              : t('dashboard.systemStrip.scheduler.tooltipStart')
          }
          control={
            <IconButton
              size="sm"
              variant={isRunning ? 'danger' : 'success'}
              onClick={handleToggleScheduler}
              disabled={schedulerBusy}
              aria-label={
                isRunning
                  ? t('dashboard.systemStrip.scheduler.tooltipStop')
                  : t('dashboard.systemStrip.scheduler.tooltipStart')
              }
            >
              {isRunning ? <Pause size={12} /> : <Play size={12} />}
            </IconButton>
          }
        />
      </div>

      <div className="flex-1 basis-[160px] min-w-[140px]">
        <StatusCell
          icon={<Shield size={14} />}
          label={t('dashboard.systemStrip.bridge.label')}
          value={
            bridgeOnline
              ? t('dashboard.systemStrip.bridge.online')
              : t('dashboard.systemStrip.bridge.offline')
          }
          active={bridgeOnline}
          warning={!bridgeOnline}
          tooltip={t('dashboard.systemStrip.bridge.tooltip')}
        />
      </div>
    </section>
  );
}
