import { useState, useCallback, useMemo } from 'react';
import { Zap, Copy, RefreshCw } from 'lucide-react';
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
import { Button, Modal, Input } from '../components/ui';
import { useAiProvidersController, maskKey } from './hooks/useAiProvidersController';
import type { ProxySettings } from '../types/generated';
import { AI_PROXY_PROVIDER_FILTERS } from '../components/ai-proxy/providerMeta';

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
      toast.error('Nothing to copy');
      return;
    }

    if (requireConfirm) {
      const ok = window.confirm(
        `Copy ${label} to clipboard? This is sensitive and may be visible to other apps.`
      );
      if (!ok) return;
    }

    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch (e) {
      console.error('[AiProviders] Copy failed:', e);
      toast.error(`Failed to copy ${label}`);
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
      ? 'AI Integrations'
      : aiSection === 'usage'
        ? 'AI Usage & Quotas'
        : aiSection === 'diagnostics'
          ? 'AI Diagnostics'
          : 'AI Providers';

  const isProvidersSection = aiSection === 'providers';
  const isIntegrationsSection = aiSection === 'integrations';
  const isUsageSection = aiSection === 'usage';
  const isDiagnosticsSection = aiSection === 'diagnostics';

  const setProxyDraftWithUpdater = useCallback(
    (updater: (prev: ProxySettings | null) => ProxySettings | null) => {
      setProxyDraft(prev => updater(prev));
    },
    []
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
            onAddAccount={handleAddNew}
            onOpenApiKeys={() => navigate('/api-keys')}
            onOpenIntegrationWizard={() => setIsIdeWizardOpen(true)}
            onOpenImport={() => {
              setTransferMode('import');
              setIsTransferModalOpen(true);
            }}
            onOpenExport={() => {
              setTransferMode('export');
              setIsTransferModalOpen(true);
            }}
            onOpenDebugChat={() => navigate('/chat')}
            onRunMigration={handleDebugMigration}
            onOpenProviders={() => navigate('/ai/providers')}
          />

          {/* Content */}
          <div className="flex-1 overflow-auto p-4 md:p-6">
            <AiProxyControlsSection
              visible={isProvidersSection || isIntegrationsSection || isDiagnosticsSection}
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
            />

            <AiSummaryCards
              visible={isProvidersSection || isUsageSection}
              availableModels={availableModels}
              providerCapabilities={providerCapabilities}
              historySummary={historySummary}
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

      <Modal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        title={transferMode === 'import' ? 'Import AI Proxy Accounts' : 'Export AI Proxy Accounts'}
        size="lg"
        footer={
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-400">
              Exports are redacted by default. Enabling “include secrets” exports tokens in
              plaintext.
            </div>
            <Button variant="secondary" onClick={() => setIsTransferModalOpen(false)}>
              Close
            </Button>
          </div>
        }
      >
        {transferMode === 'import' ? (
          <div className="space-y-4">
            <div className="bg-black/30 border border-white/10 rounded-lg p-3">
              <div className="text-sm text-white font-medium">Import</div>
              <div className="text-xs text-slate-400 mt-1">
                You can import from scanned auth files (legacy locations) or paste an export JSON
                payload.
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={scanAuthFiles}
                  disabled={authScanLoading}
                  leftIcon={<RefreshCw size={16} />}
                >
                  {authScanLoading ? 'Scanning...' : 'Scan auth files'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handlePrepareImportFromScan}
                  disabled={!authScan || authScan.length === 0}
                >
                  Prepare JSON from scan
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleImportPayload}
                  disabled={importLoading || !importValidation.isValid}
                >
                  {importLoading ? 'Importing…' : 'Import JSON'}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleImportAllFromScan}
                  disabled={importLoading || authScanLoading || !authScan || authScan.length === 0}
                >
                  {importLoading ? 'Importing…' : 'Import all from scan'}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs text-slate-400">Import payload (JSON)</div>
              <textarea
                value={importPayload}
                onChange={e => setImportPayload(e.target.value)}
                className="w-full min-h-[140px] rounded-lg bg-black/30 border border-white/10 p-3 text-xs font-mono text-slate-200 outline-none focus:border-indigo-500/50"
                placeholder="Paste export JSON here…"
              />
              {importValidation.error && (
                <div className="text-xs text-red-400">{importValidation.error}</div>
              )}
            </div>

            {importValidation.includeSecrets && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200">
                <div className="font-medium text-amber-200">Warning</div>
                <div className="mt-1 text-amber-200/80">
                  This payload includes secrets (tokens/keys). Importing will store them locally.
                </div>
              </div>
            )}

            {authScan && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-white">
                    Scan results <span className="text-slate-400">({authScan.length})</span>
                  </div>
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => handleCopy('Scan report', JSON.stringify(authScan, null, 2))}
                    leftIcon={<Copy size={14} />}
                  >
                    Copy JSON
                  </Button>
                </div>
                {authScan.length === 0 ? (
                  <div className="text-xs text-slate-400">No auth files found.</div>
                ) : (
                  <div className="max-h-64 overflow-auto pr-1 space-y-1">
                    {authScan.map((f, idx) => (
                      <div
                        key={`${f.provider}-${f.path}-${idx}`}
                        className="text-xs text-slate-300 bg-white/5 border border-white/10 rounded-lg px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="capitalize text-white">{f.provider}</span>
                          <span className="text-slate-500 tabular-nums">
                            {f.expiresAt
                              ? `exp ${new Date(f.expiresAt * 1000).toLocaleDateString()}`
                              : 'no expiry'}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-400 break-all mt-1">
                          {f.path}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-black/30 border border-white/10 rounded-lg p-3 space-y-3">
              <div>
                <div className="text-sm text-white font-medium">Export</div>
                <div className="text-xs text-slate-400 mt-1">
                  By default exports are redacted. Enabling “include secrets” will export tokens in
                  plaintext.
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={exportFormat}
                  onChange={e => setExportFormat(e.target.value as any)}
                  className="h-9 rounded-lg bg-white/[0.03] border border-white/10 px-2 text-sm text-slate-200"
                >
                  <option value="json">JSON</option>
                  <option value="csv">CSV</option>
                </select>
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={exportIncludeSecrets}
                    disabled={exportFormat === 'csv'}
                    onChange={e => {
                      const next = e.target.checked;
                      if (next) {
                        const ok = window.confirm(
                          'Including secrets will export tokens/keys in plaintext. Continue?'
                        );
                        if (!ok) return;
                      }
                      setExportIncludeSecrets(next);
                    }}
                  />
                  Include secrets
                </label>
                {exportFormat === 'csv' && (
                  <span className="text-xs text-slate-500">CSV export never includes secrets.</span>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleGenerateExport}
                  disabled={exportLoading}
                >
                  {exportLoading ? 'Generating…' : 'Generate'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!exportPayload}
                  onClick={() =>
                    downloadText(
                      buildExportFileName(exportFormat, effectiveExportIncludeSecrets),
                      exportPayload,
                      exportFormat === 'csv' ? 'text/csv' : 'application/json'
                    )
                  }
                >
                  Download
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!exportPayload}
                  onClick={() =>
                    handleCopy('Export payload', exportPayload, effectiveExportIncludeSecrets)
                  }
                  leftIcon={<Copy size={16} />}
                >
                  Copy
                </Button>
              </div>

              <div className="rounded-lg border border-white/10 bg-black/20 p-3 max-h-64 overflow-auto">
                {exportPayload ? (
                  <pre className="text-[11px] text-slate-300 whitespace-pre-wrap break-words">
                    {exportPayload}
                  </pre>
                ) : (
                  <div className="text-xs text-slate-500">Generate an export to view payload.</div>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={isMappingsModalOpen}
        onClose={() => setIsMappingsModalOpen(false)}
        title="Provider Model Mappings"
        size="lg"
        footer={
          <div className="flex items-center justify-between">
            <Button variant="secondary" onClick={addMapping}>
              Add mapping
            </Button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setIsMappingsModalOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={async () => {
                  const ok = await handleSaveMappings();
                  if (ok) setIsMappingsModalOpen(false);
                }}
              >
                Save
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-3">
          {modelMappings.length === 0 ? (
            <p className="text-sm text-slate-400">No mappings configured</p>
          ) : (
            modelMappings.map((mapping, index) => (
              <div
                key={`${mapping.modelPattern}-${index}`}
                className="grid grid-cols-12 gap-2 items-center"
              >
                <div className="col-span-5">
                  <Input
                    value={mapping.modelPattern}
                    onChange={e => upsertMapping(index, { modelPattern: e.target.value })}
                    placeholder="^gpt-"
                  />
                </div>
                <div className="col-span-3">
                  <select
                    className="w-full h-9 rounded-lg bg-white/[0.03] border border-white/10 px-2 text-sm text-slate-200"
                    value={mapping.provider}
                    onChange={e => upsertMapping(index, { provider: e.target.value })}
                  >
                    {AI_PROXY_PROVIDER_FILTERS.filter(p => p.id !== 'all').map(p => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-3">
                  <Input
                    value={mapping.modelId || ''}
                    onChange={e => upsertMapping(index, { modelId: e.target.value || null })}
                    placeholder="target model id"
                  />
                </div>
                <div className="col-span-1 flex justify-end">
                  <Button variant="danger" size="xs" onClick={() => removeMapping(index)}>
                    Del
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </Modal>

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
