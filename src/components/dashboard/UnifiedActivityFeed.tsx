import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Clock,
  RefreshCw,
  ShieldAlert,
  Trash2,
  UserPlus,
  Workflow,
  Zap,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

import { t } from '@/lib/i18n';
import { ButtonBase } from '@/components/ui/ButtonBase';
import { cn, formatDate } from '@/lib/utils';

import { useLogsStore } from '../../stores/logs';
import { useAccountsStore } from '../../stores/accounts';
import { useSchedulerStore, startTaskPolling, stopTaskPolling } from '../../stores/scheduler';
import { clearRegistrationJobs } from '../../lib/backend/modules/registration';
import { getTaskExecutions } from '../../lib/backend/modules/scheduler';
import type { RegistrationJob } from '../../types/ui';

import { useRegJobs } from './useRegJobs';

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

const MAX_ITEMS_PER_CHANNEL = 8;
const MAX_VISIBLE = 30;

const PROXY_SOURCES = ['ai-proxy', 'background', 'background_manager', 'replenishment', 'router'];

function formatTimestamp(ms: number): string {
  const diffMs = Date.now() - ms;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return t('time.justNow');
  if (diffMin < 60) return t('time.minutesAgo', { count: diffMin });
  if (diffMin < 1440) return t('time.hoursAgo', { count: Math.floor(diffMin / 60) });
  return formatDate(ms);
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

const CHANNEL_ICONS: Record<Exclude<FeedChannel, 'all'>, React.ReactNode> = {
  newAccounts: <UserPlus size={11} aria-hidden="true" />,
  reg: <Workflow size={11} aria-hidden="true" />,
  scheduler: <Zap size={11} aria-hidden="true" />,
  proxy: <ShieldAlert size={11} aria-hidden="true" />,
};

const STATUS_ICON_CLASSES: Record<ItemStatus, string> = {
  success: 'text-emerald-400',
  pending: 'text-amber-400',
  failed: 'text-red-400',
};

interface UnifiedActivityFeedProps {
  className?: string;
}

export function UnifiedActivityFeed({ className }: UnifiedActivityFeedProps) {
  const navigate = useNavigate();
  const logs = useLogsStore(state => state.logs);
  const accounts = useAccountsStore(state => state.accounts);

  const [channel, setChannel] = useState<FeedChannel>('all');
  const [schedulerItems, setSchedulerItems] = useState<FeedItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const tasks = useSchedulerStore(state => state.tasks);
  const { jobs, refreshRegJobs } = useRegJobs();

  const regJobs = useMemo<FeedItem[]>(() => {
    const sorted = [...jobs].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return sorted.slice(0, MAX_ITEMS_PER_CHANNEL).map(jobToItem);
  }, [jobs]);

  const refreshSchedulerExecutions = useCallback(async () => {
    try {
      const enabled = useSchedulerStore.getState().tasks.filter(t => t.enabled).slice(0, 5);
      const buckets = await Promise.all(
        enabled.map(task =>
          getTaskExecutions({ taskId: task.id, limit: 3 })
            .then(execs => ({ task, execs }))
            .catch(() => ({ task, execs: [] })),
        ),
      );

      const items: FeedItem[] = [];
      for (const { task, execs } of buckets) {
        for (const exec of execs) {
          if (!exec.startedAt) continue;
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
            timestampMs: exec.startedAt * 1000,
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
            (log.channel && PROXY_SOURCES.includes(log.channel))),
      )
      .slice(0, MAX_ITEMS_PER_CHANNEL)
      .map(log => ({
        id: `log:${log.id}`,
        status: (log.level === 'error' ? 'failed' : 'pending') as ItemStatus,
        channel: 'proxy' as const,
        title: log.source,
        description: log.message.length > 80 ? log.message.slice(0, 77) + '...' : log.message,
        timestampMs: new Date(log.timestamp).getTime(),
        onOpen: () => navigate('/logs'),
      }));
  }, [logs, navigate]);

  const newAccountItems = useMemo<FeedItem[]>(() => {
    // eslint-disable-next-line react-hooks/purity -- time-window filter is intentionally time-dependent
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return [...accounts]
      .filter(a => {
        const ts = new Date(a.createdAt).getTime();
        return Number.isFinite(ts) && ts >= cutoff;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
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
    return () => {
      stopTaskPolling();
    };
  }, []);

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

    return [...items].sort((a, b) => b.timestampMs - a.timestampMs).slice(0, MAX_VISIBLE);
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
        await refreshRegJobs();
      } catch (err) {
        console.warn('[UnifiedActivityFeed] clear:', err);
      }
    }
  }, [channel, refreshRegJobs]);

  return (
    <section
      className={cn(
        'flex-1 min-h-[120px] max-h-[40vh] flex flex-col rounded-lg bg-black/40 backdrop-blur-sm border border-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-shadow hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_28px_rgba(99,102,241,0.07)]',
        className,
      )}
      data-testid="activity-feed"
    >
      <div className="flex items-center justify-between gap-2 px-3 h-8 shrink-0">
        <h3 className="text-[10px] uppercase tracking-[0.14em] text-slate-500 font-semibold select-none">
          {t('dashboard.activity.title')}
        </h3>
        <div className="flex items-center gap-1 flex-wrap justify-end">
          <ChannelChip
            icon={<Clock size={10} />}
            label={t('dashboard.activity.filters.all')}
            active={channel === 'all'}
            count={counts.newAccounts + counts.reg + counts.scheduler + counts.proxy}
            onClick={() => setChannel('all')}
          />
          <ChannelChip
            icon={<UserPlus size={10} />}
            label={t('dashboard.activity.filters.newAccounts')}
            active={channel === 'newAccounts'}
            count={counts.newAccounts}
            onClick={() => setChannel('newAccounts')}
            tone="emerald"
          />
          <ChannelChip
            icon={<Workflow size={10} />}
            label={t('dashboard.activity.filters.registrations')}
            active={channel === 'reg'}
            count={counts.reg}
            onClick={() => setChannel('reg')}
            tone="purple"
          />
          <ChannelChip
            icon={<Zap size={10} />}
            label={t('dashboard.activity.filters.scheduler')}
            active={channel === 'scheduler'}
            count={counts.scheduler}
            onClick={() => setChannel('scheduler')}
            tone="emerald"
          />
          <ChannelChip
            icon={<ShieldAlert size={10} />}
            label={t('dashboard.activity.filters.proxy')}
            active={channel === 'proxy'}
            count={counts.proxy}
            onClick={() => setChannel('proxy')}
            tone="red"
          />
          <ButtonBase
            type="button"
            aria-label={t('common.refresh')}
            onClick={() => void handleRefreshAll()}
            className="p-1 rounded text-slate-500 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <RefreshCw size={11} className={refreshing ? 'animate-spin' : undefined} />
          </ButtonBase>
          <ButtonBase
            type="button"
            aria-label={t('header.clearAll')}
            onClick={() => void handleClear()}
            className="p-1 rounded text-slate-600 hover:text-red-400 hover:bg-white/[0.06] transition-colors"
          >
            <Trash2 size={11} />
          </ButtonBase>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-1.5 pb-1.5 flex flex-col">
        {merged.length === 0 ? (
          <div className="flex-1 min-h-0 grid place-items-center px-3">
            <div className="flex flex-col items-center gap-2">
              <svg
                width="40"
                height="40"
                viewBox="0 0 40 40"
                fill="none"
                strokeWidth="1.5"
                className="stroke-slate-600"
                aria-hidden="true"
              >
                <rect x="4" y="8" width="32" height="24" rx="4" />
                <polyline
                  points="10,20 15,20 18,13 22,27 25,20 30,20"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="text-[11px] text-slate-400">{t('dashboard.activity.empty')}</span>
            </div>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {merged.map(item => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="shrink-0"
              >
                <ButtonBase
                  type="button"
                  onClick={item.onOpen}
                  disabled={!item.onOpen}
                  className={cn(
                    'w-full flex items-center gap-2 px-1.5 py-[3px] rounded-md text-left',
                    item.onOpen ? 'cursor-pointer hover:bg-white/[0.03]' : 'cursor-default',
                  )}
                >
                  <span className={cn('shrink-0', STATUS_ICON_CLASSES[item.status])}>
                    {CHANNEL_ICONS[item.channel]}
                  </span>
                  <span className="flex-1 min-w-0 truncate text-[11px] text-slate-300">
                    <span className="text-slate-200">{item.title}</span>
                    <span className="text-slate-600"> · </span>
                    <span className="text-slate-500">{item.description}</span>
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-slate-600">
                    {formatTimestamp(item.timestampMs)}
                  </span>
                </ButtonBase>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
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
    : 'bg-white/[0.04] text-slate-400 border-white/10 hover:bg-white/[0.08]';

  return (
    <ButtonBase
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 px-1.5 h-5 rounded border text-[10px] font-medium transition-colors',
        toneClass,
      )}
    >
      {icon}
      <span>{label}</span>
      <span className="tabular-nums opacity-70">{count}</span>
    </ButtonBase>
  );
}
