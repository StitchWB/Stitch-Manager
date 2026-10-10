import { useState, useCallback, useEffect } from 'react';
import { AlertTriangle, ClipboardPaste, Database, Plus, Zap } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

import Header from '../components/layout/Header';
import AccountModal from '../components/ai-proxy/AccountModal';
import { PastePackageDialog } from '@/components/ai-gateway/PastePackageDialog';
import { PublicModelsSection } from '@/components/ai-gateway/PublicModelsSection';
import { ProviderEndpointForm } from '@/components/ai-gateway/ProviderEndpointForm';
import { useAiProxyStore } from '../stores/aiProxy';
import { ProviderFilterBar } from '../components/ai-proxy/ProviderFilterBar';
import { ProviderCardsSection } from '../components/ai-proxy/ProviderCardsSection';
import { AiProxyAccountDrawer } from '../components/ai-proxy/AiProxyAccountDrawer';
import { ProxyStatusBar } from '../components/ai-proxy/sections/ProxyStatusBar';
import { AiProvidersKeysSection } from '../components/ai-proxy/sections/AiProvidersKeysSection';
import { useAiProvidersController } from './hooks/useAiProvidersController';
import { useAiHubCopy } from './hooks/useAiHubCopy';
import { useGatewayActions } from './hooks/useGatewayActions';
import type { AiProxyAccount } from '../types/generated';
import { Button, OverflowMenu, PageHeader } from '@/components/ui';
import { t } from '../lib/i18n';

const CLIENT_API_KEY = 'proxystitch-local';

export default function AiProvidersPage() {
  const [searchParams] = useSearchParams();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AiProxyAccount | null>(null);
  const [drawerAccount, setDrawerAccount] = useState<AiProxyAccount | null>(null);
  const [addEndpointOpen, setAddEndpointOpen] = useState(false);
  const proxyStoreStatus = useAiProxyStore(s => s.status);
  const serverOffline = !(proxyStoreStatus?.running ?? false);
  const controller = useAiProvidersController('providers');
  const { gatewayActionBusy, handleImportOpencode, handleMigrateLegacy } = useGatewayActions();

  const {
    accounts,
    loading,
    searchQuery,
    setSearchQuery,
    providerFilter,
    setProviderFilter,
    proxyStatus,
    proxySettings,
    proxyBusy,
    proxySaving,
    baseUrl,
    connectionState,
    providerCounts,
    fetchAccounts,
    refreshProxyInfo,
    handleStartStopProxy,
    handleDelete,
    handleTestConnection,
  } = controller;

  const handleCopy = useAiHubCopy();

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

  useEffect(() => {
    setSearchQuery(searchParams.get('q') ?? '');
    setProviderFilter(searchParams.get('provider') ?? 'all');
  }, [searchParams, setSearchQuery, setProviderFilter]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-void-base">
      <Header title={t('sidebar.aiHub')} icon={<Zap size={18} />} />

      <PageHeader
        eyebrow={t('sidebar.aiHub')}
        title={t('aiHub.sections.providers.title')}
        description={t('aiHub.sections.providers.subtitle')}
        actions={
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
        }
      />

      <div className="flex-1 flex flex-col overflow-hidden">
        <ProviderFilterBar providerCounts={providerCounts} />

        <div className="flex-1 space-y-4 overflow-auto p-4 md:p-6">
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
        </div>
      </div>

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

      <PastePackageDialog open={pasteOpen} onClose={() => setPasteOpen(false)} />

      <ProviderEndpointForm
        endpoint={null}
        open={addEndpointOpen}
        onClose={() => setAddEndpointOpen(false)}
      />
    </div>
  );
}
