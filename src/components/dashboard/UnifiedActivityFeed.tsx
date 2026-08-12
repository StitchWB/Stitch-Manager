import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, RefreshCw, ShieldAlert, Trash2, UserPlus, Workflow, Zap } from 'lucide-react';

import { t } from '@/lib/i18n';
import { Button, ButtonBase } from '@/components/ui';
import { cn } from '@/lib/utils';

import { useLogsStore } from '../../stores/logs';
import { useAccountsStore } from '../../stores/accounts';
import { useSchedulerStore, startTaskPolling, stopTaskPolling } from '../../stores/scheduler';
import {
  getRegistrationJobs,
  clearRegistrationJobs,
} from '../../lib/backend/modules/registration';
import { getTaskExecutions } from '../../lib/backend/modules/scheduler';
import type { RegistrationJob } from '../../types/ui';

import { ActivityItem } from './ActivityItem';

type FeedChannel = 'all' | 'newAccounts' | 'reg' | 'scheduler' | 'proxy';
type ItemStatus = 'success' | 'pending' | 'failed';

interface FeedItem {
  id: string;
  status: ItemStatus;
  channel: Exclude<FeedChannel, 'all'>;
  title: string;
  description: string;
  timestampMs: number;
  onOpen?: () => void;
}

const POLL_MS = 10_000;
const MAX_ITEMS_PER_CHANNEL = 8;
const MAX_VISIBLE = 12;

const PROXY_SOURCES = ['ai-proxy', 'background', 'background_manager', 'replenishment', 'router'];

function formatTimestamp(ms: number): string {
  const diffMs = Date.now() - ms;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return t('time.justNow');
  if (diffMin < 60) return t('time.minutesAgo', { count: diffMin });
  if (diffMin < 1440) return t('time.hoursAgo', { count: Math.floor(diffMin / 60) });
  return new Date(ms).toLocaleDateString();
}

function jobToItem(job: RegistrationJob): FeedItem {
  const failedSet = new Set(['failed', 'cancelled']);
  const successSet = new Set(['completed']);
  const itemStatus: ItemStatus = failedSet.has(job.status)
    ? 'failed'
    : successSet.has(job.status)
      ? 'success'
      : 'pending';

  let description = `${job.provider} · ${job.status}`;
  if (itemStatus === 'failed' && job.error) {
    let cleaned = job.error
      .replace(/[\u4e00-\u9fff]/g, '')
      .replace(/\{[^}]*\}/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length > 50) cleaned = cleaned.substring(0, 47) + '...';
    if (cleaned) description = cleaned;
  }
  return {
    id: `reg:${job.id}`,
    status: itemStatus,
    channel: 'reg',
    title: job.email || `Registration ${String(job.id).slice(0, 8)}`,
    description,
    timestampMs: new Date(job.createdAt).getTime(),
  };
}

export function UnifiedActivityFeed() {
  const navigate = useNavigate();
  const logs = useLogsStore(state => state.logs);
  const accounts = useAccountsStore(state => state.accounts);

  const [channel, setChannel] = useState<FeedChannel>('all');
  const [regJobs, setRegJobs] = useState<FeedItem[]>([]);
  const [schedulerItems, setSchedulerItems] = useState<FeedItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const tasks = useSchedulerStore(state => state.tasks);

  const refreshRegJobs = useCallback(async () => {
    try {
      const jobs = await getRegistrationJobs();
      const sorted = [...jobs].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setRegJobs(sorted.slice(0, MAX_ITEMS_PER_CHANNEL).map(jobToItem));
    } catch (err) {
      console.warn('[UnifiedActivityFeed] reg jobs:', err);
    }
  }, []);

  const refreshSchedulerExecutions = useCallback(async () => {
    try {
      const tasks = useSchedulerStore.getState().tasks;
      const enabled = tasks.filter(t => t.enabled).slice(0, 5);
      const buckets = await Promise.all(
        enabled.map(task =>
          getTaskExecutions({ taskId: task.id, limit: 3 })
            .then(execs => ({ task, execs }))
            .catch(() => ({ task, execs: [] }))
        )
      );

      const items: FeedItem[] = [];
      for (const { task, execs } of buckets) {
        for (const exec of execs) {
          if (!exec.startedAt) continue;
          const startedMs = exec.startedAt * 1000;
          const status: ItemStatus =
            exec.status === 'success'
              ? 'success'
              : exec.status === 'failed' || exec.status === 'cancelled'
                ? 'failed'
                : 'pending';

          items.push({
            id: `sched:${exec.id}`,
            status,
            channel: 'scheduler',
            title: task.name,
            description:
              exec.status === 'failed' && exec.error
                ? exec.error.length > 60
                  ? exec.error.slice(0, 57) + '...'
                  : exec.error
                : exec.status,
            timestampMs: startedMs,
            onOpen: () => navigate('/scheduler'),
          });
        }
      }

      items.sort((a, b) => b.timestampMs - a.timestampMs);
      setSchedulerItems(items.slice(0, MAX_ITEMS_PER_CHANNEL));
    } catch (err) {
      console.warn('[UnifiedActivityFeed] scheduler:', err);
    }
  }, [navigate]);

  const proxyItems = useMemo<FeedItem[]>(() => {
    return logs
      .filter(
        log =>
          (log.level === 'error' || log.level === 'warn') &&
          (PROXY_SOURCES.includes(log.source) ||
            (log.channel && PROXY_SOURCES.includes(log.channel)))
      )
      .slice(0, MAX_ITEMS_PER_CHANNEL)
      .map(log => ({
        id: `log:${log.id}`,
        status: (log.level === 'error' ? 'failed' : 'pending') as ItemStatus,
        channel: 'proxy' as const,
        title: log.source,
        description:
          log.message.length > 80 ? log.message.slice(0, 77) + '...' : log.message,
        timestampMs: new Date(log.timestamp).getTime(),
        onOpen: () => navigate('/logs'),
      }));
  }, [logs, navigate]);

    const newAccountItems = useMemo<FeedItem[]>(() => {
      // eslint-disable-next-line react-hooks/purity -- time-window filter is intentionally time-dependent
      const accountCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const cutoff = accountCutoff;
      return [...accounts]
      .filter(a => {
        const ts = new Date(a.createdAt).getTime();
        return Number.isFinite(ts) && ts >= cutoff;
      })
      .sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      .slice(0, MAX_ITEMS_PER_CHANNEL)
      .map(a => ({
        id: `acc:${a.id}`,
        status:
          a.status === 'banned' || a.status === 'expired'
            ? ('failed' as ItemStatus)
            : ('success' as ItemStatus),
        channel: 'newAccounts' as const,
        title: a.email || `#${a.id}`,
        description: t('dashboard.activity.newAccount.description', {
          provider: a.provider,
          status: a.status,
        }),
        timestampMs: new Date(a.createdAt).getTime(),
        onOpen: () => navigate(`/accounts?provider=${a.provider}`),
      }));
    }, [accounts, navigate]);

  useEffect(() => {
    startTaskPolling();
      queueMicrotask(() => {
    void refreshRegJobs();
      });
    const id = window.setInterval(() => {
      void refreshRegJobs();
    }, POLL_MS);
    return () => {
      window.clearInterval(id);
      stopTaskPolling();
    };
  }, [refreshRegJobs]);

  // Refresh scheduler executions reactively when the centrally-polled tasks change.
  useEffect(() => {
    queueMicrotask(() => {
    void refreshSchedulerExecutions();
    });
  }, [tasks, refreshSchedulerExecutions]);

  const merged = useMemo(() => {
    const items =
      channel === 'newAccounts'
        ? newAccountItems
        : channel === 'reg'
          ? regJobs
          : channel === 'scheduler'
            ? schedulerItems
            : channel === 'proxy'
              ? proxyItems
              : [...newAccountItems, ...regJobs, ...schedulerItems, ...proxyItems];

    return [...items]
      .sort((a, b) => b.timestampMs - a.timestampMs)
      .slice(0, MAX_VISIBLE);
  }, [channel, newAccountItems, regJobs, schedulerItems, proxyItems]);

  const counts = {
    newAccounts: newAccountItems.length,
    reg: regJobs.length,
    scheduler: schedulerItems.length,
    proxy: proxyItems.length,
  };

  const handleRefreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshRegJobs(), refreshSchedulerExecutions()]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshRegJobs, refreshSchedulerExecutions]);

  const handleClear = useCallback(async () => {
    if (channel === 'reg' || channel === 'all') {
      try {
        await clearRegistrationJobs();
        setRegJobs([]);
      } catch (err) {
        console.warn('[UnifiedActivityFeed] clear:', err);
      }
    }
  }, [channel]);

  return (
    <section className="p-4 flex flex-col bg-white/[0.03] border border-white/[0.08] rounded-xl">
      <div className="flex items-center justify-between mb-3 gap-3">
        <div>
          <h3 className="text-sm font-semibold text-white">{t('dashboard.activity.title')}</h3>
          <p className="text-2xs text-slate-500">{t('dashboard.activity.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleClear}
            variant="ghost"
            size="xs"
            className="text-red-400 hover:text-red-300"
            leftIcon={<Trash2 size={12} />}
          />
          <Button
            onClick={handleRefreshAll}
            variant="ghost"
            size="xs"
            leftIcon={<RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />}
          >
            {t('common.refresh')}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        <ChannelChip
          icon={<Clock size={11} />}
          label={t('dashboard.activity.filters.all')}
          active={channel === 'all'}
          count={counts.newAccounts + counts.reg + counts.scheduler + counts.proxy}
          onClick={() => setChannel('all')}
        />
        <ChannelChip
          icon={<UserPlus size={11} />}
          label={t('dashboard.activity.filters.newAccounts')}
          active={channel === 'newAccounts'}
          count={counts.newAccounts}
          onClick={() => setChannel('newAccounts')}
          tone="emerald"
        />
        <ChannelChip
          icon={<Workflow size={11} />}
          label={t('dashboard.activity.filters.registrations')}
          active={channel === 'reg'}
          count={counts.reg}
          onClick={() => setChannel('reg')}
          tone="purple"
        />
        <ChannelChip
          icon={<Zap size={11} />}
          label={t('dashboard.activity.filters.scheduler')}
          active={channel === 'scheduler'}
          count={counts.scheduler}
          onClick={() => setChannel('scheduler')}
          tone="emerald"
        />
        <ChannelChip
          icon={<ShieldAlert size={11} />}
          label={t('dashboard.activity.filters.proxy')}
          active={channel === 'proxy'}
          count={counts.proxy}
          onClick={() => setChannel('proxy')}
          tone="red"
        />
      </div>

      <div className="flex flex-col space-y-2 flex-1 min-h-[120px]">
        {merged.length === 0 ? (
          <div className="text-xs text-slate-500 py-6 text-center">
            {t('dashboard.activity.empty')}
          </div>
        ) : (
          merged.map(item => (
            <ButtonBase
              key={item.id}
              type="button"
              onClick={item.onOpen}
              disabled={!item.onOpen}
              className={cn(
                'w-full text-left rounded-lg',
                item.onOpen
                  ? 'cursor-pointer hover:bg-white/[0.02]'
                  : 'cursor-default'
              )}
            >
              <ActivityItem
                status={item.status}
                title={item.title}
                description={item.description}
                timestamp={formatTimestamp(item.timestampMs)}
              />
            </ButtonBase>
          ))
        )}
      </div>

      <Button
        onClick={() => navigate('/logs')}
        variant="ghost"
        size="sm"
        className="mt-3 w-full border border-dashed border-white/10 hover:border-white/20 text-2xs text-slate-500 hover:text-white"
      >
        {t('dashboard.viewFullActivityLog')}
      </Button>
    </section>
  );
}

interface ChannelChipProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  count: number;
  onClick: () => void;
  tone?: 'purple' | 'emerald' | 'red';
}

function ChannelChip({ icon, label, active, count, onClick, tone }: ChannelChipProps) {
  const toneClass = active
    ? tone === 'purple'
      ? 'bg-purple-500/20 text-purple-200 border-purple-400/40'
      : tone === 'emerald'
        ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400/40'
        : tone === 'red'
          ? 'bg-red-500/20 text-red-200 border-red-400/40'
          : 'bg-white/15 text-white border-white/30'
    : 'bg-white/[0.04] text-slate-300 border-white/10 hover:bg-white/[0.08]';

  return (
    <ButtonBase
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] font-medium transition-colors',
        toneClass
      )}
    >
      {icon}
      <span>{label}</span>
      <span className="ml-0.5 text-[10px] tabular-nums opacity-70">{count}</span>
    </ButtonBase>
  );
}
