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

import { useAiProxyStore } from '../../stores/aiProxy';
import {
  getProxyStatus,
  startAiProxy,
  stopAiProxy,
} from '../../lib/tauri/modules/aiProxy';
import { getSettings, updateSettings } from '../../lib/tauri/modules/settings';
import {
  getBackgroundManagerConfig,
  updateBackgroundManagerConfig,
  type BackgroundManagerConfig,
} from '../../lib/tauri/modules/backgroundManager';
import {
  getScheduledTasks,
  getSchedulerStatus,
  startScheduler,
  stopScheduler,
} from '../../lib/tauri/modules/scheduler';

const POLL_INTERVAL_MS = 10_000;

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

  const [autoReplenishEnabled, setAutoReplenishEnabled] = useState(false);
  const [bgConfig, setBgConfig] = useState<BackgroundManagerConfig | null>(null);
  const [schedulerRunning, setSchedulerRunning] = useState(false);
  const [nextRunUnix, setNextRunUnix] = useState<number | null>(null);

  const [proxyBusy, setProxyBusy] = useState(false);
  const [schedulerBusy, setSchedulerBusy] = useState(false);

  const proxyRunning = proxyStatus?.running ?? false;
  const proxyPort = proxyStatus?.port ?? null;
  const bridgeOnline = true; // Python backend always available

  const refreshProxy = useCallback(async () => {
    try {
      const status = await getProxyStatus();
      setProxyStatus(status);
    } catch (err) {
      console.warn('[SystemStatusStrip] proxy status:', err);
    }
  }, [setProxyStatus]);

  const refreshScheduler = useCallback(async () => {
    try {
      const [running, tasks] = await Promise.all([
        getSchedulerStatus(),
        getScheduledTasks().catch(() => []),
      ]);
      setSchedulerRunning(running);
      const enabled = tasks.filter(task => task.enabled && task.nextRun > 0);
      setNextRunUnix(
        enabled.length > 0 ? Math.min(...enabled.map(task => task.nextRun)) : null
      );
    } catch (err) {
      console.warn('[SystemStatusStrip] scheduler status:', err);
    }
  }, []);

  const refreshSettings = useCallback(async () => {
    try {
      const settings = await getSettings();
      setAutoReplenishEnabled(Boolean(settings.autoReplenishEnabled));
    } catch (err) {
      console.warn('[SystemStatusStrip] settings:', err);
    }
  }, []);

  const refreshBackground = useCallback(async () => {
    try {
      setBgConfig(await getBackgroundManagerConfig());
    } catch (err) {
      console.warn('[SystemStatusStrip] background config:', err);
    }
  }, []);

  useEffect(() => {
    void refreshProxy();
    void refreshScheduler();
    void refreshSettings();
    void refreshBackground();
    const id = window.setInterval(() => {
      void refreshProxy();
      void refreshScheduler();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refreshProxy, refreshScheduler, refreshSettings, refreshBackground]);

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
      setAutoReplenishEnabled(next);
      try {
        await updateSettings({ autoReplenishEnabled: next });
      } catch (err) {
        console.error('[SystemStatusStrip] replenish toggle:', err);
        setAutoReplenishEnabled(!next);
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
      setBgConfig(updated);
      try {
        await updateBackgroundManagerConfig(updated);
      } catch (err) {
        console.error('[SystemStatusStrip] auto-switch toggle:', err);
        setBgConfig(previous);
        toast.error(t('dashboard.systemStrip.autoSwitch.toggleFailed'));
      }
    },
    [bgConfig]
  );

  const handleToggleScheduler = useCallback(async () => {
    setSchedulerBusy(true);
    try {
      if (schedulerRunning) {
        await stopScheduler();
        setSchedulerRunning(false);
      } else {
        await startScheduler();
        setSchedulerRunning(true);
      }
      void refreshScheduler();
    } catch (err) {
      console.error('[SystemStatusStrip] scheduler toggle:', err);
      toast.error(t('dashboard.systemStrip.scheduler.toggleFailed'));
    } finally {
      setSchedulerBusy(false);
    }
  }, [schedulerRunning, refreshScheduler]);

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
    if (!schedulerRunning) return t('dashboard.systemStrip.scheduler.stopped');
    if (nextRunUnix === null) {
      return t('dashboard.systemStrip.scheduler.runningNoNext');
    }
    return t('dashboard.systemStrip.scheduler.runningWithNext', {
      next: formatNextRun(nextRunUnix),
    });
  }, [schedulerBusy, schedulerRunning, nextRunUnix]);

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
          active={schedulerRunning}
          loading={schedulerBusy}
          tooltip={
            schedulerRunning
              ? t('dashboard.systemStrip.scheduler.tooltipStop')
              : t('dashboard.systemStrip.scheduler.tooltipStart')
          }
          control={
            <IconButton
              size="sm"
              variant={schedulerRunning ? 'danger' : 'success'}
              onClick={handleToggleScheduler}
              disabled={schedulerBusy}
              aria-label={
                schedulerRunning
                  ? t('dashboard.systemStrip.scheduler.tooltipStop')
                  : t('dashboard.systemStrip.scheduler.tooltipStart')
              }
            >
              {schedulerRunning ? <Pause size={12} /> : <Play size={12} />}
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
