import { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Activity, Layers, Server } from 'lucide-react';

import { t } from '@/lib/i18n';
import {
  Button,
  EmptyState,
  GlassCard,
  KeyValueList,
  MetricStrip,
} from '@/components/ui';
import { useLogsStore } from '../../../stores/logs';
import type { ProviderCapability } from '../../../lib/tauri/modules/aiProxy';
import type { ProxySettings, ProxyStatus } from '../../../types/generated';

export interface MonitorOverviewProps {
  proxyStatus: ProxyStatus | null;
  proxySettings: ProxySettings | null;
  providerCapabilities: ProviderCapability[];
  availableModels: Array<{ id: string; provider: string }>;
  historySummary: { total: number; errors: number };
  hasAccounts: boolean;
  accountReadiness?: {
    enabled: number;
    ready: number;
    inCooldown: number;
    weeklyLimitReached: number;
    withQuotaSignal: number;
  };
  onOpenAnalytics: () => void;
  onOpenDebugChat: () => void;
}

export function MonitorOverview({
  proxyStatus,
  proxySettings,
  providerCapabilities,
  availableModels,
  historySummary,
  hasAccounts,
  accountReadiness,
  onOpenAnalytics,
  onOpenDebugChat,
}: MonitorOverviewProps) {
  const logs = useLogsStore(state => state.logs);
  const latestLimitLog = useMemo(
    () => logs.find(l => l.source === 'ai_proxy.limits' || l.source === 'ai_proxy.compat'),
    [logs]
  );

  const isExternallyRunning = Boolean(proxyStatus?.running && !proxyStatus?.managedByApp);

  const coverageSegments = useMemo(() => {
    if (!accountReadiness) return [];
    return [
      {
        id: 'enabled',
        label: t('aiHub.readiness.enabled'),
        value: accountReadiness.enabled,
        icon: <Activity size={11} />,
        tone: 'info' as const,
      },
      {
        id: 'ready',
        label: t('aiHub.readiness.ready'),
        value: accountReadiness.ready,
        icon: <CheckCircle2 size={11} />,
        tone: accountReadiness.ready > 0 ? ('success' as const) : ('neutral' as const),
      },
      {
        id: 'cooldown',
        label: t('aiHub.readiness.cooldown'),
        value: accountReadiness.inCooldown,
        icon: <Clock size={11} />,
        tone:
          accountReadiness.inCooldown > 0 ? ('warning' as const) : ('neutral' as const),
      },
      {
        id: 'weekly',
        label: t('aiHub.readiness.weeklyLimitShort'),
        value: accountReadiness.weeklyLimitReached,
        icon: <AlertTriangle size={11} />,
        tone:
          accountReadiness.weeklyLimitReached > 0
            ? ('danger' as const)
            : ('neutral' as const),
      },
    ];
  }, [accountReadiness]);

  const healthRows = useMemo(() => {
    const rows: Array<{
      id: string;
      label: string;
      value: React.ReactNode;
      tone?: 'success' | 'muted' | 'warning' | 'danger' | 'info' | 'default';
    }> = [
      {
        id: 'status',
        label: t('aiHub.table.status'),
        value: proxyStatus?.running
          ? isExternallyRunning
            ? `${t('aiHub.proxy.running')} (external)`
            : t('aiHub.proxy.running')
          : t('aiHub.proxy.stopped'),
        tone: proxyStatus?.running ? 'success' : 'muted',
      },
      {
        id: 'port',
        label: t('aiHub.proxy.portLabel'),
        value: proxyStatus?.port ?? t('aiHub.table.emptyValue'),
      },
      {
        id: 'mode',
        label: t('aiHub.proxy.modeLabel'),
        value: proxySettings?.appMode ?? t('aiHub.table.emptyValue'),
      },
      {
        id: 'routing',
        label: t('aiHub.proxy.routingLabel'),
        value: proxySettings?.routingStrategy ?? t('aiHub.table.emptyValue'),
      },
    ];

    if (proxyStatus?.running) {
      rows.push({
        id: 'reachability',
        label: t('aiHub.proxy.reachabilityLabel'),
        value: proxyStatus?.networkReachable
          ? t('aiHub.proxy.reachable')
          : t('aiHub.proxy.unreachable'),
        tone: proxyStatus?.networkReachable ? 'success' : 'warning',
      });
    }

    return rows;
  }, [proxyStatus, proxySettings, isExternallyRunning]);

  const requestRows = useMemo(
    () => [
      {
        id: 'total',
        label: t('aiHub.cards.last20Requests'),
        value: historySummary.total,
      },
      {
        id: 'errors',
        label: t('aiHub.cards.errors'),
        value: historySummary.errors,
        tone:
          historySummary.errors > 0 ? ('danger' as const) : ('success' as const),
      },
    ],
    [historySummary]
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Coverage strip */}
      {accountReadiness ? (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2 px-1">
            {t('aiHub.cards.accountCoverageTitle')}
          </div>
          <MetricStrip segments={coverageSegments} />
        </div>
      ) : null}

      {/* Three balanced columns: providers, health+history, latest reason (only when present) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <GlassCard className="p-4 md:p-5 flex flex-col gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">
              {t('aiHub.cards.providersTitle')}
            </div>
            {providerCapabilities.length === 0 ? (
              <EmptyState
                compact
                icon={Server}
                title={t('aiHub.empty.capabilities')}
              />
            ) : (
              <div className="space-y-1.5">
                {providerCapabilities.map(cap => (
                  <div
                    key={cap.provider}
                    className="flex items-center justify-between gap-3 text-xs"
                  >
                    <span className="capitalize text-slate-200">{cap.provider}</span>
                    <span className="text-slate-400 font-mono tabular-nums whitespace-nowrap">
                      {t('aiHub.cards.providerCounts', {
                        active: cap.enabledAccounts,
                        total: cap.totalAccounts,
                        keys: cap.totalApiKeys,
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-white/5 pt-4">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">
                {t('aiHub.cards.modelInventoryTitle')}
              </div>
              <span className="text-[11px] text-slate-500 tabular-nums">
                {availableModels.length}
              </span>
            </div>
            {availableModels.length === 0 ? (
              <EmptyState
                compact
                icon={Layers}
                title={
                  !proxyStatus?.running
                    ? t('aiHub.empty.modelsProxyStopped')
                    : !hasAccounts
                      ? t('aiHub.empty.modelsNoAccounts')
                      : t('aiHub.empty.modelsUnavailable')
                }
              />
            ) : (
              <div className="space-y-1 max-h-44 overflow-auto pr-1">
                {availableModels.slice(0, 24).map(m => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="truncate text-slate-200">{m.id}</span>
                    <span className="text-slate-500 capitalize shrink-0">{m.provider}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </GlassCard>

        <GlassCard className="p-4 md:p-5 flex flex-col gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">
              {t('aiHub.diagnostics.healthTitle')}
            </div>
            <KeyValueList rows={healthRows} density="compact" />
          </div>

          <div className="border-t border-white/5 pt-4">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">
                {t('aiHub.cards.requestHistoryTitle')}
              </div>
              <Button variant="ghost" size="xs" onClick={onOpenAnalytics}>
                {t('aiHub.actions.openAnalytics')}
              </Button>
            </div>
            <KeyValueList rows={requestRows} density="compact" />
          </div>
        </GlassCard>

        {/* Latest reason: full card when present, compact banner when empty */}
        {latestLimitLog ? (
          <GlassCard className="p-4 md:p-5">
            <div className="flex items-center justify-between mb-2 gap-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">
                {t('aiHub.diagnostics.latestReason')}
              </div>
              <Button variant="ghost" size="xs" onClick={onOpenDebugChat}>
                {t('aiHub.actions.openDebugChat')}
              </Button>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/30 p-2.5">
              <div className="text-[10px] text-slate-500 mb-1">
                {latestLimitLog.timestamp}
              </div>
              <div className="text-xs text-slate-200 break-words">
                {latestLimitLog.message}
              </div>
            </div>
          </GlassCard>
        ) : (
          <EmptyState
            compact
            icon={CheckCircle2}
            title={t('aiHub.diagnostics.noRecentReasons')}
            action={
              <Button variant="ghost" size="xs" onClick={onOpenDebugChat}>
                {t('aiHub.actions.openDebugChat')}
              </Button>
            }
          />
        )}
      </div>
    </div>
  );
}
