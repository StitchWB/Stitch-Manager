import { useState, useCallback, useMemo } from 'react';
import { Zap } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate, useParams } from 'react-router-dom';
import Header from '../components/layout/Header';
import AccountModal from '../components/ai-proxy/AccountModal';
import { IdeConfigWizard } from '../components/ai-proxy/IdeConfigWizard';
import { AiTopTabs } from '../components/ai-proxy/AiTopTabs';
import { AiProvidersSidebar } from '../components/ai-proxy/sections/AiProvidersSidebar';
import { AiSectionHeaderBar } from '../components/ai-proxy/sections/AiSectionHeaderBar';
import { AiProxyControlsSection } from '../components/ai-proxy/sections/AiProxyControlsSection';
import { AiSummaryCards } from '../components/ai-proxy/sections/AiSummaryCards';
import { AiProxyAccountsTable } from '../components/ai-proxy/AiProxyAccountsTable';
import { AiProxyAccountDrawer } from '../components/ai-proxy/AiProxyAccountDrawer';
import { AiIntegrationsSection } from '../components/ai-proxy/sections/AiIntegrationsSection';
import { AiUsageSection } from '../components/ai-proxy/sections/AiUsageSection';
import { AiDiagnosticsSection } from '../components/ai-proxy/sections/AiDiagnosticsSection';
import { AiTransferModal } from '../components/ai-proxy/modals/AiTransferModal';
import { AiMappingsModal } from '../components/ai-proxy/modals/AiMappingsModal';
import { useAiProvidersController, maskKey } from './hooks/useAiProvidersController';
import type { ProxySettings } from '../types/generated';
import { AI_PROXY_PROVIDER_FILTERS } from '../components/ai-proxy/providerMeta';
import { t } from '../lib/i18n';

const CLIENT_API_KEY = 'proxystitch-local';

export default function AiProviders() {
  const navigate = useNavigate();
  const { section: sectionParam } = useParams<{ section?: string }>();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<any | null>(null);
  const [drawerAccount, setDrawerAccount] = useState<any | null>(null);
  const [isMappingsModalOpen, setIsMappingsModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferMode, setTransferMode] = useState<'import' | 'export'>('import');
  const [isIdeWizardOpen, setIsIdeWizardOpen] = useState(false);
  const controller = useAiProvidersController();

  const {
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

  const handleCopy = useCallback(async (label: string, value: string, requireConfirm = false) => {
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
  }, []);

  const handleEdit = useCallback((account: any) => {
    setEditingAccount(account);
    setIsModalOpen(true);
  }, []);

  const handleOpenDrawer = useCallback((account: any) => {
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

  const aiSection = useMemo(() => {
    if (sectionParam === 'integrations') return 'integrations';
    if (sectionParam === 'usage') return 'usage';
    if (sectionParam === 'diagnostics') return 'diagnostics';
    return 'providers';
  }, [sectionParam]);

  const sectionTitle =
    aiSection === 'integrations'
      ? t('aiHub.sections.integrations.title')
      : aiSection === 'usage'
        ? t('aiHub.sections.usage.title')
        : aiSection === 'diagnostics'
          ? t('aiHub.sections.diagnostics.title')
          : t('aiHub.sections.providers.title');

  const isProvidersSection = aiSection === 'providers';
  const isIntegrationsSection = aiSection === 'integrations';
  const isUsageSection = aiSection === 'usage';
  const isDiagnosticsSection = aiSection === 'diagnostics';

  const setProxyDraftWithUpdater = useCallback(
    (updater: (prev: ProxySettings | null) => ProxySettings | null) => {
      setProxyDraft(prev => updater(prev));
    },
    [setProxyDraft]
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#050508]">
      <Header title={sectionTitle} icon={<Zap size={18} />} />
      <AiTopTabs />

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar Filter Panel */}
        {isProvidersSection && (
          <AiProvidersSidebar
            providerFilter={providerFilter}
            providerCounts={providerCounts}
            onSelectProvider={setProviderFilter}
          />
        )}

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <AiSectionHeaderBar
            isProvidersSection={isProvidersSection}
            isIntegrationsSection={isIntegrationsSection}
            isUsageSection={isUsageSection}
            isDiagnosticsSection={isDiagnosticsSection}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            providerFilter={providerFilter}
            onProviderFilterChange={setProviderFilter}
            providerOptions={AI_PROXY_PROVIDER_FILTERS.map(p => ({
              id: p.id,
              label: p.label,
              count: providerCounts[p.id] ?? 0,
            }))}
            proxyStatus={proxyStatus}
            proxyBusy={proxyBusy}
            proxySaving={proxySaving}
            onStartStopProxy={() => {
              void handleStartStopProxy();
            }}
            onRefreshProxyInfo={() => {
              void refreshProxyInfo();
            }}
            onAddAccount={handleAddNew}
            onOpenApiKeys={() => navigate('/ai/api-keys')}
            onRunMigration={handleDebugMigration}
            onOpenProviders={() => navigate('/ai/providers')}
            onOpenIdeWizard={() => setIsIdeWizardOpen(true)}
            onOpenImport={() => {
              setTransferMode('import');
              setIsTransferModalOpen(true);
            }}
            onOpenExport={() => {
              setTransferMode('export');
              setIsTransferModalOpen(true);
            }}
            onOpenMappings={() => setIsMappingsModalOpen(true)}
            onOpenAnalytics={() => navigate('/ai-analytics')}
            onOpenDetailedAnalytics={() => navigate('/ai-analytics')}
            onOpenDebugChat={() => navigate('/chat')}
          />

          {/* Content */}
          <div className="flex-1 overflow-auto p-4 md:p-6">
            <AiProxyControlsSection
              visible={isProvidersSection}
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
              onCopy={(label, value, requireConfirm) => {
                void handleCopy(label, value, requireConfirm);
              }}
              onOpenIdeWizard={() => setIsIdeWizardOpen(true)}
              onResetDraft={handleResetProxyDraft}
              onSaveSettings={() => {
                void handleSaveProxySettings();
              }}
              onStartStopProxy={() => {
                void handleStartStopProxy();
              }}
              onRefreshProxyInfo={() => {
                void refreshProxyInfo();
              }}
              showIdeWizardAction={isProvidersSection}
              showProxyActions={isProvidersSection}
              showConfigActions
              showRuntimeActions={false}
            />

            <AiSummaryCards
              visible={isProvidersSection || isUsageSection}
              availableModels={availableModels}
              providerCapabilities={providerCapabilities}
              historySummary={historySummary}
              proxyStatus={proxyStatus}
              hasAccounts={filteredAccounts.length > 0}
              accountReadiness={accountReadiness}
              onOpenMappings={() => setIsMappingsModalOpen(true)}
              onOpenAnalytics={() => navigate('/ai-analytics')}
            />

            {isProvidersSection && (
              <div className="mt-4">
                <AiProxyAccountsTable
                  accounts={filteredAccounts}
                  loading={loading}
                  connectionState={connectionState}
                  onRowClick={handleOpenDrawer}
                  onEdit={handleEdit}
                  onDelete={id => {
                    void handleDelete(id);
                  }}
                  onTestConnection={account => {
                    void handleTestConnection(account);
                  }}
                />
              </div>
            )}

            <AiIntegrationsSection
              visible={isIntegrationsSection}
              providerCapabilities={providerCapabilities}
              onOpenWizard={() => setIsIdeWizardOpen(true)}
              onOpenImport={() => {
                setTransferMode('import');
                setIsTransferModalOpen(true);
              }}
              onOpenExport={() => {
                setTransferMode('export');
                setIsTransferModalOpen(true);
              }}
              onOpenMappings={() => setIsMappingsModalOpen(true)}
            />

            <AiUsageSection
              visible={isUsageSection}
              historySummary={historySummary}
              onOpenAnalytics={() => navigate('/ai-analytics')}
            />

            <AiDiagnosticsSection
              visible={isDiagnosticsSection}
              proxyStatus={proxyStatus}
              proxySettings={proxySettings}
              onOpenDebugChat={() => navigate('/chat')}
              onOpenAnalytics={() => navigate('/ai-analytics')}
            />
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
        onCopy={(label, value, requireConfirm) => {
          void handleCopy(label, value, requireConfirm);
        }}
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
    </div>
  );
}
