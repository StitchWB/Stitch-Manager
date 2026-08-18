import { useEffect } from 'react';
import { t } from '@/lib/i18n';
import { Plus, Trash2, Edit2, Server, CheckCircle2, XCircle, RotateCw } from 'lucide-react';
import { useAiGatewayStore } from '@/stores/aiGateway';
import type { ProviderEndpoint } from '@/lib/backend/modules/aiGateway';
import { Button } from '@/components/ui/Button';
import { ConfirmActionButton } from '@/components/ui/ConfirmActionButton';

interface ProviderEndpointsListProps {
  onSelectEndpoint: (endpoint: ProviderEndpoint) => void;
  onAddEndpoint: () => void;
  onEditEndpoint: (endpoint: ProviderEndpoint) => void;
}

export function ProviderEndpointsList({
  onSelectEndpoint,
  onAddEndpoint,
  onEditEndpoint,
}: ProviderEndpointsListProps) {
  const { endpoints, loading, errors, fetchEndpoints, deleteEndpoint } = useAiGatewayStore();

  useEffect(() => {
    fetchEndpoints();
  }, [fetchEndpoints]);

  if (loading.endpoints) {
    return <div className="p-4 text-center text-slate-400">{t('aiGateway.list.loadingEndpoints')}</div>;
  }

  if (errors.endpoints) {
    return (
      <div className="p-4 text-center text-red-400">
        <div className="mb-2">{t('aiGateway.list.error')}: {errors.endpoints}</div>
        <Button size="sm" variant="outline" onClick={() => fetchEndpoints()}>
          <RotateCw className="h-4 w-4 mr-2" />{t('aiGateway.list.retry')}
        </Button>
      </div>
    );
  }

  if (endpoints.length === 0) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-lg p-8 text-center">
        <Server className="mx-auto h-12 w-12 text-slate-400 mb-4" />
        <h3 className="text-lg font-semibold mb-2">{t('aiGateway.list.noEndpoints')}</h3>
        <p className="text-slate-400 mb-4">{t('aiGateway.list.noEndpointsDesc')}</p>
        <Button onClick={onAddEndpoint}><Plus className="h-4 w-4 mr-2" />{t('aiGateway.list.addEndpoint')}</Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">{t('aiGateway.list.endpointsTitle')}</h2>
        <Button size="sm" onClick={onAddEndpoint}><Plus className="h-4 w-4 mr-2" />{t('aiGateway.list.addEndpointShort')}</Button>
      </div>

      {endpoints.map(endpoint => (
        <div
          key={endpoint.id}
          className="bg-white/5 border border-white/10 rounded-lg p-4 cursor-pointer hover:bg-white/10 transition-colors"
          onClick={() => onSelectEndpoint(endpoint)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1">
              <Server className="h-5 w-5 text-slate-400" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold truncate">{endpoint.name}</h3>
                  {endpoint.enabled ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-400" />
                  )}
                </div>
                <div className="text-sm text-slate-400">
                  {endpoint.adapterType} • {endpoint.baseUrl}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); onEditEndpoint(endpoint); }}>
                <Edit2 className="h-4 w-4" />
              </Button>
              <ConfirmActionButton
                iconOnly
                size="sm"
                variant="ghost"
                armedLabel={<Trash2 className="h-4 w-4 text-red-400" />}
                onConfirm={() => void deleteEndpoint(endpoint.id)}>
                <Trash2 className="h-4 w-4 text-red-400" />
              </ConfirmActionButton>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
