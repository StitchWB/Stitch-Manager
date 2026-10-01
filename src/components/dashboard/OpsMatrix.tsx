import { useCallback, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';

import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { ButtonBase } from '@/components/ui/ButtonBase';
import { Modal } from '@/components/ui/Modal';
import {
  restartServicePlugin,
  type ServicePluginInfo,
} from '@/lib/backend/modules/servicePlugins';
import { useServicePluginLogs } from '@/hooks/useServicePluginLogs';
import { useUIPreferencesStore } from '@/stores/uiPreferences';

import { FleetRow, type FleetRowData } from './FleetRow';
import { ServiceRow } from './ServiceRow';
import { SubsystemChips } from './SubsystemChips';
import { FLEET_HEADER, FLEET_HEADER_COMPACT } from './rowGrid';

export interface SubsystemCounts {
  pluginsInstalled: number;
  mailProfiles: number;
  totpKeys: number;
  schedulerTasks: number;
  friends: number | null;
  radarOffers: number | null;
  nextRunUnix: number | null;
}

const HEADER_CELL = 'text-[10px] uppercase tracking-wider text-slate-400 font-medium text-right truncate';

function MatrixHeader({ compact }: { compact: boolean }) {
  return (
    <div
      className={cn(compact ? FLEET_HEADER_COMPACT : FLEET_HEADER, 'px-2 h-5')}
      data-testid="ops-matrix-header"
    >
      <span aria-hidden="true" />
      <span aria-hidden="true" />
      <span className={HEADER_CELL}>{t('dashboard.cc.matrix.colActiveTarget')}</span>
      <span className={cn(HEADER_CELL, 'text-left')}>{t('dashboard.cc.matrix.colAvgQuota')}</span>
      {!compact && (
        <>
          <span className={HEADER_CELL}>{t('dashboard.cc.matrix.colReg7d')}</span>
          <span className={HEADER_CELL}>{t('dashboard.cc.matrix.colSuccessDelta')}</span>
        </>
      )}
      <span aria-hidden="true" />
    </div>
  );
}

interface OpsMatrixProps {
  fleetRows: FleetRowData[];
  onTargetChange: (providerId: string, value: number) => void;
  onRefreshProvider: (providerId: string) => void;
  onRegisterProvider: (providerId: string) => void;
  onOpenAccounts: (providerId: string) => void;
  onTogglePin: (providerId: string) => void;
  services: ServicePluginInfo[];
  subsystems: SubsystemCounts;
  now: number;
}

interface SectionProps {
  id: string;
  title: string;
  summary?: React.ReactNode;
  children: React.ReactNode;
}

function Section({ id, title, summary, children }: SectionProps) {
  const collapsedSections = useUIPreferencesStore(
    state => state.dashboard?.collapsedSections ?? [],
  );
  const toggleDashboardSection = useUIPreferencesStore(state => state.toggleDashboardSection);
  const collapsed = collapsedSections.includes(id);

  return (
    <section className="flex flex-col" data-testid={`ops-section-${id}`}>
      <div className="flex items-center gap-1.5 h-6 px-2">
        <ButtonBase
          type="button"
          aria-label={collapsed ? t('dashboard.cc.matrix.expand') : t('dashboard.cc.matrix.collapse')}
          onClick={() => toggleDashboardSection(id)}
          className="p-0.5 rounded text-slate-600 hover:text-white transition-colors"
        >
          {collapsed ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </ButtonBase>
        <span
          aria-hidden="true"
          className="w-0.5 h-3 rounded-full bg-gradient-to-b from-indigo-400 to-violet-500"
        />
        <h3 className="text-[10px] uppercase tracking-[0.14em] text-slate-400 font-medium select-none">
          {title}
        </h3>
        {summary}
      </div>
      {!collapsed && <div className="flex flex-col">{children}</div>}
    </section>
  );
}

export function OpsMatrix({
  fleetRows,
  onTargetChange,
  onRefreshProvider,
  onRegisterProvider,
  onOpenAccounts,
  onTogglePin,
  services,
  subsystems,
  now,
}: OpsMatrixProps) {
  const [restartingId, setRestartingId] = useState<string | null>(null);
  const logs = useServicePluginLogs();

  const sortedFleetRows = useMemo(() => {
    const pinned = fleetRows.filter(row => row.pinned);
    const rest = fleetRows.filter(row => !row.pinned);
    return [...pinned, ...rest];
  }, [fleetRows]);

  const fleetTotals = useMemo(
    () =>
      fleetRows.reduce(
        (acc, row) => ({ active: acc.active + row.active, target: acc.target + row.target }),
        { active: 0, target: 0 },
      ),
    [fleetRows],
  );

  const servicesRunning = useMemo(
    () => services.filter(plugin => plugin.status.status === 'running').length,
    [services],
  );

  const hasRegData = fleetRows.some(
    r => r.spark.some(v => v > 0) || r.successDeltaPct !== null,
  );

  const handleRestart = useCallback(async (pluginId: string) => {
    setRestartingId(pluginId);
    try {
      await restartServicePlugin(pluginId);
      toast.success(t('admin.plugins.servicePluginRestarted'));
    } catch {
      toast.error(t('admin.plugins.servicePluginRestartFailed'));
    } finally {
      setRestartingId(null);
    }
  }, []);

  return (
    <div
      className="min-h-0 overflow-y-auto flex flex-col gap-2 rounded-lg bg-black/40 backdrop-blur-sm border border-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-shadow hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_0_28px_rgba(99,102,241,0.07)] py-2"
      data-testid="ops-matrix"
    >
      <Section
        id="fleet"
        title={t('dashboard.cc.matrix.fleet')}
        summary={
          <span className="text-[10px] tabular-nums text-slate-500 truncate">
            {t('dashboard.cc.matrix.fleetSummary', {
              active: fleetTotals.active,
              target: fleetTotals.target,
            })}
          </span>
        }
      >
        <MatrixHeader compact={!hasRegData} />
        {sortedFleetRows.map((row, index) => (
          <FleetRow
            key={row.providerId}
            row={row}
            index={index}
            compact={!hasRegData}
            onTargetChange={onTargetChange}
            onRefresh={onRefreshProvider}
            onRegister={onRegisterProvider}
            onOpenAccounts={onOpenAccounts}
            onTogglePin={onTogglePin}
          />
        ))}
      </Section>

      <Section
        id="services"
        title={t('dashboard.cc.matrix.services')}
        summary={
          <span
            className={cn(
              'text-[10px] tabular-nums truncate',
              servicesRunning === services.length ? 'text-emerald-400' : 'text-amber-400',
            )}
          >
            {t('dashboard.cc.matrix.servicesSummary', {
              running: servicesRunning,
              total: services.length,
            })}
          </span>
        }
      >
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-1.5 px-2 pb-1">
          {services.map((plugin, index) => (
            <ServiceRow
              key={plugin.id}
              plugin={plugin}
              index={index}
              restarting={restartingId === plugin.id}
              onRestart={pluginId => void handleRestart(pluginId)}
              onLogs={pluginId => void logs.open(pluginId)}
            />
          ))}
        </div>
      </Section>

      <Section id="subsystems" title={t('dashboard.cc.matrix.subsystems')}>
        <SubsystemChips
          pluginsInstalled={subsystems.pluginsInstalled}
          mailProfiles={subsystems.mailProfiles}
          totpKeys={subsystems.totpKeys}
          schedulerTasks={subsystems.schedulerTasks}
          friends={subsystems.friends}
          radarOffers={subsystems.radarOffers}
          nextRunUnix={subsystems.nextRunUnix}
          now={now}
        />
      </Section>

      <Modal
        isOpen={logs.openPluginId !== null}
        onClose={logs.close}
        title={t('admin.plugins.servicePluginLogs')}
        size="lg"
        isLoading={logs.loading}
      >
        <div
          className={cn(
            'font-mono text-[11px] leading-relaxed text-slate-300 whitespace-pre-wrap break-all',
            'max-h-[50vh] overflow-y-auto',
          )}
        >
          {logs.lines && logs.lines.length > 0
            ? logs.lines.join('\n')
            : t('admin.plugins.servicePluginLogsUnavailable')}
        </div>
      </Modal>
    </div>
  );
}
