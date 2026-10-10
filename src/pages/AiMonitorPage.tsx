import { useState, useEffect } from 'react';
import { Bug, MessageSquare, RefreshCw, Zap } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import Header from '../components/layout/Header';
import AiAnalytics from './AiAnalytics';
import { MonitorOverview } from '../components/ai-proxy/sections/MonitorOverview';
import { ProxyDebugDrawer } from '../components/ai-proxy/ProxyDebugDrawer';
import { useAiProvidersController } from './hooks/useAiProvidersController';
import { Button, IconButton, OverflowMenu, PageHeader, Tooltip } from '@/components/ui';
import { t } from '../lib/i18n';

const MONITOR_TABS = ['overview', 'analytics'] as const;
type MonitorTab = (typeof MONITOR_TABS)[number];

export default function AiMonitorPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showDebugDrawer, setShowDebugDrawer] = useState(false);
  const controller = useAiProvidersController();

  const {
    proxyStatus,
    proxySettings,
    providerCapabilities,
    availableModels,
    historySummary,
    filteredAccounts,
    accountReadiness,
    proxyBusy,
    refreshProxyInfo,
    handleDebugMigration,
  } = controller;

  const tabParam = searchParams.get('tab');
  const monitorTab: MonitorTab = (MONITOR_TABS as readonly string[]).includes(tabParam ?? '')
    ? (tabParam as MonitorTab)
    : 'overview';

  useEffect(() => {
    if (tabParam === null) return;
    if ((MONITOR_TABS as readonly string[]).includes(tabParam)) return;
    setSearchParams(
      prev => {
        prev.set('tab', 'overview');
        return prev;
      },
      { replace: true },
    );
  }, [tabParam, setSearchParams]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-void-base">
      <Header title={t('sidebar.aiHub')} icon={<Zap size={18} />} />

      <PageHeader
        eyebrow={t('sidebar.aiHub')}
        title={t('aiHub.sections.monitor.title')}
        description={t('aiHub.sections.monitor.subtitle')}
        actions={
          <>
            <Button
              variant="primary"
              size="sm"
              onClick={() => navigate('/ai/monitor?tab=analytics')}
            >
              {t('aiHub.actions.openDetailedAnalytics')}
            </Button>
            <Tooltip content={t('aiHub.actions.refresh')}>
              <IconButton
                size="md"
                variant="ghost"
                onClick={() => {
                  void refreshProxyInfo();
                }}
                disabled={proxyBusy}
                aria-label={t('aiHub.actions.refresh')}
              >
                <RefreshCw size={16} className={proxyBusy ? 'animate-spin' : undefined} />
              </IconButton>
            </Tooltip>
            <OverflowMenu
              triggerLabel={t('common.more')}
              items={[
                {
                  id: 'debug-chat',
                  label: t('aiHub.actions.openDebugChat'),
                  icon: <MessageSquare size={14} />,
                  onSelect: () => navigate('/ai/chat'),
                },
                {
                  id: 'run-migration',
                  label: t('aiHub.actions.runMigration'),
                  icon: <Bug size={14} />,
                  onSelect: handleDebugMigration,
                },
              ]}
            />
          </>
        }
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 space-y-4 overflow-auto p-4 md:p-6">
          {monitorTab === 'overview' ? (
            <MonitorOverview
              proxyStatus={proxyStatus}
              proxySettings={proxySettings}
              providerCapabilities={providerCapabilities}
              availableModels={availableModels}
              historySummary={historySummary}
              hasAccounts={filteredAccounts.length > 0}
              accountReadiness={accountReadiness}
              onOpenAnalytics={() => navigate('/ai/monitor?tab=analytics')}
              onOpenDebugChat={() => setShowDebugDrawer(true)}
            />
          ) : (
            <AiAnalytics />
          )}
        </div>
      </div>

      <ProxyDebugDrawer isOpen={showDebugDrawer} onClose={() => setShowDebugDrawer(false)} />
    </div>
  );
}
