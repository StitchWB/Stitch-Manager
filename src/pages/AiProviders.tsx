import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  AlertTriangle,
  Bug,
  ClipboardPaste,
  Database,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { API_BASE_URL } from '@/lib/backend/core/invoke';
import { askConfirm } from '@/components/ui/ConfirmDialogHost';
import { appToast } from '@/lib/observability/toast';

import Header from '../components/layout/Header';
import AccountModal from '../components/ai-proxy/AccountModal';
import { PastePackageDialog } from '@/components/ai-gateway/PastePackageDialog';
import { PublicModelsSection } from '@/components/ai-gateway/PublicModelsSection';
import { ProviderEndpointForm } from '@/components/ai-gateway/ProviderEndpointForm';
import { importOpencodeProviders } from '@/lib/backend/modules/aiGateway';
import { useAiGatewayStore } from '@/stores/aiGateway';
import { useAiProxyStore } from '../stores/aiProxy';
import { IdeConfigWizard } from '../components/ai-proxy/IdeConfigWizard';
import { AiProvidersSidebar } from '../components/ai-proxy/sections/AiProvidersSidebar';
import { AiProxyControlsSection } from '../components/ai-proxy/sections/AiProxyControlsSection';
import { UserProxyCard } from '../components/ai-proxy/UserProxyCard';
import { RotationSettingsPanel } from '../components/ai-proxy/sections/RotationSettingsPanel';
import { CompressionSection } from '../components/ai-proxy/sections/CompressionSection';
import { HoloneSection } from '../components/ai-proxy/sections/HoloneSection';
import { RoutingGraphBoard } from '../components/ai-proxy/sections/RoutingGraphBoard';
import { MappingsEditor } from '../components/ai-proxy/sections/MappingsEditor';
import { ProviderCardsSection } from '../components/ai-proxy/ProviderCardsSection';
import { AiProxyAccountDrawer } from '../components/ai-proxy/AiProxyAccountDrawer';
import { AiTransferModal } from '../components/ai-proxy/modals/AiTransferModal';
import { AiMappingsModal } from '../components/ai-proxy/modals/AiMappingsModal';
import { ProxyStatusBar } from '../components/ai-proxy/sections/ProxyStatusBar';
import { MonitorOverview } from '../components/ai-proxy/sections/MonitorOverview';
import { ProxyDebugDrawer } from '../components/ai-proxy/ProxyDebugDrawer';
import { AiProvidersKeysSection } from '../components/ai-proxy/sections/AiProvidersKeysSection';
import { useAiProvidersController, maskKey } from './hooks/useAiProvidersController';
import type { ProxySettings, AiProxyAccount } from '../types/generated';
import {
  Button,
  IconButton,
  Input,
  OverflowMenu,
  PageHeader,
  Tooltip,
} from '@/components/ui';
import { getBackgroundManagerConfig } from '../lib/backend/modules/backgroundManager';
import { t } from '../lib/i18n';
import { useAppStore } from '../stores/app';

const CLIENT_API_KEY = 'proxystitch-local';

type AiSection = 'providers' | 'routing' | 'monitor';

const ROUTING_TABS = ['board', 'mappings', 'proxy', 'rotation', 'compression', 'holone'] as const;
const MONITOR_TABS = ['overview', 'analytics'] as const;
type RoutingTab = (typeof ROUTING_TABS)[number];

function resolveSection(pathname: string): AiSection {
  const suffix = pathname.replace(/^\/ai\/?/, '');
  if (suffix === 'routing') return 'routing';
  if (suffix === 'monitor') return 'monitor';
  return 'providers';
}

export default function AiProviders() {
  const navigate = useNavigate();
  const language = useAppStore(state => state.language);
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AiProxyAccount | null>(null);
  const [drawerAccount, setDrawerAccount] = useState<AiProxyAccount | null>(null);
  const [isMappingsModalOpen, setIsMappingsModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferMode] = useState<'import' | 'export'>('import');
  const [isIdeWizardOpen, setIsIdeWizardOpen] = useState(false);
  const [showDebugDrawer, setShowDebugDrawer] = useState(false);
  const [autoSwitchEnabled, setAutoSwitchEnabled] = useState<boolean | null>(null);
  const [holoneEnabled, setHoloneEnabled] = useState(false);
  const [holoneMode, setHoloneMode] = useState<'monitor' | 'block'>('monitor');
  const [holoneRuleCount, setHoloneRuleCount] = useState(0);
  const [holoneFindingsCount, setHoloneFindingsCount] = useState(0);
  const [cavemanEnabled, setCavemanEnabled] = useState(false);
  const [cavemanLevel, setCavemanLevel] = useState<'lite' | 'full' | 'ultra'>('full');
  const [compressionEnabled, setCompressionEnabled] = useState(false);
  const [addEndpointOpen, setAddEndpointOpen] = useState(false);
  const [gatewayActionBusy, setGatewayActionBusy] = useState(false);
  const migrateLegacyData = useAiGatewayStore(s => s.migrateLegacyData);
  const fetchEndpoints = useAiGatewayStore(s => s.fetchEndpoints);
  const fetchPublicModels = useAiGatewayStore(s => s.fetchPublicModels);
  const proxyStoreStatus = useAiProxyStore(s => s.status);
  const serverOffline = !(proxyStoreStatus?.running ?? false);
  const controller = useAiProvidersController();

  const {
    accounts,
    loading,
    searchQuery,
    setSearchQuery,
    providerFilter,
    setProviderFilter,
    availableModels,
    providerCapabilities,
    modelMappings,
    proxyStatus,
    proxySettings,
    proxyDraft,
    setProxyDraft,
    proxyBusy,
    proxySaving,
    proxyError,
    authScan,
    authScanLoading,
    connectionState,
    historySummary,
    exportFormat,
    setExportFormat,
    exportIncludeSecrets,
    setExportIncludeSecrets,
    exportPayload,
    exportLoading,
    importPayload,
    setImportPayload,
    importLoading,
    importValidation,
    filteredAccounts,
    providerCounts,
    accountReadiness,
    baseUrl,
    isProxyDraftDirty,
    effectiveExportIncludeSecrets,
    fetchAccounts,
    refreshProxyInfo,
    handleSaveProxySettings,
    handleResetProxyDraft,
    handleStartStopProxy,
    scanAuthFiles,
    handleDelete,
    handleDebugMigration,
    handleTestConnection,
    upsertMapping,
    addMapping,
    removeMapping,
    handleSaveMappings,
    downloadText,
    buildExportFileName,
    handleGenerateExport,
    handleImportPayload,
    handlePrepareImportFromScan,
    handleImportAllFromScan,
  } = controller;

  const handleCopy = useCallback(
    async (label: string, value: string, requireConfirm = false) => {
      if (!value) {
        toast.error(t('aiHub.copy.empty'));
        return;
      }
      if (requireConfirm) {
        const ok = await askConfirm({
          title: t('common.copy'),
          message: t('aiHub.warnings.copySensitiveConfirm', { label }),
          confirmText: t('common.copy'),
          cancelText: t('common.cancel'),
          variant: 'warning',
        });
        if (!ok) return;
      }
      try {
        await navigator.clipboard.writeText(value);
        toast.success(t('aiHub.copy.success', { label }));
      } catch (e) {
        console.error('[AiProviders] Copy failed:', e);
        toast.error(t('aiHub.copy.fail', { label }));
      }
    },
    []
  );

  const handleEdit = useCallback((account: AiProxyAccount) => {
    setEditingAccount(account);
    setIsModalOpen(true);
  }, []);

  const handleOpenDrawer = useCallback((account: AiProxyAccount) => {
    setDrawerAccount(account);
  }, []);

  const handleAddNew = useCallback(() => {
    setEditingAccount(null);
    setIsModalOpen(true);
  }, []);

  const handleModalClose = useCallback(() => {
    setIsModalOpen(false);
    setEditingAccount(null);
  }, []);

  const handleDrawerClose = useCallback(() => {
    setDrawerAccount(null);
  }, []);

  const handleModalSubmit = useCallback(async () => {
    await fetchAccounts();
    handleModalClose();
  }, [fetchAccounts, handleModalClose]);

  const handleImportOpencode = useCallback(async () => {
    setGatewayActionBusy(true);
    try {
      const report = await importOpencodeProviders();
      if (report.imported.length === 0) {
        appToast.info(t('aiGateway.importOpencodeEmpty'), 'ai-gateway');
      } else {
        appToast.success(
          t('aiGateway.importOpencodeResult', {
            providers: report.imported.length,
            models: report.models.length,
          }),
          'ai-gateway'
        );
      }
      await Promise.all([fetchEndpoints(), fetchPublicModels()]);
    } catch (e) {
      appToast.error(e instanceof Error ? e.message : 'Import failed', 'ai-gateway');
    } finally {
      setGatewayActionBusy(false);
    }
  }, [fetchEndpoints, fetchPublicModels]);

  const handleMigrateLegacy = useCallback(async () => {
    setGatewayActionBusy(true);
    try {
      const result = await migrateLegacyData();
      appToast.success(
        `Migrated ${result.endpoints_created} endpoints, ${result.credentials_created} credentials`,
        'ai-gateway'
      );
      await Promise.all([fetchEndpoints(), fetchPublicModels()]);
    } catch (e) {
      appToast.error(e instanceof Error ? e.message : 'Migration failed', 'ai-gateway');
    } finally {
      setGatewayActionBusy(false);
    }
  }, [migrateLegacyData, fetchEndpoints, fetchPublicModels]);

  const aiSection = useMemo<AiSection>(() => resolveSection(location.pathname), [location.pathname]);

  const tabParam = searchParams.get('tab');
  const routingTab: RoutingTab = (ROUTING_TABS as readonly string[]).includes(tabParam ?? '')
    ? (tabParam as RoutingTab)
    : 'board';

  useEffect(() => {
    if (tabParam === null) return;
    const validTabs = aiSection === 'routing' ? ROUTING_TABS : aiSection === 'monitor' ? MONITOR_TABS : null;
    if (!validTabs || (validTabs as readonly string[]).includes(tabParam)) return;
    setSearchParams(
      prev => {
        prev.set('tab', validTabs[0]);
        return prev;
      },
      { replace: true },
    );
  }, [aiSection, tabParam, setSearchParams]);

  // Lightweight fetch of the background-manager autoSwitch flag for the routing flow.
  useEffect(() => {
    if (aiSection !== 'routing') return;
    let cancelled = false;
    (async () => {
      try {
        const cfg = await getBackgroundManagerConfig();
        if (!cancelled) setAutoSwitchEnabled(cfg.autoSwitchEnabled);
      } catch (err) {
        console.warn('[AiProviders] Failed to fetch background-manager config:', err);
        if (!cancelled) setAutoSwitchEnabled(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [aiSection]);

  // Fetch HoloNe security status for routing flow
  useEffect(() => {
    if (aiSection !== 'routing') return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/holone/status`);
        if (!res.ok) throw new Error('holone status fetch failed');
        const data = await res.json();
        if (!cancelled) {
          setHoloneEnabled(data.enabled);
          setHoloneMode(data.mode);
          setHoloneRuleCount(data.rule_count);
          setHoloneFindingsCount(data.findings_count);
        }
      } catch {
        // ponytail: holone may not be running; silently ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [aiSection]);

  // Fetch Caveman/compression status for routing graph
  useEffect(() => {
    if (aiSection !== 'routing') return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/compression/status`);
        if (!res.ok) throw new Error('compression status fetch failed');
        const data = await res.json();
        if (!cancelled) {
          setCavemanEnabled(data.caveman_enabled ?? false);
          setCavemanLevel(data.caveman_level ?? 'full');
          setCompressionEnabled(data.compression_enabled ?? false);
        }
      } catch {
        // ponytail: compression may not be running; silently ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [aiSection]);

  const setProxyDraftWithUpdater = useCallback(
    (updater: (prev: ProxySettings | null) => ProxySettings | null) => {
      setProxyDraft(prev => updater(prev));
    },
    [setProxyDraft]
  );

  // === Page header config per section ===
  const headerForSection = (() => {
    if (aiSection === 'routing') {
      return {
        eyebrow: t('sidebar.aiHub'),
        title: t('aiHub.sections.routing.title'),
        description:
          language === 'ru'
            ? 'Настройте источники, правила выбора, ротацию и единый AI Proxy.'
            : 'Configure sources, selection rules, rotation, and the shared AI Proxy.',
        actions: null,
      };
    }

    if (aiSection === 'monitor') {
      return {
        eyebrow: t('sidebar.aiHub'),
        title: t('aiHub.sections.monitor.title'),
        description: t('aiHub.sections.monitor.subtitle'),
        actions: (
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
        ),
      };
    }
    return {
      eyebrow: t('sidebar.aiHub'),
      title: t('aiHub.sections.providers.title'),
      description: t('aiHub.sections.providers.subtitle'),
      actions: (
        <>
          <Button
            variant="primary"
            size="sm"
            onClick={handleAddNew}
            leftIcon={<Plus size={14} />}
          >
            {t('aiHub.actions.addAccount')}
          </Button>
          <OverflowMenu
            triggerLabel={t('common.more')}
            items={[
              {
                id: 'import-opencode',
                label: t('aiGateway.importOpencode'),
                icon: <Zap size={14} />,
                onSelect: () => void handleImportOpencode(),
                disabled: gatewayActionBusy,
              },
              {
                id: 'migrate-legacy',
                label: t('aiGateway.migrate'),
                icon: <Database size={14} />,
                onSelect: () => void handleMigrateLegacy(),
                disabled: gatewayActionBusy,
              },
              {
                id: 'paste-package',
                label: t('aiGateway.paste.button'),
                icon: <ClipboardPaste size={14} />,
                onSelect: () => setPasteOpen(true),
              },
            ]}
          />
        </>
      ),
    };
  })();

  return (
    <div className="flex flex-col h-full overflow-hidden bg-void-base">
      <Header title={t('sidebar.aiHub')} icon={<Zap size={18} />} />

      <PageHeader
        eyebrow={headerForSection.eyebrow}
        title={headerForSection.title}
        description={headerForSection.description}
        actions={headerForSection.actions}
        className={aiSection === 'routing' ? 'px-4 py-2.5 md:px-5 md:py-3' : undefined}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar Filter Panel — only on Providers */}
        {aiSection === 'providers' && (
          <AiProvidersSidebar
            providerFilter={providerFilter}
            providerCounts={providerCounts}
            onSelectProvider={setProviderFilter}
          />
        )}

        <div className="flex-1 flex flex-col overflow-hidden">
          <div
            className={
              aiSection === 'routing'
                ? 'flex-1 space-y-3 overflow-auto p-3 md:p-4'
                : 'flex-1 space-y-4 overflow-auto p-4 md:p-6'
            }
          >
            {/* === PROVIDERS TAB === */}
            {aiSection === 'providers' && (
              <>
                {serverOffline && (
                  <div
                    role="status"
                    className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-2 text-xs font-medium text-amber-300"
                  >
                    <AlertTriangle size={14} className="shrink-0" />
                    {t('aiHub.warnings.serverOffline')}
                  </div>
                )}

                <ProxyStatusBar
                  proxyStatus={proxyStatus}
                  proxySettings={proxySettings}
                  baseUrl={baseUrl}
                  clientApiKey={CLIENT_API_KEY}
                  proxyBusy={proxyBusy}
                  proxySaving={proxySaving}
                  onStartStopProxy={handleStartStopProxy}
                  onRefreshProxyInfo={refreshProxyInfo}
                  onCopy={handleCopy}
                />

                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder={t('aiHub.search.placeholder')}
                    leftIcon={<Search className="w-4 h-4" />}
                    containerClassName="flex-1 min-w-0"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    leftIcon={<Plus size={14} />}
                    onClick={() => setAddEndpointOpen(true)}
                  >
                    {t('aiGateway.list.addEndpointShort')}
                  </Button>
                </div>

                <ProviderCardsSection
                  accounts={accounts}
                  loading={loading}
                  providerFilter={providerFilter}
                  searchQuery={searchQuery}
                  connectionState={connectionState}
                  onAccountClick={handleOpenDrawer}
                  onEditAccount={handleEdit}
                  onDeleteAccount={id => {
                    void handleDelete(id);
                  }}
                  onTestConnection={account => {
                    void handleTestConnection(account);
                  }}
                  onPastePackage={() => setPasteOpen(true)}
                />

                <AiProvidersKeysSection providerFilter={providerFilter} />

                <PublicModelsSection />
              </>
            )}

            {/* === ROUTING TAB === */}
            {aiSection === 'routing' && (
              <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-3">
                {routingTab === 'board' && (
                  <RoutingGraphBoard
                    accounts={accounts}
                    mappings={modelMappings}
                    proxyStatus={proxyStatus}
                    proxySettings={proxySettings}
                    baseUrl={baseUrl}
                    autoSwitchEnabled={autoSwitchEnabled}
                    proxyBusy={proxyBusy}
                    holoneEnabled={holoneEnabled}
                    holoneMode={holoneMode}
                    holoneRuleCount={holoneRuleCount}
                    holoneFindingsCount={holoneFindingsCount}
                    cavemanEnabled={cavemanEnabled}
                    cavemanLevel={cavemanLevel}
                    compressionEnabled={compressionEnabled}
                    onOpenHolone={() => {}}
                    onOpenProviders={() => navigate('/ai/providers')}
                    onOpenMappings={() => {}}
                    onOpenRotation={() => {}}
                    onOpenProxy={() => {}}
                    onOpenCompression={() => {}}
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
            )}

            {/* === MONITOR TAB === */}
            {aiSection === 'monitor' && (
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
            )}
          </div>
        </div>
      </div>

      <AiTransferModal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        transferMode={transferMode}
        authScan={authScan}
        authScanLoading={authScanLoading}
        importPayload={importPayload}
        onImportPayloadChange={setImportPayload}
        importValidation={importValidation}
        importLoading={importLoading}
        onScanAuthFiles={scanAuthFiles}
        onPrepareImportFromScan={handlePrepareImportFromScan}
        onImportPayload={handleImportPayload}
        onImportAllFromScan={handleImportAllFromScan}
        exportFormat={exportFormat}
        onExportFormatChange={setExportFormat}
        exportIncludeSecrets={exportIncludeSecrets}
        onExportIncludeSecretsChange={setExportIncludeSecrets}
        exportPayload={exportPayload}
        exportLoading={exportLoading}
        onGenerateExport={handleGenerateExport}
        onDownloadText={downloadText}
        buildExportFileName={buildExportFileName}
        effectiveExportIncludeSecrets={effectiveExportIncludeSecrets}
        onCopy={handleCopy}
      />

      <AiMappingsModal
        isOpen={isMappingsModalOpen}
        onClose={() => setIsMappingsModalOpen(false)}
        modelMappings={modelMappings}
        onAddMapping={addMapping}
        onUpsertMapping={upsertMapping}
        onRemoveMapping={removeMapping}
        onSaveMappings={handleSaveMappings}
      />

      <AccountModal
        isOpen={isModalOpen}
        account={editingAccount}
        onClose={handleModalClose}
        onSubmit={handleModalSubmit}
      />

      <AiProxyAccountDrawer
        isOpen={Boolean(drawerAccount)}
        account={drawerAccount}
        onClose={handleDrawerClose}
        onEdit={handleEdit}
        onDelete={id => {
          void handleDelete(id);
        }}
        onTestConnection={account => {
          void handleTestConnection(account);
        }}
        connection={drawerAccount?.id ? connectionState[drawerAccount.id] : undefined}
      />

      <IdeConfigWizard isOpen={isIdeWizardOpen} onClose={() => setIsIdeWizardOpen(false)} />

      <ProxyDebugDrawer isOpen={showDebugDrawer} onClose={() => setShowDebugDrawer(false)} />

      <PastePackageDialog open={pasteOpen} onClose={() => setPasteOpen(false)} />

      <ProviderEndpointForm
        endpoint={null}
        open={addEndpointOpen}
        onClose={() => setAddEndpointOpen(false)}
      />
    </div>
  );
}
