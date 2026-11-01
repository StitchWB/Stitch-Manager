import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ClipboardPaste, Pencil, Plus, Server, Trash2, UserPlus, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

import Header from '../components/layout/Header';
import { Button, PageHeader, ButtonBase, EmptyState, StatusBadge, askConfirm } from '@/components/ui';
import AccountModal from '@/components/ai-proxy/AccountModal';
import { useAiGatewayStore } from '@/stores/aiGateway';
import {
  discoverModelsForEndpoint,
  importOpencodeProviders,
  listPublicModels,
  listRouteTargetsForPublicModel,
  testCredentialConnection,
} from '@/lib/backend/modules/aiGateway';
import type { UpstreamModel } from '@/lib/backend/modules/aiGateway';
import { PublicModelForm } from '@/components/ai-gateway/PublicModelForm';
import { getCustomProviders } from '@/lib/backend/modules/customProviders';
import { useAiProvidersController } from './hooks/useAiProvidersController';
import { useAiHubCopy } from './hooks/useAiHubCopy';
import { ProxyStatusBar } from '@/components/ai-proxy/sections/ProxyStatusBar';
import { ProviderEndpointForm } from '@/components/ai-gateway/ProviderEndpointForm';
import { ProviderRoster } from '@/components/ai-hub/providers/ProviderRoster';
import { AddProviderMenu } from '@/components/ai-hub/providers/AddProviderMenu';
import { LegacyMigrationBanner } from '@/components/ai-hub/providers/LegacyMigrationBanner';
import { ProviderKeysTable } from '@/components/ai-hub/providers/ProviderKeysTable';
import { ProviderModelsPanel } from '@/components/ai-hub/providers/ProviderModelsPanel';
import { ProviderSettingsPanel } from '@/components/ai-hub/providers/ProviderSettingsPanel';
import { PasteKeysDialog } from '@/components/ai-hub/providers/PasteKeysDialog';
import { ProvidersOverview } from '@/components/ai-hub/providers/ProvidersOverview';
import {
  buildRosterItem,
  credentialsForEndpoint,
  isProblemStatus,
  modelsForEndpoint,
} from '@/components/ai-hub/providers/viewModel';
import { t } from '../lib/i18n';

const CLIENT_API_KEY = 'proxystitch-local';

type DetailTab = 'keys' | 'models' | 'settings';

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

export default function AiProvidersPage() {
  const navigate = useNavigate();
  const controller = useAiProvidersController('providers');
  const {
    proxyStatus,
    proxySettings,
    proxyBusy,
    proxySaving,
    baseUrl,
    refreshProxyInfo,
    handleStartStopProxy,
  } = controller;
  const handleCopy = useAiHubCopy();

  const endpoints = useAiGatewayStore(state => state.endpoints);
  const credentials = useAiGatewayStore(state => state.credentials);
  const upstreamModels = useAiGatewayStore(state => state.upstreamModels);
  const loading = useAiGatewayStore(state => state.loading);
  const fetchEndpoints = useAiGatewayStore(state => state.fetchEndpoints);
  const fetchCredentials = useAiGatewayStore(state => state.fetchCredentials);
  const fetchUpstreamModels = useAiGatewayStore(state => state.fetchUpstreamModels);
  const updateEndpoint = useAiGatewayStore(state => state.updateEndpoint);
  const deleteEndpoint = useAiGatewayStore(state => state.deleteEndpoint);
  const updateCredential = useAiGatewayStore(state => state.updateCredential);
  const deleteCredential = useAiGatewayStore(state => state.deleteCredential);
  const migrateLegacyData = useAiGatewayStore(state => state.migrateLegacyData);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<DetailTab>('keys');
  const [keyBusy, setKeyBusy] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [legacyCount, setLegacyCount] = useState(0);
  const [addEndpointOpen, setAddEndpointOpen] = useState(false);
  const [editEndpointOpen, setEditEndpointOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [exposeModel, setExposeModel] = useState<UpstreamModel | null>(null);
  const [published, setPublished] = useState<Record<string, string>>({});
  const autoDiscovered = useRef<Set<string>>(new Set());

  const loadPublished = useCallback(async () => {
    try {
      const publicModels = await listPublicModels();
      const targets = await Promise.all(
        publicModels.map(publicModel => listRouteTargetsForPublicModel(publicModel.id)),
      );
      const map: Record<string, string> = {};
      publicModels.forEach((publicModel, index) => {
        for (const target of targets[index]) map[target.upstreamModelId] = publicModel.id;
      });
      setPublished(map);
    } catch {
      setPublished({});
    }
  }, []);

  useEffect(() => {
    void fetchEndpoints();
    void fetchCredentials();
    void fetchUpstreamModels();
    void loadPublished();
    getCustomProviders()
      .then(list => setLegacyCount(list.length))
      .catch(() => setLegacyCount(0));
  }, [fetchEndpoints, fetchCredentials, fetchUpstreamModels, loadPublished]);

  const rosterItems = useMemo(
    () => endpoints.map(endpoint => buildRosterItem(endpoint, credentials, upstreamModels)),
    [endpoints, credentials, upstreamModels]
  );

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rosterItems;
    return rosterItems.filter(
      item =>
        item.endpoint.name.toLowerCase().includes(query) ||
        item.endpoint.baseUrl.toLowerCase().includes(query)
    );
  }, [rosterItems, search]);

  const selectedEndpoint = useMemo(
    () => endpoints.find(endpoint => endpoint.id === selectedId) ?? null,
    [endpoints, selectedId]
  );
  const selectedCredentials = useMemo(
    () => (selectedEndpoint ? credentialsForEndpoint(credentials, selectedEndpoint.id) : []),
    [credentials, selectedEndpoint]
  );
  const selectedModels = useMemo(
    () => (selectedEndpoint ? modelsForEndpoint(upstreamModels, selectedEndpoint.id) : []),
    [upstreamModels, selectedEndpoint]
  );
  const selectedActiveCount = useMemo(
    () =>
      selectedCredentials.filter(
        credential => credential.enabled && credential.runtimeStatus === 'active'
      ).length,
    [selectedCredentials]
  );
  const selectedFailingCount = useMemo(
    () =>
      selectedCredentials.filter(
        credential => credential.enabled && isProblemStatus(credential.runtimeStatus)
      ).length,
    [selectedCredentials]
  );

  const handleTestSelected = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      setKeyBusy(true);
      try {
        await runPool(ids, 8, async id => {
          await testCredentialConnection(id);
        });
        toast.success(t('aiHub.controller.toasts.connectionOk'));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      } finally {
        setKeyBusy(false);
        await fetchCredentials();
      }
    },
    [fetchCredentials]
  );

  const handleToggleCredential = useCallback(
    async (id: string, enabled: boolean) => {
      try {
        await updateCredential({ id, enabled });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [updateCredential]
  );

  const handleDeleteSelected = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      const ok = await askConfirm({
        title: t('common.delete'),
        message: t('aiHub.providersPage.deleteSelected'),
        confirmText: t('common.delete'),
        cancelText: t('common.cancel'),
        variant: 'danger',
      });
      if (!ok) return;
      setKeyBusy(true);
      try {
        await runPool(ids, 8, async id => {
          await deleteCredential(id);
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      } finally {
        setKeyBusy(false);
      }
    },
    [deleteCredential]
  );

  const handleSaveSettings = useCallback(
    async (patch: { name: string; baseUrl: string; enabled: boolean }) => {
      if (!selectedEndpoint) return;
      try {
        await updateEndpoint({ id: selectedEndpoint.id, ...patch });
        toast.success(t('aiHub.providersPage.savedLabel'));
      } catch {
        toast.error(t('aiHub.providersPage.saveFailedLabel'));
      }
    },
    [selectedEndpoint, updateEndpoint]
  );

  const handleDeleteEndpoint = useCallback(async () => {
    if (!selectedEndpoint) return;
    const ok = await askConfirm({
      title: t('aiHub.providersPage.deleteEndpoint'),
      message: t('aiHub.providersPage.deleteEndpointConfirm'),
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteEndpoint(selectedEndpoint.id);
      setSelectedId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [selectedEndpoint, deleteEndpoint]);

  const handleDiscover = useCallback(async () => {
    if (!selectedEndpoint) return;
    setDiscovering(true);
    try {
      await discoverModelsForEndpoint(selectedEndpoint.id);
      await fetchUpstreamModels(selectedEndpoint.id);
      toast.success(t('aiHub.providersPage.discover'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setDiscovering(false);
    }
  }, [selectedEndpoint, fetchUpstreamModels]);

  const handleMigrate = useCallback(async () => {
    setMigrating(true);
    try {
      const report = await migrateLegacyData();
      await Promise.all([fetchEndpoints(), fetchCredentials(), fetchUpstreamModels()]);
      toast.success(`${t('aiHub.providersPage.legacyDone')} · +${report.endpoints_created}/${report.credentials_created}`);
    } catch {
      toast.error(t('aiHub.providersPage.legacyFailed'));
    } finally {
      setMigrating(false);
    }
  }, [migrateLegacyData, fetchEndpoints, fetchCredentials, fetchUpstreamModels]);

  const handleImportOpencode = useCallback(async () => {
    try {
      const report = await importOpencodeProviders();
      await Promise.all([fetchEndpoints(), fetchCredentials(), fetchUpstreamModels()]);
      toast.success(`${t('aiHub.providersPage.importOpencode')} · ${report.imported.length}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }, [fetchEndpoints, fetchCredentials, fetchUpstreamModels]);

  const handleKeysAdded = useCallback(
    (endpointIds: string[]) => {
      if (endpointIds.length === 0) return;
      for (const endpointId of endpointIds) autoDiscovered.current.add(endpointId);
      setSelectedId(endpointIds[0]);
      void (async () => {
        try {
          let modelsFound = 0;
          for (const endpointId of endpointIds) {
            const report = await discoverModelsForEndpoint(endpointId);
            modelsFound += report.models_count;
          }
          await fetchUpstreamModels();
          toast.success(t('aiHub.pasteFirst.modelsFound', { count: modelsFound }));
        } catch {
          toast.info(t('aiHub.pasteFirst.modelsLater'));
        }
        let verifyFailed = false;
        try {
          await fetchCredentials();
          const untested = useAiGatewayStore
            .getState()
            .credentials.filter(
              credential =>
                endpointIds.includes(credential.providerEndpointId) &&
                credential.runtimeStatus === 'unknown',
            );
          if (untested.length > 0) {
            await runPool(untested.map(credential => credential.id), 8, async id => {
              await testCredentialConnection(id);
            });
          }
        } catch {
          verifyFailed = true;
        } finally {
          await fetchCredentials();
        }
        if (verifyFailed) toast.info(t('aiHub.pasteFirst.verifyLater'));
      })();
    },
    [fetchCredentials, fetchUpstreamModels]
  );

  useEffect(() => {
    if (!selectedEndpoint || !selectedEndpoint.enabled) return;
    if (selectedModels.length > 0 || discovering) return;
    if (autoDiscovered.current.has(selectedEndpoint.id)) return;
    autoDiscovered.current.add(selectedEndpoint.id);
    setDiscovering(true);
    discoverModelsForEndpoint(selectedEndpoint.id)
      .then(() => fetchUpstreamModels(selectedEndpoint.id))
      .catch(() => undefined)
      .finally(() => setDiscovering(false));
  }, [selectedEndpoint, selectedModels.length, discovering, fetchUpstreamModels]);

  const openAddManual = useCallback(() => setAddEndpointOpen(true), []);

  const handleSelectProvider = useCallback((id: string) => {
    setSelectedId(prev => (prev === id ? null : id));
  }, []);

  const tabs: Array<{ id: DetailTab; label: string }> = [
    { id: 'keys', label: t('aiHub.providersPage.tabKeys') },
    { id: 'models', label: t('aiHub.providersPage.tabModels') },
    { id: 'settings', label: t('aiHub.providersPage.tabSettings') },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-void-base">
      <Header title={t('sidebar.aiHub')} icon={<Zap size={18} />} />

      <PageHeader
        eyebrow={t('sidebar.aiHub')}
        title={t('aiHub.sections.providers.title')}
        description={t('aiHub.sections.providers.subtitle')}
        actions={
          <>
            <AddProviderMenu
              busy={loading.endpoints}
              onPasteKeys={() => setPasteOpen(true)}
              onAddManually={openAddManual}
              onImportOpencode={() => void handleImportOpencode()}
              onImportPackage={() => navigate('/ai/integrations')}
            />
            <Button
              variant="outline"
              size="sm"
              leftIcon={<UserPlus size={14} />}
              onClick={() => setAccountModalOpen(true)}
            >
              {t('aiHub.actions.addAccount')}
            </Button>
          </>
        }
      />

      <div className="shrink-0 px-4 pt-3 md:px-6">
        <ProxyStatusBar
          compact
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
      </div>

      <div className="shrink-0 px-4 pt-2 md:px-6">
        <LegacyMigrationBanner
          visible={!loading.endpoints && endpoints.length === 0 && legacyCount > 0}
          busy={migrating}
          onMigrate={() => void handleMigrate()}
        />
      </div>

      <div className="flex min-h-0 flex-1 gap-4 p-4 md:p-6">
        {endpoints.length === 0 && !loading.endpoints ? (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.02]">
            <EmptyState
              icon={Server}
              title={t('aiHub.providersPage.rosterEmpty')}
              description={t('aiHub.providersPage.rosterEmptyHint')}
              action={
                <div className="flex items-center gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    leftIcon={<ClipboardPaste size={14} />}
                    onClick={() => setPasteOpen(true)}
                  >
                    {t('aiHub.pasteFirst.title')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    leftIcon={<Plus size={14} />}
                    onClick={openAddManual}
                  >
                    {t('aiHub.providersPage.addProvider')}
                  </Button>
                </div>
              }
            />
          </div>
        ) : (
          <>
            <div className="w-full shrink-0 md:w-[260px]">
              <ProviderRoster
                items={filteredItems}
                allItems={rosterItems}
                selectedId={selectedId}
                search={search}
                loading={loading.endpoints}
                onSearchChange={setSearch}
                onSelect={handleSelectProvider}
                onAddProvider={openAddManual}
              />
            </div>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-white/[0.06] bg-white/[0.02]">
              {selectedEndpoint ? (
                <>
                  <div className="flex flex-wrap items-center gap-3 border-b border-white/[0.06] px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <ButtonBase
                          type="button"
                          onClick={() => setSelectedId(null)}
                          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/[0.04] hover:text-slate-200"
                          aria-label={t('aiHub.providersPage.overview.title')}
                        >
                          <ArrowLeft size={14} />
                        </ButtonBase>
                        <h2 className="truncate text-sm font-semibold text-white">{selectedEndpoint.name}</h2>
                        <StatusBadge
                          status={selectedEndpoint.enabled ? 'active' : 'inactive'}
                          withDot
                          size="sm"
                        />
                        <span className="flex items-center gap-1 text-[11px] tabular-nums text-slate-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                          {selectedActiveCount} {t('aiHub.providersPage.detail.activeChip')}
                        </span>
                        {selectedFailingCount > 0 && (
                          <span className="flex items-center gap-1 text-[11px] tabular-nums text-amber-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                            {selectedFailingCount} {t('aiHub.providersPage.detail.failingChip')}
                          </span>
                        )}
                        <span className="flex items-center gap-1 text-[11px] tabular-nums text-slate-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
                          {selectedModels.length} {t('aiHub.providersPage.detail.modelsChip')}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
                        {selectedEndpoint.baseUrl} · {selectedEndpoint.adapterType}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <ButtonBase
                        type="button"
                        onClick={() => setEditEndpointOpen(true)}
                        className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/[0.04] hover:text-slate-200"
                        aria-label={t('aiHub.providersPage.edit')}
                      >
                        <Pencil size={14} />
                      </ButtonBase>
                      <ButtonBase
                        type="button"
                        onClick={() => void handleDeleteEndpoint()}
                        className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
                        aria-label={t('aiHub.providersPage.deleteEndpoint')}
                      >
                        <Trash2 size={14} />
                      </ButtonBase>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 border-b border-white/[0.06] px-3 py-2">
                    {tabs.map(item => {
                      const active = tab === item.id;
                      return (
                        <ButtonBase
                          key={item.id}
                          type="button"
                          onClick={() => setTab(item.id)}
                          aria-current={active ? 'true' : undefined}
                          className={
                            active
                              ? 'rounded-md bg-indigo-500/12 px-3 py-1.5 text-xs font-medium text-white ring-1 ring-inset ring-indigo-400/20'
                              : 'rounded-md px-3 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:bg-white/[0.04] hover:text-slate-200'
                          }
                        >
                          {item.label}
                        </ButtonBase>
                      );
                    })}
                  </div>

                  <div className="min-h-0 flex-1 overflow-hidden p-3">
                    {tab === 'keys' && (
                      <ProviderKeysTable
                        credentials={selectedCredentials}
                        loading={loading.credentials}
                        busy={keyBusy}
                        onAddKeys={() => setPasteOpen(true)}
                        onTestSelected={ids => void handleTestSelected(ids)}
                        onToggleEnabled={(id, enabled) => void handleToggleCredential(id, enabled)}
                        onDeleteSelected={ids => void handleDeleteSelected(ids)}
                      />
                    )}
                    {tab === 'models' && (
                      <ProviderModelsPanel
                        models={selectedModels}
                        loading={loading.upstreamModels}
                        busy={false}
                        discovering={discovering}
                        onDiscover={() => void handleDiscover()}
                        onExposeModel={setExposeModel}
                        published={published}
                      />
                    )}
                    {tab === 'settings' && (
                      <ProviderSettingsPanel
                        endpoint={selectedEndpoint}
                        busy={loading.endpoints}
                        onSave={patch => void handleSaveSettings(patch)}
                        onDelete={() => void handleDeleteEndpoint()}
                      />
                    )}
                  </div>
                </>
              ) : (
                <ProvidersOverview
                  items={rosterItems}
                  onSelectProvider={setSelectedId}
                  onPasteKeys={() => setPasteOpen(true)}
                  onAddProvider={openAddManual}
                  onImportOpencode={() => void handleImportOpencode()}
                  onOpenRouting={() => navigate('/ai/routing?tab=models')}
                />
              )}
            </div>
          </>
        )}
      </div>

      <AccountModal
        isOpen={accountModalOpen}
        account={null}
        onClose={() => setAccountModalOpen(false)}
        onSubmit={() => {
          setAccountModalOpen(false);
          void fetchCredentials();
        }}
      />

      <ProviderEndpointForm
        endpoint={null}
        open={addEndpointOpen}
        onClose={() => setAddEndpointOpen(false)}
      />

      {editEndpointOpen && selectedEndpoint && (
        <ProviderEndpointForm
          endpoint={selectedEndpoint}
          open={editEndpointOpen}
          onClose={() => setEditEndpointOpen(false)}
        />
      )}

      <PasteKeysDialog
        open={pasteOpen}
        endpoint={selectedEndpoint}
        onClose={() => setPasteOpen(false)}
        onAdded={handleKeysAdded}
      />

      {exposeModel && (
        <PublicModelForm
          key={exposeModel.id}
          open
          prefill={{ id: exposeModel.upstreamModelId, upstreamModelId: exposeModel.id }}
          onClose={() => setExposeModel(null)}
          onCreated={() => void loadPublished()}
        />
      )}
    </div>
  );
}