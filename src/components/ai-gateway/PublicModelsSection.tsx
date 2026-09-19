import { useState } from 'react';
import { ArrowLeft, Globe } from 'lucide-react';
import { PublicModelsList } from '@/components/ai-gateway/PublicModelsList';
import { PublicModelForm } from '@/components/ai-gateway/PublicModelForm';
import { RouteTargetsList } from '@/components/ai-gateway/RouteTargetsList';
import { RouteTargetForm } from '@/components/ai-gateway/RouteTargetForm';
import { Button, CollapsibleSection } from '@/components/ui';
import { t } from '@/lib/i18n';
import { useFormDialog } from '@/hooks/useFormDialog';
import type { PublicModel, RouteTarget } from '@/lib/backend/modules/aiGateway';

export function PublicModelsSection() {
  const [selectedModel, setSelectedModel] = useState<PublicModel | null>(null);

  const publicModelDialog = useFormDialog<PublicModel>();
  const routeTargetDialog = useFormDialog<RouteTarget>();

  const handleSelectModel = (publicModel: PublicModel) => {
    setSelectedModel(publicModel);
  };

  const handleBack = () => {
    setSelectedModel(null);
  };

  const handleAddRouteTarget = () => {
    if (selectedModel) {
      routeTargetDialog.open();
    }
  };

  const handleEditRouteTarget = (target: RouteTarget) => {
    if (selectedModel) {
      routeTargetDialog.open(target);
    }
  };

  return (
    <CollapsibleSection
      title={t('aiGateway.list.publicModelsTitle')}
      description={t('aiGateway.publicModels.description')}
      icon={<Globe size={16} className="text-slate-300" />}
      defaultExpanded={false}
    >
      {selectedModel ? (
        <div className="space-y-6">
          <Button variant="ghost" onClick={handleBack} className="mb-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t('aiGateway.backModels')}
          </Button>

          <div className="bg-white/5 border border-white/10 rounded-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <Globe className="h-6 w-6" />
              <h2 className="text-2xl font-semibold">{selectedModel.id}</h2>
            </div>
            {selectedModel.displayName && (
              <div className="text-sm text-slate-400 mb-2">{selectedModel.displayName}</div>
            )}
            <div className="text-sm text-slate-400">
              {t('aiGateway.statusLabel')}:{' '}
              {selectedModel.enabled ? t('aiGateway.enabled') : t('aiGateway.disabled')}
            </div>
            {selectedModel.contract && (
              <div className="mt-4">
                <h3 className="text-sm font-medium mb-2">{t('aiGateway.contract')}</h3>
                <pre className="text-xs bg-white/5 p-3 rounded overflow-auto">
                  {JSON.stringify(selectedModel.contract, null, 2)}
                </pre>
              </div>
            )}
          </div>

          <RouteTargetsList
            publicModel={selectedModel}
            onAddTarget={handleAddRouteTarget}
            onEditTarget={handleEditRouteTarget}
          />
        </div>
      ) : (
        <PublicModelsList
          onAddModel={() => publicModelDialog.open()}
          onEditModel={model => publicModelDialog.open(model)}
          onSelectModel={handleSelectModel}
        />
      )}

      <PublicModelForm
        key={`public-${publicModelDialog.editingItem?.id ?? 'new'}`}
        model={publicModelDialog.editingItem}
        open={publicModelDialog.isOpen}
        onClose={publicModelDialog.close}
      />

      {selectedModel && (
        <RouteTargetForm
          key={`target-${routeTargetDialog.editingItem?.id ?? 'new'}`}
          publicModel={selectedModel}
          target={routeTargetDialog.editingItem}
          open={routeTargetDialog.isOpen}
          onClose={routeTargetDialog.close}
        />
      )}
    </CollapsibleSection>
  );
}
