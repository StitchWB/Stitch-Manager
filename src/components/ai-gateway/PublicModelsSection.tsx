import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, ChevronRight, Globe, Pencil, Plus, Trash2 } from 'lucide-react';
import { PublicModelForm } from '@/components/ai-gateway/PublicModelForm';
import { RouteTargetForm } from '@/components/ai-gateway/RouteTargetForm';
import { Button, ButtonBase, EmptyState, askConfirm } from '@/components/ui';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useFormDialog } from '@/hooks/useFormDialog';
import { useAiGatewayStore } from '@/stores/aiGateway';
import { listRouteTargetsForPublicModel } from '@/lib/backend/modules/aiGateway';
import type { PublicModel, RouteTarget } from '@/lib/backend/modules/aiGateway';

export function PublicModelsSection() {
  const {
    publicModels,
    upstreamModels,
    endpoints,
    loading,
    errors,
    fetchPublicModels,
    fetchUpstreamModels,
    fetchEndpoints,
    deletePublicModel,
    deleteRouteTarget,
  } = useAiGatewayStore();

  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [targetsByModel, setTargetsByModel] = useState<Record<string, RouteTarget[]>>({});
  const [routeDialogModel, setRouteDialogModel] = useState<PublicModel | null>(null);

  const publicModelDialog = useFormDialog<PublicModel>();
  const routeTargetDialog = useFormDialog<RouteTarget>();

  useEffect(() => {
    fetchPublicModels();
    fetchUpstreamModels();
    fetchEndpoints();
  }, [fetchPublicModels, fetchUpstreamModels, fetchEndpoints]);

  const reloadTargets = useCallback(async (modelId: string) => {
    const targets = await listRouteTargetsForPublicModel(modelId);
    setTargetsByModel(prev => ({ ...prev, [modelId]: targets }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      publicModels.map(async model => [model.id, await listRouteTargetsForPublicModel(model.id)] as const),
    )
      .then(entries => {
        if (!cancelled) setTargetsByModel(Object.fromEntries(entries));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [publicModels]);

  const toggleExpand = (modelId: string) => {
    setExpandedIds(prev =>
      prev.includes(modelId) ? prev.filter(id => id !== modelId) : [...prev, modelId],
    );
  };

  const openRouteDialog = (model: PublicModel, target?: RouteTarget) => {
    setRouteDialogModel(model);
    routeTargetDialog.open(target);
  };

  const closeRouteDialog = () => {
    routeTargetDialog.close();
    if (routeDialogModel) void reloadTargets(routeDialogModel.id);
    setRouteDialogModel(null);
  };

  const handleDeleteModel = async (model: PublicModel) => {
    const ok = await askConfirm({
      title: t('common.delete'),
      message: t('aiGateway.list.deletePublicModelConfirm'),
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
      variant: 'danger',
    });
    if (!ok) return;
    await deletePublicModel(model.id);
  };

  const handleDeleteTarget = async (model: PublicModel, target: RouteTarget) => {
    const ok = await askConfirm({
      title: t('common.delete'),
      message: t('aiGateway.list.deleteRouteTargetConfirm'),
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
      variant: 'danger',
    });
    if (!ok) return;
    await deleteRouteTarget(target.id);
    await reloadTargets(model.id);
  };

  const resolveTargetLabel = (target: RouteTarget): string => {
    const upstream = upstreamModels.find(m => m.id === target.upstreamModelId);
    if (!upstream) return target.upstreamModelId;
    const endpoint = endpoints.find(e => e.id === upstream.providerEndpointId);
    const providerName = endpoint?.name ?? upstream.providerEndpointId.slice(0, 8);
    const display = upstream.displayName ? ` (${upstream.displayName})` : '';
    return `${providerName} / ${upstream.upstreamModelId}${display}`;
  };

  return (
    <section className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
      <div className="flex items-start gap-3 border-b border-white/[0.06] px-3 py-2.5">
        <Globe size={16} className="mt-0.5 shrink-0 text-slate-300" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-white">{t('aiGateway.list.publicModelsTitle')}</h2>
          <p className="mt-0.5 text-xs text-slate-400">{t('aiGateway.publicModels.description')}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={() => publicModelDialog.open()}
        >
          <Plus size={14} className="mr-1" />
          {t('aiGateway.list.createPublicModel')}
        </Button>
      </div>

      {loading.publicModels ? (
        <p className="px-3 py-4 text-center text-xs text-slate-400">
          {t('aiGateway.list.loadingModels')}
        </p>
      ) : errors.publicModels ? (
        <div className="px-3 py-4 text-center text-xs text-red-400">
          <p className="mb-2">
            {t('aiGateway.list.error')}: {errors.publicModels}
          </p>
          <Button size="sm" variant="outline" onClick={() => fetchPublicModels()}>
            {t('aiGateway.list.retry')}
          </Button>
        </div>
      ) : publicModels.length === 0 ? (
        <EmptyState
          icon={Globe}
          title={t('aiGateway.list.noPublicModels')}
          description={t('aiGateway.list.noPublicModelsDesc')}
          action={
            <Button size="sm" onClick={() => publicModelDialog.open()}>
              <Plus size={14} className="mr-1" />
              {t('aiGateway.list.addPublicModel')}
            </Button>
          }
        />
      ) : (
        <div className="divide-y divide-white/[0.04]">
          {publicModels.map(model => {
            const expanded = expandedIds.includes(model.id);
            const targets = [...(targetsByModel[model.id] ?? [])].sort((a, b) => a.priority - b.priority);
            return (
              <div key={model.id}>
                <div className="flex items-center gap-1 px-2 py-1.5">
                  <ButtonBase
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => toggleExpand(model.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-white/[0.04]"
                  >
                    <ChevronRight
                      size={13}
                      className={cn('shrink-0 text-slate-500 transition-transform', expanded && 'rotate-90')}
                    />
                    <span
                      className={cn(
                        'h-1.5 w-1.5 shrink-0 rounded-full',
                        model.enabled ? 'bg-emerald-400' : 'bg-slate-600',
                      )}
                    />
                    <span className="truncate font-mono text-xs text-slate-200">{model.id}</span>
                    {model.displayName && (
                      <span className="truncate text-[11px] text-slate-500">{model.displayName}</span>
                    )}
                    <span className="ml-auto shrink-0 text-[11px] tabular-nums text-slate-500">
                      {t('aiGateway.list.routesCount', { count: targets.length })}
                    </span>
                  </ButtonBase>
                  <ButtonBase
                    type="button"
                    aria-label={t('common.edit')}
                    onClick={() => publicModelDialog.open(model)}
                    className="shrink-0 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/[0.04] hover:text-slate-200"
                  >
                    <Pencil size={13} />
                  </ButtonBase>
                  <ButtonBase
                    type="button"
                    aria-label={t('common.delete')}
                    onClick={() => void handleDeleteModel(model)}
                    className="shrink-0 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
                  >
                    <Trash2 size={13} />
                  </ButtonBase>
                </div>

                {expanded && (
                  <div className="px-4 pb-2.5 pt-0.5">
                    {targets.length === 0 ? (
                      <p className="px-2 py-1.5 text-[11px] text-slate-500">{t('aiGateway.list.noRoutes')}</p>
                    ) : (
                      <div className="divide-y divide-white/[0.04] rounded-lg border border-white/[0.06] bg-black/20">
                        {targets.map(target => (
                          <div key={target.id} className="flex items-center gap-1 px-1.5 py-1">
                            <ButtonBase
                              type="button"
                              onClick={() => openRouteDialog(model, target)}
                              className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-white/[0.04]"
                            >
                              <ArrowRight size={12} className="shrink-0 text-indigo-300" />
                              <span className="truncate text-xs text-slate-300">
                                {resolveTargetLabel(target)}
                              </span>
                              <span className="ml-auto shrink-0 text-[11px] tabular-nums text-slate-500">
                                {t('aiGateway.list.priorityWeight', {
                                  priority: target.priority,
                                  weight: target.weight,
                                })}
                              </span>
                            </ButtonBase>
                            <span
                              className={cn(
                                'h-1.5 w-1.5 shrink-0 rounded-full',
                                target.enabled ? 'bg-emerald-400' : 'bg-slate-600',
                              )}
                            />
                            <ButtonBase
                              type="button"
                              aria-label={t('common.delete')}
                              onClick={() => void handleDeleteTarget(model, target)}
                              className="shrink-0 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-500/10 hover:text-red-300"
                            >
                              <Trash2 size={12} />
                            </ButtonBase>
                          </div>
                        ))}
                      </div>
                    )}
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      className="mt-1.5"
                      onClick={() => openRouteDialog(model)}
                    >
                      <Plus size={12} className="mr-1" />
                      {t('aiGateway.form.addRoute')}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <PublicModelForm
        key={`public-${publicModelDialog.editingItem?.id ?? 'new'}`}
        model={publicModelDialog.editingItem}
        open={publicModelDialog.isOpen}
        onClose={publicModelDialog.close}
      />

      {routeDialogModel && (
        <RouteTargetForm
          key={`target-${routeTargetDialog.editingItem?.id ?? 'new'}`}
          publicModel={routeDialogModel}
          target={routeTargetDialog.editingItem}
          open={routeTargetDialog.isOpen}
          onClose={closeRouteDialog}
        />
      )}
    </section>
  );
}
