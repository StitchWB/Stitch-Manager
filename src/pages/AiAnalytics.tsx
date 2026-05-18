import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import Header from '../components/layout/Header';
import { AiTopTabs } from '../components/ai-proxy/AiTopTabs';
import {
  Button,
  EmptyState,
  GlassCard,
  IconButton,
  KeyValueList,
  MetricStrip,
  PageHeader,
  StatusBadge,
  Tooltip,
  TwoColumnLayout,
} from '@/components/ui';
import type {
  KeyValueRow,
  MetricSegment,
  MetricTone,
} from '@/components/ui';
import {
  getCostEstimateSafe,
  getDailyStatsSafe,
  getModelUsage,
  getRequestHistorySafe,
  getWeeklyStats,
} from '../lib/tauri/modules/aiProxy';
import type {
  DailyStats,
  DailyStatsPoint,
  ModelUsage,
  RequestLog,
} from '../types/generated';
import { t } from '../lib/i18n';

type StatusKind = 'success' | 'client' | 'server' | 'unknown';

function classifyStatus(status: number): StatusKind {
  if (status >= 200 && status < 300) return 'success';
  if (status >= 400 && status < 500) return 'client';
  if (status >= 500 && status < 600) return 'server';
  return 'unknown';
}

function statusBadgeProps(kind: StatusKind): {
  status: 'active' | 'warning' | 'error' | 'idle';
} {
  switch (kind) {
    case 'success':
      return { status: 'active' };
    case 'client':
      return { status: 'warning' };
    case 'server':
      return { status: 'error' };
    default:
      return { status: 'idle' };
  }
}

function formatTimestamp(epochSeconds: number): string {
  if (!epochSeconds || Number.isNaN(epochSeconds)) return '-';
  const date = new Date(epochSeconds * 1000);
  return date.toLocaleString();
}

function formatDuration(durationMs: number | null | undefined): string {
  if (typeof durationMs !== 'number' || Number.isNaN(durationMs)) return '-';
  return t('aiHub.analytics.durationMs', { count: Math.round(durationMs) });
}

function aggregateWeekly(points: DailyStatsPoint[]): {
  requests: number;
  errors: number;
} {
  let requests = 0;
  let errors = 0;
  for (const p of points) {
    requests += p.requests ?? 0;
    errors += p.failed ?? 0;
  }
  return { requests, errors };
}

export default function AiAnalytics() {
  const navigate = useNavigate();

  const [dailyStats, setDailyStats] = useState<DailyStats | null>(null);
  const [weeklyStats, setWeeklyStats] = useState<DailyStatsPoint[]>([]);
  const [modelUsage, setModelUsage] = useState<ModelUsage[]>([]);
  const [recentRequests, setRecentRequests] = useState<RequestLog[]>([]);
  // costEstimate is loaded for completeness even though it's not displayed
  // in the four primary metric tiles — keep it cached so future blocks can use it.
  const [, setCostEstimate] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);

    // Use Promise.allSettled so a single failing source does not crash the page.
    const results = await Promise.allSettled([
      getDailyStatsSafe(),
      getWeeklyStats(),
      getModelUsage(),
      getRequestHistorySafe(50, 0),
      getCostEstimateSafe(),
    ]);

    const [dailyRes, weeklyRes, modelRes, recentRes, costRes] = results;

    if (dailyRes.status === 'fulfilled') {
      setDailyStats(dailyRes.value);
    } else {
      console.warn('[AiAnalytics] getDailyStatsSafe failed:', dailyRes.reason);
      setDailyStats(null);
    }

    if (weeklyRes.status === 'fulfilled') {
      setWeeklyStats(weeklyRes.value ?? []);
    } else {
      console.warn('[AiAnalytics] getWeeklyStats failed:', weeklyRes.reason);
      setWeeklyStats([]);
    }

    if (modelRes.status === 'fulfilled') {
      setModelUsage(modelRes.value ?? []);
    } else {
      console.warn('[AiAnalytics] getModelUsage failed:', modelRes.reason);
      setModelUsage([]);
    }

    if (recentRes.status === 'fulfilled') {
      setRecentRequests(recentRes.value ?? []);
    } else {
      console.warn('[AiAnalytics] getRequestHistorySafe failed:', recentRes.reason);
      setRecentRequests([]);
    }

    if (costRes.status === 'fulfilled') {
      setCostEstimate(costRes.value);
    } else {
      console.warn('[AiAnalytics] getCostEstimateSafe failed:', costRes.reason);
      setCostEstimate(null);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  const weeklyAggregate = useMemo(() => aggregateWeekly(weeklyStats), [weeklyStats]);

  const todayRequests = dailyStats?.totalRequests ?? 0;
  const todayErrors = dailyStats?.failedRequests ?? 0;

  const metricSegments = useMemo<MetricSegment[]>(() => {
    const todayReqTone: MetricTone = todayRequests > 0 ? 'info' : 'neutral';
    const todayErrTone: MetricTone =
      todayErrors > 0 ? 'danger' : 'neutral';
    const weekReqTone: MetricTone =
      weeklyAggregate.requests > 0 ? 'info' : 'neutral';
    const weekErrTone: MetricTone =
      weeklyAggregate.errors > 0 ? 'danger' : 'neutral';

    return [
      {
        id: 'today-requests',
        label: t('aiHub.analytics.todayRequests'),
        value: todayRequests,
        icon: <Activity size={11} />,
        tone: todayReqTone,
      },
      {
        id: 'today-errors',
        label: t('aiHub.analytics.todayErrors'),
        value: todayErrors,
        icon: <AlertTriangle size={11} />,
        tone: todayErrTone,
      },
      {
        id: 'weekly-requests',
        label: t('aiHub.analytics.weeklyRequests'),
        value: weeklyAggregate.requests,
        icon: <Activity size={11} />,
        tone: weekReqTone,
      },
      {
        id: 'weekly-errors',
        label: t('aiHub.analytics.weeklyErrors'),
        value: weeklyAggregate.errors,
        icon: <AlertTriangle size={11} />,
        tone: weekErrTone,
      },
    ];
  }, [todayRequests, todayErrors, weeklyAggregate]);

  const topModels = useMemo<ModelUsage[]>(() => {
    const sorted = [...modelUsage].sort((a, b) => b.requests - a.requests);
    return sorted.slice(0, 10);
  }, [modelUsage]);

  const topModelRows = useMemo<KeyValueRow[]>(
    () =>
      topModels.map(model => ({
        id: model.model,
        label: <span className="truncate text-slate-200">{model.model}</span>,
        value: (
          <span className="text-slate-400 font-mono tabular-nums whitespace-nowrap">
            {t('aiHub.analytics.requestsCount', { count: model.requests })}
            {' · '}
            {t('aiHub.analytics.tokensCount', {
              count: model.tokens.toLocaleString(),
            })}
          </span>
        ),
      })),
    [topModels]
  );

  const bothListsEmpty = recentRequests.length === 0 && topModels.length === 0;

  const headerActions = (
    <>
      <Button variant="secondary" size="sm" onClick={() => navigate('/ai/monitor')}>
        {t('aiHub.analytics.openMonitor')}
      </Button>
      <Tooltip content={t('aiHub.analytics.refreshTooltip')}>
        <IconButton
          size="md"
          variant="ghost"
          onClick={() => {
            void loadAnalytics();
          }}
          disabled={loading}
          aria-label={t('aiHub.analytics.refreshTooltip')}
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : undefined} />
        </IconButton>
      </Tooltip>
    </>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-void-base">
      <Header title={t('sidebar.aiHub')} icon={<Activity size={18} />} />
      <AiTopTabs />

      <PageHeader
        eyebrow={t('sidebar.aiHub')}
        title={t('aiHub.analytics.title')}
        description={t('aiHub.analytics.subtitle')}
        actions={headerActions}
      />

      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4">
        <MetricStrip segments={metricSegments} />

        {bothListsEmpty ? (
          <EmptyState
            compact
            icon={Activity}
            title={t('aiHub.analytics.emptyTitle')}
            description={t('aiHub.analytics.emptyDescription')}
          />
        ) : (
          <TwoColumnLayout
            gap="md"
            breakpoint="lg"
            sideWidth="w-full lg:w-[340px]"
            main={
              <GlassCard className="p-4 md:p-6 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">
                    {t('aiHub.analytics.recentRequestsTitle')}
                  </div>
                  <span className="text-[11px] text-slate-500 tabular-nums">
                    {recentRequests.length}
                  </span>
                </div>

                {recentRequests.length === 0 ? (
                  <EmptyState
                    compact
                    icon={Activity}
                    title={t('aiHub.analytics.emptyTitle')}
                    description={t('aiHub.analytics.emptyDescription')}
                  />
                ) : (
                  <div className="space-y-1 max-h-[60vh] overflow-auto pr-1">
                    {recentRequests.map(req => {
                      const kind = classifyStatus(req.status);
                      return (
                        <div
                          key={req.id ?? `${req.createdAt}-${req.model}`}
                          className="flex items-center justify-between gap-3 text-xs py-1.5 border-b border-white/[0.04] last:border-b-0"
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className="text-slate-500 tabular-nums whitespace-nowrap shrink-0">
                              {formatTimestamp(req.createdAt)}
                            </span>
                            <span className="truncate text-slate-200 font-mono">
                              {req.model || '-'}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <StatusBadge size="sm" {...statusBadgeProps(kind)}>
                              {req.status || '—'}
                            </StatusBadge>
                            <span className="text-slate-500 tabular-nums whitespace-nowrap min-w-[3rem] text-right">
                              {formatDuration(req.durationMs)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </GlassCard>
            }
            side={
              <GlassCard className="p-4 md:p-6 flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">
                    {t('aiHub.analytics.topModelsTitle')}
                  </div>
                  <span className="text-[11px] text-slate-500 tabular-nums">
                    {topModels.length}
                  </span>
                </div>

                {topModels.length === 0 ? (
                  <EmptyState
                    compact
                    icon={Activity}
                    title={t('aiHub.analytics.emptyTitle')}
                  />
                ) : (
                  <KeyValueList rows={topModelRows} density="compact" />
                )}
              </GlassCard>
            }
          />
        )}
      </div>
    </div>
  );
}
