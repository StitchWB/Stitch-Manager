import { useEffect } from 'react';
import { t } from '@/lib/i18n';
import { Plus, Trash2, Edit2, Cpu, RotateCw } from 'lucide-react';
import { useAiGatewayStore } from '@/stores/aiGateway';
import type { UpstreamModel, ProviderEndpoint } from '@/lib/backend/modules/aiGateway';
import { Button, Badge, ConfirmActionButton } from '@/components/ui';

interface UpstreamModelsListProps {
  endpoint: ProviderEndpoint;
  onAddModel: () => void;
  onEditModel: (model: UpstreamModel) => void;
}

export function UpstreamModelsList({ endpoint, onAddModel, onEditModel }: UpstreamModelsListProps) {
  const { upstreamModels, loading, errors, fetchUpstreamModels, deleteUpstreamModel } = useAiGatewayStore();

  useEffect(() => {
    fetchUpstreamModels(endpoint.id);
  }, [endpoint.id, fetchUpstreamModels]);

  const getCapabilityBadges = (capabilities: Record<string, unknown> | null | undefined) => {
    if (!capabilities) return null;
    const badges: React.ReactNode[] = [];
    if (capabilities.supports_vision) badges.push(<Badge key="vision" variant="outline">{t('aiGateway.form.vision')}</Badge>);
    if (capabilities.supports_tools) badges.push(<Badge key="tools" variant="outline">{t('aiGateway.form.tools')}</Badge>);
    if (capabilities.supports_streaming) badges.push(<Badge key="streaming" variant="outline">{t('aiGateway.form.streaming')}</Badge>);
    if (capabilities.supports_json_mode) badges.push(<Badge key="json" variant="outline">{t('aiGateway.form.json')}</Badge>);
    return badges.length > 0 ? <div className="flex gap-1 mt-1">{badges}</div> : null;
  };

  if (loading.upstreamModels) {
    return <div className="p-4 text-center text-slate-400">{t('aiGateway.list.loadingModels')}</div>;
  }

  if (errors.upstreamModels) {
    return (
      <div className="p-4 text-center text-red-400">
        <div className="mb-2">{t('aiGateway.list.error')}: {errors.upstreamModels}</div>
        <Button size="sm" variant="outline" onClick={() => fetchUpstreamModels(endpoint.id)}>
          <RotateCw className="h-4 w-4 mr-2" />{t('aiGateway.list.retry')}
        </Button>
      </div>
    );
  }

  if (upstreamModels.length === 0) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-lg p-8 text-center">
        <Cpu className="mx-auto h-12 w-12 text-slate-400 mb-4" />
        <h3 className="text-lg font-semibold mb-2">{t('aiGateway.list.noUpstreamModels')}</h3>
        <p className="text-slate-400 mb-4">{t('aiGateway.list.noUpstreamModelsDesc')}</p>
        <Button onClick={onAddModel}><Plus className="h-4 w-4 mr-2" />{t('aiGateway.list.addModel')}</Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">{t('aiGateway.list.upstreamModelsTitle')} ({upstreamModels.length})</h3>
        <Button size="sm" onClick={onAddModel}><Plus className="h-4 w-4 mr-2" />{t('aiGateway.list.addModel')}</Button>
      </div>

      {upstreamModels.map(model => (
        <div
          key={model.id}
          className="bg-white/5 border border-white/10 rounded-lg p-4 cursor-pointer hover:bg-white/10 transition-colors"
          onClick={() => onEditModel(model)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1">
              <Cpu className="h-5 w-5 text-slate-400" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="font-medium truncate">{model.displayName || model.upstreamModelId}</h4>
                  {model.enabled && <Badge variant="success">{t('aiGateway.enabled')}</Badge>}
                </div>
                <div className="text-sm text-slate-400">{model.upstreamModelId} • {model.discoverySource}</div>
                {getCapabilityBadges(model.capabilities)}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); onEditModel(model); }}>
                <Edit2 className="h-4 w-4" />
              </Button>
              <ConfirmActionButton
                iconOnly
                size="sm"
                variant="ghost"
                armedLabel={<Trash2 className="h-4 w-4 text-red-400" />}
                onConfirm={() => void deleteUpstreamModel(model.id)}>
                <Trash2 className="h-4 w-4 text-red-400" />
              </ConfirmActionButton>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
