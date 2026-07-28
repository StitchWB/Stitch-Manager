import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Repeat, Settings as SettingsIcon } from 'lucide-react';

import Header from '../components/layout/Header';
import { AutomationTopTabs, resolveAutomationTab } from '../components/automation/AutomationTopTabs';
import type { AutomationTabId } from '../components/automation/AutomationTopTabs';
import { Button, MetricStrip, PageHeader } from '@/components/ui';
import type { MetricSegment } from '@/components/ui';
import { t } from '@/lib/i18n';
import { getScheduledTasks } from '../lib/backend/modules/scheduler';
import { getSettings } from '../lib/backend/modules/settings';
import {
  getBackgroundManagerConfig,
  type BackgroundManagerConfig,
} from '../lib/backend/modules/backgroundManager';
import type { ScheduledTask, SettingsData } from '../types/generated';

import Scheduler from './Scheduler';
import Scenarios from './Scenarios';
import { AutomationTab } from '../components/registration/AutomationTab';

function formatNextRun(epochSeconds: number | null): string {
  if (!epochSeconds || !Number.isFinite(epochSeconds)) {
    return t('automation.kpi.noNextRun');
  }
  try {
    return new Date(epochSeconds * 1000).toLocaleTimeString();
  } catch {
    return t('automation.kpi.noNextRun');
  }
}

interface AutomationKpiState {
  tasks: ScheduledTask[];
  settings: SettingsData | null;
  bgConfig: BackgroundManagerConfig | null;
}

export default function Automation() {
  const navigate = useNavigate();
  const { tab } = useParams<{ tab?: string }>();
  const currentTab: AutomationTabId = useMemo(() => resolveAutomationTab(tab), [tab]);

  const [kpi, setKpi] = useState<AutomationKpiState>({
    tasks: [],
    settings: null,
    bgConfig: null,
  });

  const refreshKpis = useCallback(async () => {
    const [tasksResult, settingsResult, bgResult] = await Promise.allSettled([
      getScheduledTasks(),
      getSettings(),
      getBackgroundManagerConfig(),
    ]);

    setKpi({
      tasks: tasksResult.status === 'fulfilled' ? tasksResult.value : [],
      settings: settingsResult.status === 'fulfilled' ? settingsResult.value : null,
      bgConfig: bgResult.status === 'fulfilled' ? bgResult.value : null,
    });
  }, []);

  useEffect(() => {
    void refreshKpis();
  }, [refreshKpis]);

  const enabledTasks = useMemo(() => kpi.tasks.filter(task => task.enabled), [kpi.tasks]);
  const tasksRunningCount = enabledTasks.length;
  const nextRunTimestamp = useMemo(() => {
    if (enabledTasks.length === 0) return null;
    return enabledTasks.reduce<number>(
      (min, task) => (task.nextRun < min ? task.nextRun : min),
      enabledTasks[0].nextRun
    );
  }, [enabledTasks]);

  const autoReplenishOn = Boolean(kpi.settings?.autoReplenishEnabled);
  const autoSwitchOn = Boolean(kpi.bgConfig?.autoSwitchEnabled);

  const onText = t('automation.kpi.on');
  const offText = t('automation.kpi.off');

  const metricSegments: MetricSegment[] = [
    {
      id: 'tasks-running',
      label: t('automation.kpi.tasksRunning'),
      value: tasksRunningCount,
      tone: tasksRunningCount > 0 ? 'info' : 'neutral',
      onClick: () => navigate('/automation/schedule'),
    },
    {
      id: 'next-run',
      label: t('automation.kpi.nextRun'),
      value: formatNextRun(nextRunTimestamp),
      tone: 'neutral',
      onClick: () => navigate('/automation/schedule'),
    },
    {
      id: 'auto-replenish',
      label: t('automation.kpi.autoReplenish'),
      value: autoReplenishOn ? onText : offText,
      tone: autoReplenishOn ? 'success' : 'neutral',
      onClick: () => navigate('/automation/replenishment'),
    },
    {
      id: 'auto-switch',
      label: t('automation.kpi.autoSwitch'),
      value: autoSwitchOn ? onText : offText,
      tone: autoSwitchOn ? 'success' : 'neutral',
    },
  ];

  // === Page header config per tab ===
  const headerConfig = useMemo(() => {
    if (currentTab === 'scenarios') {
      return {
        title: t('automation.tabs.scenarios'),
        description: t('automation.scenarios.subtitle'),
        actions: null as React.ReactNode,
      };
    }
    if (currentTab === 'replenishment') {
      return {
        title: t('automation.tabs.replenishment'),
        description: t('automation.replenishment.subtitle'),
        actions: (
          <Button variant="secondary" onClick={() => navigate('/settings')}>
            <SettingsIcon size={16} />
            {t('sidebar.settings')}
          </Button>
        ) as React.ReactNode,
      };
    }
    return {
      title: t('automation.tabs.schedule'),
      description: t('automation.schedule.subtitle'),
      actions: (
        <Button variant="primary" onClick={() => navigate('/scheduler')}>
          <Plus size={16} />
          {t('sidebar.scheduler')}
        </Button>
      ) as React.ReactNode,
    };
  }, [currentTab, navigate]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-vsc-bg">
      <Header title={t('sidebar.automation')} icon={<Repeat size={18} />} />

      <AutomationTopTabs />

      <div className="px-6 pt-4">
        <MetricStrip segments={metricSegments} density="compact" />
      </div>

      <PageHeader
        eyebrow={t('automation.title')}
        title={headerConfig.title}
        description={headerConfig.description}
        actions={headerConfig.actions}
      />

      <div className="flex-1 overflow-hidden">
        {currentTab === 'schedule' && <Scheduler embedded />}
        {currentTab === 'scenarios' && <Scenarios embedded />}
        {currentTab === 'replenishment' && (
          <div className="h-full overflow-auto p-6">
            <AutomationTab />
          </div>
        )}
      </div>
    </div>
  );
}
