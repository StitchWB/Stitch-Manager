import { useState } from 'react';
import { ArrowLeft, Server, Globe, Search, Database } from 'lucide-react';
import { ProviderEndpointsList } from '@/components/ai-gateway/ProviderEndpointsList';
import { ProviderEndpointForm } from '@/components/ai-gateway/ProviderEndpointForm';
import { CredentialsList } from '@/components/ai-gateway/CredentialsList';
import { CredentialForm } from '@/components/ai-gateway/CredentialForm';
import { UpstreamModelsList } from '@/components/ai-gateway/UpstreamModelsList';
import { UpstreamModelForm } from '@/components/ai-gateway/UpstreamModelForm';
import { PublicModelsList } from '@/components/ai-gateway/PublicModelsList';
import { PublicModelForm } from '@/components/ai-gateway/PublicModelForm';
import { RouteTargetsList } from '@/components/ai-gateway/RouteTargetsList';
import { RouteTargetForm } from '@/components/ai-gateway/RouteTargetForm';
import { Button, ConfirmActionButton } from '@/components/ui';
import { t } from '@/lib/i18n';
import { appToast } from '@/lib/observability/toast';
import { useAiGatewayStore } from '@/stores/aiGateway';
import { useFormDialog } from '@/hooks/useFormDialog';
import { discoverModelsForEndpoint } from '@/lib/backend/modules/aiGateway';
import type {
  ProviderEndpoint,
  Credential,
  UpstreamModel,
  PublicModel,
  RouteTarget,
} from '@/lib/backend/modules/aiGateway';

type View =
  | { type: 'endpoints' }
  | { type: 'endpoint-detail'; endpoint: ProviderEndpoint }
  | { type: 'public-model-detail'; publicModel: PublicModel };

export default function AiGateway() {
  const [view, setView] = useState<View>({ type: 'endpoints' });

  // Form dialogs
  const endpointDialog = useFormDialog<ProviderEndpoint>();
  const credentialDialog = useFormDialog<Credential>();
  const upstreamDialog = useFormDialog<UpstreamModel>();
  const publicModelDialog = useFormDialog<PublicModel>();
  const routeTargetDialog = useFormDialog<RouteTarget>();

  // Context for nested forms (which endpoint/public-model the form targets)
  const [currentEndpoint, setCurrentEndpoint] = useState<ProviderEndpoint | null>(null);
  const [currentPublicModel, setCurrentPublicModel] = useState<PublicModel | null>(null);

  // Discover Models state
  const [discovering, setDiscovering] = useState(false);

  // Migration state
  const { migrateLegacyData, fetchUpstreamModels } = useAiGatewayStore();
  const [migrating, setMigrating] = useState(false);


  const handleSelectEndpoint = (endpoint: ProviderEndpoint) => {
    setView({ type: 'endpoint-detail', endpoint });
  };

  const handleAddEndpoint = () => {
    endpointDialog.open();
  };

  const handleEditEndpoint = (endpoint: ProviderEndpoint) => {
    endpointDialog.open(endpoint);
  };

  const handleBack = () => {
    setView({ type: 'endpoints' });
    setCurrentEndpoint(null);
    setCurrentPublicModel(null);
  };

  const handleAddCredential = () => {
    if (view.type === 'endpoint-detail') {
      setCurrentEndpoint(view.endpoint);
      credentialDialog.open();
    }
  };

  const handleEditCredential = (credential: Credential) => {
    if (view.type === 'endpoint-detail') {
      setCurrentEndpoint(view.endpoint);
      credentialDialog.open(credential);
    }
  };

  const handleAddUpstreamModel = () => {
    if (view.type === 'endpoint-detail') {
      setCurrentEndpoint(view.endpoint);
      upstreamDialog.open();
    }
  };

  const handleEditUpstreamModel = (model: UpstreamModel) => {
    if (view.type === 'endpoint-detail') {
      setCurrentEndpoint(view.endpoint);
      upstreamDialog.open(model);
    }
  };

  const handleSelectPublicModel = (publicModel: PublicModel) => {
    setView({ type: 'public-model-detail', publicModel });
  };

  const handleAddPublicModel = () => {
    publicModelDialog.open();
  };

  const handleEditPublicModel = (publicModel: PublicModel) => {
    publicModelDialog.open(publicModel);
  };

  const handleAddRouteTarget = () => {
    if (view.type === 'public-model-detail') {
      setCurrentPublicModel(view.publicModel);
      routeTargetDialog.open();
    }
  };

  const handleEditRouteTarget = (target: RouteTarget) => {
    if (view.type === 'public-model-detail') {
      setCurrentPublicModel(view.publicModel);
      routeTargetDialog.open(target);
    }
  };

  const handleDiscoverModels = async () => {
    if (view.type !== 'endpoint-detail') return;
    setDiscovering(true);
    try {
      const result = await discoverModelsForEndpoint(view.endpoint.id);
      appToast.success(`Discovered ${result.models_count} models`, 'ai-gateway');
      await fetchUpstreamModels(view.endpoint.id);
    } catch (e) {
      appToast.error(e instanceof Error ? e.message : 'Discovery failed', 'ai-gateway');
    } finally {
      setDiscovering(false);
    }
  };

  const handleMigrate = async () => {
    setMigrating(true);
    try {
      const result = await migrateLegacyData();
      appToast.success(
        `Migrated ${result.endpoints_created} endpoints, ${result.credentials_created} credentials`,
        'ai-gateway'
      );
    } catch (e) {
      appToast.error(e instanceof Error ? e.message : 'Migration failed', 'ai-gateway');
    } finally {
      setMigrating(false);
    }
  };

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">{t('aiGateway.title')}</h1>
          <p className="text-muted-foreground">
            {t('aiGateway.subtitle')}
          </p>
        </div>
        <ConfirmActionButton
          variant="outline"
          size="sm"
          isLoading={migrating}
          onConfirm={handleMigrate}
        >
          <Database className="h-4 w-4 mr-2" />
          {t('aiGateway.migrate')}
        </ConfirmActionButton>
      </div>

      {view.type === 'endpoints' && (
        <div className="space-y-8">
          <div>
            <ProviderEndpointsList
              onSelectEndpoint={handleSelectEndpoint}
              onAddEndpoint={handleAddEndpoint}
              onEditEndpoint={handleEditEndpoint}
            />
          </div>

          <div>
            <PublicModelsList
              onAddModel={handleAddPublicModel}
              onEditModel={handleEditPublicModel}
              onSelectModel={handleSelectPublicModel}
            />
          </div>
        </div>
      )}

      {view.type === 'endpoint-detail' && (
        <div className="space-y-6">
          <Button variant="ghost" onClick={handleBack} className="mb-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t('aiGateway.backEndpoints')}
          </Button>

          <div className="bg-white/5 border border-white/10 rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Server className="h-6 w-6" />
                <h2 className="text-2xl font-semibold">{view.endpoint.name}</h2>
              </div>
              <Button
                variant="outline"
                size="sm"
                isLoading={discovering}
                onClick={handleDiscoverModels}
              >
                {!discovering && <Search className="h-4 w-4 mr-2" />}
                {discovering ? t('aiGateway.discovering') : t('aiGateway.discoverModels')}
              </Button>
            </div>
            <div className="text-sm text-slate-400 space-y-1">
              <div>{t('aiGateway.adapter')}: {view.endpoint.adapterType}</div>
              <div>{t('aiGateway.baseUrl')}: {view.endpoint.baseUrl}</div>
              <div>{t('aiGateway.status')}: {view.endpoint.enabled ? t('aiGateway.enabled') : t('aiGateway.disabled')}</div>
            </div>
          </div>

          <CredentialsList
            endpoint={view.endpoint}
            onAddCredential={handleAddCredential}
            onEditCredential={handleEditCredential}
          />

          <UpstreamModelsList
            endpoint={view.endpoint}
            onAddModel={handleAddUpstreamModel}
            onEditModel={handleEditUpstreamModel}
          />
        </div>
      )}

      {view.type === 'public-model-detail' && (
        <div className="space-y-6">
          <Button variant="ghost" onClick={handleBack} className="mb-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t('aiGateway.backModels')}
          </Button>

          <div className="bg-white/5 border border-white/10 rounded-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <Globe className="h-6 w-6" />
              <h2 className="text-2xl font-semibold">{view.publicModel.id}</h2>
            </div>
            {view.publicModel.displayName && (
              <div className="text-sm text-slate-400 mb-2">{view.publicModel.displayName}</div>
            )}
            <div className="text-sm text-slate-400">
              {t('aiGateway.status')}: {view.publicModel.enabled ? t('aiGateway.enabled') : t('aiGateway.disabled')}
            </div>
            {view.publicModel.contract && (
              <div className="mt-4">
                <h3 className="text-sm font-medium mb-2">{t('aiGateway.contract')}</h3>
                <pre className="text-xs bg-white/5 p-3 rounded overflow-auto">
                  {JSON.stringify(view.publicModel.contract, null, 2)}
                </pre>
              </div>
            )}
          </div>

          <RouteTargetsList
            publicModel={view.publicModel}
            onAddTarget={handleAddRouteTarget}
            onEditTarget={handleEditRouteTarget}
          />
        </div>
      )}

      {/* Forms */}
      <ProviderEndpointForm
        key={`endpoint-${endpointDialog.editingItem?.id ?? 'new'}`}
        endpoint={endpointDialog.editingItem}
        open={endpointDialog.isOpen}
        onClose={endpointDialog.close}
      />

      {currentEndpoint && (
        <>
          <CredentialForm
            key={`credential-${credentialDialog.editingItem?.id ?? 'new'}`}
            endpoint={currentEndpoint}
            credential={credentialDialog.editingItem}
            open={credentialDialog.isOpen}
            onClose={credentialDialog.close}
          />

          <UpstreamModelForm
            key={`upstream-${upstreamDialog.editingItem?.id ?? 'new'}`}
            endpoint={currentEndpoint}
            model={upstreamDialog.editingItem}
            open={upstreamDialog.isOpen}
            onClose={upstreamDialog.close}
          />
        </>
      )}

      <PublicModelForm
        key={`public-${publicModelDialog.editingItem?.id ?? 'new'}`}
        model={publicModelDialog.editingItem}
        open={publicModelDialog.isOpen}
        onClose={publicModelDialog.close}
      />

      {currentPublicModel && (
        <RouteTargetForm
          key={`target-${routeTargetDialog.editingItem?.id ?? 'new'}`}
          publicModel={currentPublicModel}
          target={routeTargetDialog.editingItem}
          open={routeTargetDialog.isOpen}
          onClose={routeTargetDialog.close}
        />
      )}

    </div>
  );
}
