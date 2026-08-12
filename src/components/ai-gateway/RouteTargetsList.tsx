import { useEffect, useMemo } from 'react';
import { t } from '@/lib/i18n';
import { Plus, Trash2, ArrowRight, RotateCw } from 'lucide-react';
import { useAiGatewayStore } from '@/stores/aiGateway';
import type { RouteTarget, PublicModel } from '@/lib/backend/modules/aiGateway';
import { Button, Badge, Tooltip } from '@/components/ui';

interface RouteTargetsListProps {
  publicModel: PublicModel;
  onAddTarget: () => void;
  onEditTarget: (target: RouteTarget) => void;
}

export function RouteTargetsList({ publicModel, onAddTarget, onEditTarget }: RouteTargetsListProps) {
  const { routeTargets, upstreamModels, loading, errors, fetchRouteTargets, fetchUpstreamModels, deleteRouteTarget } = useAiGatewayStore();

  useEffect(() => {
    fetchRouteTargets(publicModel.id);
    fetchUpstreamModels();
  }, [publicModel.id, fetchRouteTargets, fetchUpstreamModels]);

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (confirm('Delete this route target?')) {
      await deleteRouteTarget(id);
    }
  };

  const getUpstreamModelName = (upstreamModelId: string) => {
    const model = upstreamModels.find(m => m.id === upstreamModelId);
    return model
      ? `${model.upstreamModelId} (${model.providerEndpointId.slice(0, 8)})`
      : `${upstreamModelId.slice(0, 16)} (unknown endpoint)`;
  };

  const sortedTargets = useMemo(
    () => [...routeTargets].sort((a, b) => a.priority - b.priority),
    [routeTargets],
  );

  if (loading.routeTargets) {
    return <div className="p-4 text-center text-slate-400">{t('aiGateway.list.loadingTargets')}</div>;
  }

  if (errors.routeTargets) {
    return (
      <div className="p-4 text-center text-red-400">
        <div className="mb-2">{t('aiGateway.list.error')}: {errors.routeTargets}</div>
        <Button size="sm" variant="outline" onClick={() => fetchRouteTargets(publicModel.id)}>
          <RotateCw className="h-4 w-4 mr-2" />{t('aiGateway.list.retry')}
        </Button>
      </div>
    );
  }

  if (routeTargets.length === 0) {
    return (
      <div className="bg-white/5 border border-white/10 rounded-lg p-8 text-center">
        <ArrowRight className="mx-auto h-12 w-12 text-slate-400 mb-4" />
        <h3 className="text-lg font-semibold mb-2">{t('aiGateway.list.noTargets')}</h3>
        <p className="text-slate-400 mb-4">{t('aiGateway.list.noTargetsDesc')}</p>
        <Button onClick={onAddTarget}><Plus className="h-4 w-4 mr-2" />{t('aiGateway.list.addTarget')}</Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">{t('aiGateway.list.targetsTitle')} ({routeTargets.length})</h3>
        <Button size="sm" onClick={onAddTarget}><Plus className="h-4 w-4 mr-2" />{t('aiGateway.list.addTargetShort')}</Button>
      </div>

      {sortedTargets.map(target => (
        <div
          key={target.id}
          className="bg-white/5 border border-white/10 rounded-lg p-4 cursor-pointer hover:bg-white/10 transition-colors"
          onClick={() => onEditTarget(target)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1">
              <ArrowRight className="h-5 w-5 text-slate-400" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="font-medium truncate">{getUpstreamModelName(target.upstreamModelId)}</h4>
                  <Badge variant="outline">{t('aiGateway.form.priority')} {target.priority}</Badge>
                  {target.enabled ? (
                    <Badge variant="success">{t('aiGateway.enabled')}</Badge>
                  ) : (
                    <Badge variant="default">{t('aiGateway.disabled')}</Badge>
                  )}
                </div>
                <div className="text-sm text-slate-400">
                  <Tooltip content={t('aiGateway.form.weightTooltip')}>
                    <span>{t('aiGateway.form.weight')}</span>
                  </Tooltip>{' '}{t('aiGateway.form.weightCost', { weight: target.weight, cost: target.costModifier })}
                </div>
              </div>
            </div>

            <Button size="sm" variant="ghost" onClick={e => handleDelete(e, target.id)}>
              <Trash2 className="h-4 w-4 text-red-400" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
