import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard } from 'lucide-react';
import { MotionConfig } from 'framer-motion';
import { toast } from 'sonner';

import Header from '../components/layout/Header';
import { t } from '../lib/i18n';
import { formatDate, formatTime } from '../lib/utils';
import { useAppStore } from '../stores/app';
import { useAccountsStore } from '../stores/accounts';
import { useLogsStore } from '../stores/logs';
import { useSettingsStore } from '../stores/settings';
import { useUIPreferencesStore } from '../stores/uiPreferences';
import { useMarketplaceStore } from '../stores/marketplace';
import { useMailStore } from '../stores/mail';
import { useTotpStore } from '../stores/totp';
import { useCommunityStore } from '../stores/community';
import {
  useSchedulerStore,
  startSchedulerStatusPolling,
  stopSchedulerStatusPolling,
} from '../stores/scheduler';
import { useBulkRefresh } from '../hooks/useBulkRefresh';
import { updateSettings } from '../lib/backend/modules/settings';
import type { SettingsData } from '../types/generated';
import { useServicePlugins } from '../hooks/useServicePlugins';
import {
  computeHealth,
  fleetHealthPart,
  quotaHealthPart,
  servicesHealthPart,
  errorsHealthPart,
  computeFleetInsights,
  buildActionQueue,
  type FleetAccount,
  type RegEvent,
} from '../lib/dashboard/insights';

import { HealthChip } from '../components/dashboard/HealthChip';
import { MicroStats } from '../components/dashboard/MicroStats';
import { ActionQueue } from '../components/dashboard/ActionQueue';
import { localizeAction } from '../components/dashboard/actionText';
import { HeatRibbon } from '../components/dashboard/HeatRibbon';
import { OpsMatrix } from '../components/dashboard/OpsMatrix';
import { ParkSection } from '../components/dashboard/ParkSection';
import { SystemStatusStrip } from '../components/dashboard/SystemStatusStrip';
import { UnifiedActivityFeed } from '../components/dashboard/UnifiedActivityFeed';
import { useRegJobs } from '../components/dashboard/useRegJobs';
import type { FleetRowData } from '../components/dashboard/FleetRow';

const DAY_MS = 86_400_000;
const NOW_TICK_MS = 30_000;

export default function Dashboard() {
  const navigate = useNavigate();
  const providers = useAppStore(state => state.providers);
  const language = useAppStore(state => state.language);
  const accounts = useAccountsStore(state => state.accounts);
  const logs = useLogsStore(state => state.logs);
  const settings = useSettingsStore(state => state.settings);
  const servicePlugins = useServicePlugins();
  const { jobs } = useRegJobs();
  const tasks = useSchedulerStore(state => state.tasks);
  const schedulerRunning = useSchedulerStore(state => state.isRunning);
  const marketplaceItems = useMarketplaceStore(state => state.items);
  const mailProfiles = useMailStore(state => state.profiles);
  const totpKeys = useTotpStore(state => state.keys);
  const friends = useCommunityStore(state => state.friends);
  const radarStats = useCommunityStore(state => state.stats);
  const pinnedProviders = useUIPreferencesStore(
    state => state.dashboard?.pinnedProviders ?? [],
  );

  // Force re-render on language change so t() strings refresh
  void language;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), NOW_TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const { startBulkRefresh } = useBulkRefresh({ concurrency: 3, delayMs: 500 });

  useEffect(() => {
    queueMicrotask(() => {
      void useMarketplaceStore.getState().fetchMarketplace();
      void useMailStore.getState().loadProfiles();
      void useTotpStore.getState().fetchKeys();
      void useCommunityStore.getState().fetchFriends();
      void useCommunityStore.getState().fetchStats();
    });
    startSchedulerStatusPolling();
    return () => {
      stopSchedulerStatusPolling();
    };
  }, []);

  const targets = useMemo<Record<string, number>>(() => {
    if (!settings) return {};
    if (settings.fleetTargets) return settings.fleetTargets;
    const legacy: Record<string, number> = {};
    if (settings.minActiveKiro) legacy.kiro = settings.minActiveKiro;
    if (settings.minActiveWindsurf) legacy.windsurf = settings.minActiveWindsurf;
    if (settings.minActiveTrae) legacy.trae = settings.minActiveTrae;
    return legacy;
  }, [settings]);

  const fleetAccounts = useMemo<FleetAccount[]>(
    () =>
      accounts.map(a => ({
        provider: a.provider,
        status: a.status,
        createdAt: a.createdAt ?? null,
        quota: a.quota ?? null,
      })),
    [accounts],
  );

  const regEvents = useMemo<RegEvent[]>(
    () =>
      jobs
        .map(job => ({
          providerId: job.provider,
          at: new Date(job.completedAt ?? job.createdAt).getTime(),
          ok: job.status === 'completed',
        }))
        .filter(event => Number.isFinite(event.at)),
    [jobs],
  );

  const insights = useMemo(
    () => computeFleetInsights(fleetAccounts, targets, regEvents, now),
    [fleetAccounts, targets, regEvents, now],
  );

  const activeByProvider = useMemo(() => {
    const map: Record<string, number> = {};
    for (const account of accounts) {
      if (account.status === 'active') {
        map[account.provider] = (map[account.provider] ?? 0) + 1;
      }
    }
    return map;
  }, [accounts]);

  const servicesRunning = useMemo(
    () => servicePlugins.filter(p => p.status.status === 'running').length,
    [servicePlugins],
  );

  const errors24h = useMemo(() => {
    const cutoff = now - DAY_MS;
    return logs.filter(
      l => l.level === 'error' && new Date(l.timestamp).getTime() >= cutoff,
    ).length;
  }, [logs, now]);

  const healthParts = useMemo(
    () => [
      fleetHealthPart(activeByProvider, targets),
      quotaHealthPart(fleetAccounts),
      servicesHealthPart(servicesRunning, servicePlugins.length),
      errorsHealthPart(errors24h),
    ],
    [activeByProvider, targets, fleetAccounts, servicesRunning, servicePlugins, errors24h],
  );
  const health = useMemo(() => computeHealth(healthParts), [healthParts]);

  const nearLimit = useMemo(
    () =>
      accounts.filter(
        a => a.quota && a.quota.limit > 0 && a.quota.used / a.quota.limit > 0.8,
      ).length,
    [accounts],
  );

  const healthDetails = useMemo(() => {
    const targeted = Object.values(targets).filter(v => v > 0).length;
    const withQuota = fleetAccounts.filter(a => a.quota !== null && a.quota.limit > 0);
    const near = withQuota.filter(a => a.quota !== null && a.quota.used / a.quota.limit > 0.8).length;
    return {
      fleet:
        targeted > 0
          ? t('dashboard.cc.health.detailFleet', { count: targeted })
          : t('dashboard.cc.health.detailFleetNone'),
      quota:
        withQuota.length > 0
          ? t('dashboard.cc.health.detailQuota', { near, total: withQuota.length })
          : t('dashboard.cc.health.detailQuotaNone'),
      services:
        servicePlugins.length > 0
          ? t('dashboard.cc.health.detailServices', {
              running: servicesRunning,
              total: servicePlugins.length,
            })
          : t('dashboard.cc.health.detailServicesNone'),
      errors: t('dashboard.cc.health.detailErrors', { count: errors24h }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- language forces re-localization
  }, [targets, fleetAccounts, servicePlugins, servicesRunning, errors24h, language]);

  const providerNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of providers) map[p.id] = p.name;
    return map;
  }, [providers]);

  const servicesDown = useMemo(
    () =>
      servicePlugins
        .filter(p => p.status.status !== 'running')
        .map(p => ({ id: p.id, name: p.id })),
    [servicePlugins],
  );

  const actionItems = useMemo(
    () =>
      buildActionQueue({
        insights,
        servicesDown,
        // No store exposes dead-proxy counts yet; the queue item stays dormant at 0.
        proxiesDead: 0,
        schedulerStopped: !schedulerRunning,
        nearLimit,
      }),
    [insights, servicesDown, schedulerRunning, nearLimit],
  );

  const localizedQueue = useMemo(
    () =>
      actionItems.map(item => ({
        ...item,
        ...localizeAction(item, { insights, providerNames, nearLimit, proxiesDead: 0 }),
      })),
    [actionItems, insights, providerNames, nearLimit],
  );

  const fleetRows = useMemo<FleetRowData[]>(() => {
    const dayStarts: number[] = [];
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    for (let i = 6; i >= 0; i--) dayStarts.push(today.getTime() - i * DAY_MS);

    return insights
      .map(insight => {
        const own = accounts.filter(a => a.provider === insight.providerId);
        const quotaSamples = own.filter(a => a.quota && a.quota.limit > 0);
        const avgQuotaPct =
          quotaSamples.length > 0
            ? Math.round(
                quotaSamples.reduce(
                  (sum, a) => sum + (a.quota.used / a.quota.limit) * 100,
                  0,
                ) / quotaSamples.length,
              )
            : null;

        const spark = dayStarts.map(dayStart => {
          const dayEnd = dayStart + DAY_MS;
          return own.filter(a => {
            const ts = new Date(a.createdAt).getTime();
            return Number.isFinite(ts) && ts >= dayStart && ts < dayEnd;
          }).length;
        });

        const info = providers.find(p => p.id === insight.providerId);
        return {
          providerId: insight.providerId,
          name: info?.name ?? insight.providerId,
          color: info?.color ?? null,
          active: insight.active,
          target: insight.target,
          total: own.length,
          avgQuotaPct,
          spark,
          successDeltaPct: insight.successDeltaPct,
          pinned: pinnedProviders.includes(insight.providerId),
        };
      })
      .filter(row => row.total > 0 || row.target > 0)
      .sort((a, b) => b.total - a.total || b.active - a.active);
  }, [insights, accounts, providers, pinnedProviders, now]);

  const stats = useMemo(() => {
    const total = accounts.length;
    const active = accounts.filter(a => a.status === 'active').length;
    const cutoff = now - 7 * DAY_MS;
    const delta7d = accounts.filter(a => {
      const ts = new Date(a.createdAt).getTime();
      return Number.isFinite(ts) && ts >= cutoff;
    }).length;
    return {
      total,
      delta7d,
      activePct: total > 0 ? Math.round((active / total) * 100) : 0,
    };
  }, [accounts, now]);

  const nextRunUnix = useMemo(() => {
    const enabled = tasks.filter(task => task.enabled && task.nextRun > 0);
    return enabled.length > 0 ? Math.min(...enabled.map(task => task.nextRun)) : null;
  }, [tasks]);

  const pluginsInstalled = useMemo(
    () => marketplaceItems.filter(item => item.installed).length,
    [marketplaceItems],
  );

  const handleTargetChange = useCallback(
    async (providerId: string, value: number) => {
      const prev = useSettingsStore.getState().settings;
      const nextTargets = { ...targets, [providerId]: value };
      useSettingsStore.setState({
        settings: { ...(prev ?? {}), fleetTargets: nextTargets } as SettingsData,
      });
      try {
        await updateSettings({ fleetTargets: nextTargets });
      } catch {
        useSettingsStore.setState({ settings: prev });
        toast.error(t('dashboard.cc.fleet.saveFailed'));
      }
    },
    [targets],
  );

  const handleRefreshProvider = useCallback(
    (providerId: string) => {
      const ids = accounts
        .filter(a => a.provider === providerId && a.status !== 'banned')
        .map(a => a.id);
      if (ids.length === 0) {
        toast.info(
          t('dashboard.fleetGrid.noAccountsToRefresh', {
            provider: providerNames[providerId] ?? providerId,
          }),
        );
        return;
      }
      void startBulkRefresh(ids);
    },
    [accounts, providerNames, startBulkRefresh],
  );

  const handleOpenAccounts = useCallback(
    (providerId: string) => {
      useUIPreferencesStore.getState().setAccountsProviderFilter(providerId);
      navigate('/accounts');
    },
    [navigate],
  );

  const handleNearLimitClick = useCallback(() => {
    useUIPreferencesStore.getState().setAccountsProviderFilter('all');
    useUIPreferencesStore.getState().setAccountsQuotaFilter('low_quota');
    navigate('/accounts');
  }, [navigate]);

  const handleTogglePin = useCallback((providerId: string) => {
    useUIPreferencesStore.getState().toggleDashboardPin(providerId);
  }, []);

  const currentDate = formatDate(new Date(), {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
  });
  const currentTime = formatTime(new Date(), {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative isolate flex flex-col h-full overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            backgroundImage:
              'radial-gradient(600px 300px at 15% 0%, rgba(99,102,241,0.07), transparent 70%), radial-gradient(700px 350px at 85% 100%, rgba(139,92,246,0.05), transparent 70%)',
          }}
        />
        <Header
          title={t('dashboard.title')}
          subtitle={`${currentDate} • ${currentTime}`}
          icon={<LayoutDashboard size={18} />}
          actions={
            <>
              <MicroStats
                total={stats.total}
                delta7d={stats.delta7d}
                activePct={stats.activePct}
                nearLimit={nearLimit}
                pluginsRunning={servicesRunning}
                pluginsTotal={servicePlugins.length}
                onNearLimitClick={handleNearLimitClick}
              />
              <HealthChip report={health} details={healthDetails} />
            </>
          }
        />

        <div className="flex-1 min-h-0 flex flex-col gap-2 p-3 overflow-y-auto">
          <SystemStatusStrip />
          <ActionQueue items={localizedQueue} />
          <HeatRibbon accounts={fleetAccounts} regEvents={regEvents} now={now} />
          <OpsMatrix
            fleetRows={fleetRows}
            onTargetChange={(providerId, value) => void handleTargetChange(providerId, value)}
            onRefreshProvider={handleRefreshProvider}
            onRegisterProvider={providerId => navigate(`/autoreg?provider=${providerId}`)}
            onOpenAccounts={handleOpenAccounts}
            onTogglePin={handleTogglePin}
            services={servicePlugins}
            now={now}
            subsystems={{
              pluginsInstalled,
              mailProfiles: mailProfiles.length,
              totpKeys: totpKeys.length,
              schedulerTasks: tasks.length,
              friends: friends.length,
              radarOffers: typeof radarStats?.offers === 'number' ? radarStats.offers : null,
              nextRunUnix,
            }}
          />
          <ParkSection accounts={accounts} providers={providers} />
          <UnifiedActivityFeed />
        </div>
      </div>
    </MotionConfig>
  );
}
