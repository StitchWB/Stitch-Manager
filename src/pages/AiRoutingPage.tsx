import { useState, useCallback, useEffect } from 'react';
import { Zap } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import Header from '../components/layout/Header';
import { IdeConfigWizard } from '../components/ai-proxy/IdeConfigWizard';
import { VellyConnectionCard } from '../components/ai-proxy/VellyConnectionCard';
import { AiProxyControlsSection } from '../components/ai-proxy/sections/AiProxyControlsSection';
import { UserProxyCard } from '../components/ai-proxy/UserProxyCard';
import { RotationSettingsPanel } from '../components/ai-proxy/sections/RotationSettingsPanel';
import { CompressionSection } from '../components/ai-proxy/sections/CompressionSection';
import { HoloneSection } from '../components/ai-proxy/sections/HoloneSection';
import { RoutingGraphBoard } from '../components/ai-proxy/sections/RoutingGraphBoard';
import { MappingsEditor } from '../components/ai-proxy/sections/MappingsEditor';
import { PublicModelsSection } from '../components/ai-gateway/PublicModelsSection';
import { useAiProvidersController, maskKey } from './hooks/useAiProvidersController';
import { useAiHubCopy } from './hooks/useAiHubCopy';
import { useRoutingBoardStatus } from './hooks/useRoutingBoardStatus';
import type { ProxySettings } from '../types/generated';
import { ButtonBase, PageHeader } from '@/components/ui';
import { t } from '../lib/i18n';
import { useAppStore } from '../stores/app';

const ROUTING_TABS = ['board', 'mappings', 'models', 'proxy', 'rotation', 'compression', 'holone'] as const;
type RoutingTab = (typeof ROUTING_TABS)[number];

const ROUTING_TAB_LABELS: Record<RoutingTab, string> = {
  board: 'aiHub.tabs.board',
  mappings: 'aiHub.tabs.mappings',
  models: 'aiHub.tabs.models',
  proxy: 'aiHub.tabs.proxy',
  rotation: 'aiHub.tabs.rotation',
  compression: 'aiHub.tabs.compression',
  holone: 'aiHub.tabs.holone',
};

const CLIENT_API_KEY = 'proxystitch-local';

export default function AiRoutingPage() {
  const navigate = useNavigate();
  const language = useAppStore(state => state.language);
  const [searchParams, setSearchParams] = useSearchParams();
  const [isIdeWizardOpen, setIsIdeWizardOpen] = useState(false);
  const controller = useAiProvidersController('routing');
  const boardStatus = useRoutingBoardStatus();

  const {
    accounts,
    modelMappings,
    proxyStatus,
    proxySettings,
    proxyDraft,
    setProxyDraft,
    proxyBusy,
    proxySaving,
    proxyError,
    baseUrl,
    providerCapabilities,
    isProxyDraftDirty,
    refreshProxyInfo,
    handleSaveProxySettings,
    handleResetProxyDraft,
    handleStartStopProxy,
    upsertMapping,
    addMapping,
    removeMapping,
    handleSaveMappings,
  } = controller;

  const handleCopy = useAiHubCopy();

  const tabParam = searchParams.get('tab');
  const routingTab: RoutingTab = (ROUTING_TABS as readonly string[]).includes(tabParam ?? '')
    ? (tabParam as RoutingTab)
    : 'board';

  useEffect(() => {
    if (tabParam === null) return;
    if ((ROUTING_TABS as readonly string[]).includes(tabParam)) return;
    setSearchParams(
      prev => {
        prev.set('tab', 'board');
        return prev;
      },
      { replace: true },
    );
  }, [tabParam, setSearchParams]);

  const openRoutingTab = useCallback(
    (tab: RoutingTab) => {
      setSearchParams(
        prev => {
          prev.set('tab', tab);
          return prev;
        },
      );
    },
    [setSearchParams]
  );

  const setProxyDraftWithUpdater = useCallback(
    (updater: (prev: ProxySettings | null) => ProxySettings | null) => {
      setProxyDraft(prev => updater(prev));
    },
    [setProxyDraft]
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-void-base">
      <Header title={t('sidebar.aiHub')} icon={<Zap size={18} />} />

      <PageHeader
        eyebrow={t('sidebar.aiHub')}
        title={t('aiHub.sections.routing.title')}
        description={
          language === 'ru'
            ? 'Настройте источники, правила выбора, ротацию и единый AI Proxy.'
            : 'Configure sources, selection rules, rotation, and the shared AI Proxy.'
        }
        className="px-4 py-2.5 md:px-5 md:py-3"
      />

      <div className="shrink-0 border-b border-white/[0.06] px-4 md:px-6">
        <div className="mx-auto flex w-full max-w-[1500px] items-center gap-1 overflow-x-auto py-2">
          {ROUTING_TABS.map(tabId => {
            const active = routingTab === tabId;
            return (
              <ButtonBase
                key={tabId}
                type="button"
                onClick={() => openRoutingTab(tabId)}
                aria-current={active ? 'true' : undefined}
                className={
                  active
                    ? 'shrink-0 rounded-md bg-indigo-500/12 px-3 py-1.5 text-xs font-medium text-white ring-1 ring-inset ring-indigo-400/20'
                    : 'shrink-0 rounded-md px-3 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:bg-white/[0.04] hover:text-slate-200'
                }
              >
                {t(ROUTING_TAB_LABELS[tabId])}
              </ButtonBase>
            );
          })}
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 space-y-3 overflow-auto p-3 md:p-4">
          <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-3">
            {routingTab === 'board' && <VellyConnectionCard />}
            {routingTab === 'board' && (
              <RoutingGraphBoard
                accounts={accounts}
                mappings={modelMappings}
                proxyStatus={proxyStatus}
                proxySettings={proxySettings}
                baseUrl={baseUrl}
                autoSwitchEnabled={boardStatus.autoSwitchEnabled}
                proxyBusy={proxyBusy}
                holoneEnabled={boardStatus.holoneEnabled}
                holoneMode={boardStatus.holoneMode}
                holoneRuleCount={boardStatus.holoneRuleCount}
                holoneFindingsCount={boardStatus.holoneFindingsCount}
                cavemanEnabled={boardStatus.cavemanEnabled}
                cavemanLevel={boardStatus.cavemanLevel}
                compressionEnabled={boardStatus.compressionEnabled}
                onOpenHolone={() => openRoutingTab('holone')}
                onOpenProviders={() => navigate('/ai/providers')}
                onOpenMappings={() => openRoutingTab('mappings')}
                onOpenRotation={() => openRoutingTab('rotation')}
                onOpenProxy={() => openRoutingTab('proxy')}
                onOpenCompression={() => openRoutingTab('compression')}
                onStartStopProxy={handleStartStopProxy}
              />
            )}

            {routingTab === 'mappings' && (
              <MappingsEditor
                modelMappings={modelMappings}
                onAddMapping={addMapping}
                onUpsertMapping={upsertMapping}
                onRemoveMapping={removeMapping}
                onSaveMappings={handleSaveMappings}
              />
            )}

            {routingTab === 'models' && <PublicModelsSection />}

            {routingTab === 'proxy' && (
              <>
                <UserProxyCard />
                <AiProxyControlsSection
                  visible
                  proxyStatus={proxyStatus}
                  proxySettings={proxySettings}
                  proxyDraft={proxyDraft}
                  proxyBusy={proxyBusy}
                  proxySaving={proxySaving}
                  proxyError={proxyError}
                  baseUrl={baseUrl}
                  clientApiKey={CLIENT_API_KEY}
                  isProxyDraftDirty={isProxyDraftDirty}
                  maskKey={maskKey}
                  onSetProxyDraft={setProxyDraftWithUpdater}
                  onCopy={handleCopy}
                  onOpenIdeWizard={() => setIsIdeWizardOpen(true)}
                  onResetDraft={handleResetProxyDraft}
                  onSaveSettings={handleSaveProxySettings}
                  onStartStopProxy={handleStartStopProxy}
                  onRefreshProxyInfo={refreshProxyInfo}
                  showIdeWizardAction={false}
                  showProxyActions
                  showConfigActions
                  showRuntimeActions
                />
              </>
            )}

            {routingTab === 'rotation' && (
              <RotationSettingsPanel capabilities={providerCapabilities} visible />
            )}

            {routingTab === 'compression' && <CompressionSection />}

            {routingTab === 'holone' && <HoloneSection />}
          </div>
        </div>
      </div>

      <IdeConfigWizard isOpen={isIdeWizardOpen} onClose={() => setIsIdeWizardOpen(false)} />
    </div>
  );
}
