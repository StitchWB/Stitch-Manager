import { useState, useCallback, useEffect, useMemo } from 'react';
import { Bug, MessageSquare, Plus, RefreshCw, Search, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate, useParams } from 'react-router-dom';
import { useSelection } from '../hooks/useSelection';

import Header from '../components/layout/Header';
import AccountModal from '../components/ai-proxy/AccountModal';
import { IdeConfigWizard } from '../components/ai-proxy/IdeConfigWizard';
import { AiTopTabs } from '../components/ai-proxy/AiTopTabs';
import { AiProvidersSidebar } from '../components/ai-proxy/sections/AiProvidersSidebar';
import { AiProxyControlsSection } from '../components/ai-proxy/sections/AiProxyControlsSection';
import { RotationSettingsPanel } from '../components/ai-proxy/sections/RotationSettingsPanel';
import { RoutingFlowBoard } from '../components/ai-proxy/sections/RoutingFlowBoard';
import { MappingsEditor } from '../components/ai-proxy/sections/MappingsEditor';
import { AiProxyAccountsTable } from '../components/ai-proxy/AiProxyAccountsTable';
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
  FloatingActionBar,
} from '@/components/ui';
import { getBackgroundManagerConfig } from '../lib/backend/modules/backgroundManager';
import { t } from '../lib/i18n';
import { useAppStore } from '../stores/app';

const CLIENT_API_KEY = 'proxystitch-local';

type AiSection = 'providers' | 'routing' | 'monitor';

function resolveSection(param: string | undefined): AiSection {
  if (param === 'routing' || param === 'integrations') return 'routing';
  if (param === 'monitor' || param === 'usage' || param === 'diagnostics') return 'monitor';
  return 'providers';
}

export default function AiProviders() {
  const navigate = useNavigate();
  const language = useAppStore(state => state.language);
  const { section: sectionParam } = useParams<{ section?: string }>();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AiProxyAccount | null>(null);
  const [drawerAccount, setDrawerAccount] = useState<AiProxyAccount | null>(null);
  const [isMappingsModalOpen, setIsMappingsModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferMode] = useState<'import' | 'export'>('import');
  const [isIdeWizardOpen, setIsIdeWizardOpen] = useState(false);
  const [showDebugDrawer, setShowDebugDrawer] = useState(false);
  const [autoSwitchEnabled, setAutoSwitchEnabled] = useState<boolean | null>(null);
  const controller = useAiProvidersController();
  const selection = useSelection();

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
        const ok = window.confirm(t('aiHub.warnings.copySensitiveConfirm', { label }));
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

  const aiSection = useMemo<AiSection>(() => resolveSection(sectionParam), [sectionParam]);

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

  const setProxyDraftWithUpdater = useCallback(
    (updater: (prev: ProxySettings | null) => ProxySettings | null) => {
      setProxyDraft(prev => updater(prev));
    },
    [setProxyDraft]
  );

  const scrollToRoutingSection = useCallback((sectionId: string) => {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

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
              onClick={() => navigate('/ai/analytics')}
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
                  onSelect: () => navigate('/chat'),
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
        <Button
          variant="primary"
          size="sm"
          onClick={handleAddNew}
          leftIcon={<Plus size={14} />}
        >
          {t('aiHub.actions.addAccount')}
        </Button>
      ),
    };
  })();

  return (
    <div className="flex flex-col h-full overflow-hidden bg-void-base">
      <Header title={t('sidebar.aiHub')} icon={<Zap size={18} />} />
      <AiTopTabs />

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
                    containerClassName="flex-1 max-w-md min-w-0"
                  />
                </div>

                <AiProxyAccountsTable
                  accounts={filteredAccounts}
                  loading={loading}
                  connectionState={connectionState}
                  selectedIds={selection.selectedIds}
                  onSelect={selection.select}
                  onDeselect={selection.deselect}
                  onSelectAll={() => selection.selectAll(filteredAccounts.map(a => a.id).filter((id): id is number => id !== null))}
                  onDeselectAll={selection.deselectAll}
                  onRowClick={handleOpenDrawer}
                  onEdit={handleEdit}
                  onDelete={id => {
                    void handleDelete(id);
                  }}
                  onTestConnection={account => {
                    void handleTestConnection(account);
                  }}
                />

                <AiProvidersKeysSection providerFilter={providerFilter} />

                {selection.selectedCount > 0 && (
                  <FloatingActionBar
                    selectedCount={selection.selectedCount}
                    onDelete={async () => {
                      if (!window.confirm(t('aiHub.controller.confirm.bulkDelete', { count: selection.selectedCount }))) return;
                      try {
                        const ids = Array.from(selection.selectedIds);
                        await Promise.all(ids.map(id => controller.handleDelete(id)));
                        toast.success(t('aiHub.controller.toasts.bulkDeleted', { count: ids.length }));
                        selection.clear();
                      } catch {
                        toast.error(t('aiHub.controller.errors.bulkDeleteFailed'));
                      }
                    }}
                    onExport={() => {
                      toast.info(t('aiHub.controller.toasts.exportNotImplemented'));
                    }}
                    onRefreshAll={() => {
                      void controller.fetchAccounts();
                    }}
                    onClear={selection.clear}
                  />
                )}
              </>
            )}

            {/* === ROUTING TAB === */}
            {aiSection === 'routing' && (
              <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-3">
                <RoutingFlowBoard
                  accounts={accounts}
                  mappings={modelMappings}
                  proxyStatus={proxyStatus}
                  proxySettings={proxySettings}
                  baseUrl={baseUrl}
                  autoSwitchEnabled={autoSwitchEnabled}
                  proxyBusy={proxyBusy}
                  onOpenProviders={() => navigate('/ai/providers')}
                  onOpenMappings={() => scrollToRoutingSection('routing-mappings')}
                  onOpenRotation={() => scrollToRoutingSection('routing-rotation')}
                  onOpenProxy={() => scrollToRoutingSection('routing-proxy')}
                  onStartStopProxy={handleStartStopProxy}
                />

                <div id="routing-mappings" className="scroll-mt-4">
                  <MappingsEditor
                    modelMappings={modelMappings}
                    onAddMapping={addMapping}
                    onUpsertMapping={upsertMapping}
                    onRemoveMapping={removeMapping}
                    onSaveMappings={handleSaveMappings}
                  />
                </div>

                <div className="grid items-start gap-3 xl:grid-cols-2">
                  <div id="routing-proxy" className="min-w-0 scroll-mt-4">
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
                  </div>

                  <div id="routing-rotation" className="min-w-0 scroll-mt-4">
                    <RotationSettingsPanel capabilities={providerCapabilities} visible />
                  </div>
                </div>
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
                onOpenAnalytics={() => navigate('/ai-analytics')}
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
    </div>
  );
}
