import { useState } from 'react';
import { toast } from 'sonner';
import { Boxes, Check, EyeOff, Globe, Loader2, Plus, Radio, RefreshCw, TriangleAlert, X } from 'lucide-react';
import type { ModelProbeRow, UpstreamModel } from '@/lib/backend/modules/aiGateway';
import { probeEndpointModels } from '@/lib/backend/modules/aiGateway';
import { useAiGatewayStore } from '@/stores/aiGateway';
import {
  Badge,
  Button,
  ButtonBase,
  Checkbox,
  EmptyState,
  Input,
  SkeletonLoader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

export interface ProviderModelsPanelProps {
  endpointId?: string;
  models: UpstreamModel[];
  loading: boolean;
  busy: boolean;
  discovering: boolean;
  error?: string | null;
  onDiscover: () => void;
  onAddModel?: (modelId: string) => Promise<boolean>;
  onExposeModel?: (model: UpstreamModel) => void;
  published?: Record<string, string>;
  onPublishedChange?: () => void;
}

const RENDER_CAP = 500;

export function ProviderModelsPanel(props: ProviderModelsPanelProps): JSX.Element {
  const {
    endpointId,
    models,
    loading,
    busy,
    discovering,
    error,
    onDiscover,
    onAddModel,
    onExposeModel,
    published,
    onPublishedChange,
  } = props;
  const [modelIdInput, setModelIdInput] = useState('');
  const [addingModel, setAddingModel] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [probeProgress, setProbeProgress] = useState<{ done: number; total: number } | null>(null);
  const [probeResults, setProbeResults] = useState<Record<string, ModelProbeRow>>({});

  const createPublicModel = useAiGatewayStore(state => state.createPublicModel);
  const createRouteTarget = useAiGatewayStore(state => state.createRouteTarget);
  const updateUpstreamModel = useAiGatewayStore(state => state.updateUpstreamModel);

  const visibleModels = models.slice(0, RENDER_CAP);
  const hiddenCount = models.length - visibleModels.length;

  const allVisibleSelected =
    visibleModels.length > 0 && visibleModels.every(model => selectedIds.has(model.id));

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(visibleModels.map(m => m.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleToggleSelect = (id: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const handleAddModel = async () => {
    const modelId = modelIdInput.trim();
    if (!modelId || addingModel || !onAddModel) return;
    setAddingModel(true);
    try {
      if (await onAddModel(modelId)) setModelIdInput('');
    } finally {
      setAddingModel(false);
    }
  };

  const handleBatchPublish = async () => {
    const targets = visibleModels.filter(m => selectedIds.has(m.id) && !published?.[m.id]);
    if (targets.length === 0) return;
    setBatchBusy(true);
    let publishedCount = 0;
    try {
      for (const model of targets) {
        try {
          const publicModel = await createPublicModel({
            id: model.upstreamModelId,
            displayName: model.displayName || null,
            contract: null,
            enabled: true,
          });
          await createRouteTarget({
            publicModelId: publicModel.id,
            upstreamModelId: model.id,
            priority: 1,
            weight: 1,
            costModifier: 1,
            enabled: true,
          });
          publishedCount += 1;
        } catch {
        }
      }
      toast.success(t('aiHub.providersPage.batchPublishSuccess', { count: publishedCount }));
      setSelectedIds(new Set());
      onPublishedChange?.();
    } finally {
      setBatchBusy(false);
    }
  };

  const selectedAllDisabled =
    selectedIds.size > 0 && visibleModels.every(m => !selectedIds.has(m.id) || !m.enabled);

  const handleBatchDisable = async () => {
    const selected = visibleModels.filter(m => selectedIds.has(m.id));
    const enabling = selected.length > 0 && selected.every(m => !m.enabled);
    const targets = selected.filter(m => (enabling ? !m.enabled : m.enabled));
    if (targets.length === 0) return;
    setBatchBusy(true);
    let changedCount = 0;
    try {
      for (const model of targets) {
        try {
          await updateUpstreamModel({
            id: model.id,
            enabled: enabling,
            selectionSource: enabling ? 'auto' : 'manual_deny',
          });
          changedCount += 1;
        } catch {
        }
      }
      toast.success(
        t(
          enabling
            ? 'aiHub.providersPage.batchEnableSuccess'
            : 'aiHub.providersPage.batchDisableSuccess',
          { count: changedCount }
        )
      );
      setSelectedIds(new Set());
    } finally {
      setBatchBusy(false);
    }
  };

  const handleBatchProbe = async () => {
    const selectedModels = visibleModels.filter(m => selectedIds.has(m.id));
    if (selectedModels.length === 0) return;
    const targetEndpointId = endpointId || selectedModels[0].providerEndpointId;
    if (!targetEndpointId) return;

    setBatchBusy(true);
    setProbeProgress({ done: 0, total: selectedModels.length });
    try {
      const result = await probeEndpointModels({
        endpointId: targetEndpointId,
        models: selectedModels.map(m => m.upstreamModelId),
        maxTokens: 1,
        budgetSeconds: 60,
        concurrency: 8,
        limit: 0,
      });

      if (!result.ok && !result.models) {
        toast.error(result.error || t('aiHub.providersPage.batchProbeFailed'));
        return;
      }

      const rows = result.models || [];
      const resultMap: Record<string, ModelProbeRow> = {};
      let okCount = 0;
      for (const row of rows) {
        resultMap[row.model] = row;
        if (row.ok) okCount += 1;
      }
      setProbeResults(prev => ({ ...prev, ...resultMap }));
      setProbeProgress({ done: rows.length, total: selectedModels.length });
      toast.success(
        t('aiHub.providersPage.batchProbeSuccess', { ok: okCount, total: selectedModels.length }),
      );
      setSelectedIds(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('aiHub.providersPage.batchProbeFailed'));
    } finally {
      setBatchBusy(false);
      setProbeProgress(null);
    }
  };

  const isActionsDisabled = busy || batchBusy;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 pb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          {t('aiHub.providersPage.tabModels')}
        </h3>
        <Badge size="sm" variant="slate">{models.length}</Badge>
        <span className="flex-1" />
        <Button
          type="button"
          variant="outline"
          size="xs"
          leftIcon={<RefreshCw size={12} className={discovering ? 'animate-spin' : undefined} />}
          onClick={onDiscover}
          disabled={busy || discovering || batchBusy}
        >
          {discovering ? t('aiHub.providersPage.discovering') : t('aiHub.providersPage.discover')}
        </Button>
      </div>

      {onAddModel && (
        <form
          className="flex shrink-0 items-center gap-2 pb-2"
          onSubmit={event => {
            event.preventDefault();
            void handleAddModel();
          }}
        >
          <Input
            aria-label={t('aiHub.providersPage.addModelPlaceholder')}
            value={modelIdInput}
            onChange={event => setModelIdInput(event.target.value)}
            placeholder={t('aiHub.providersPage.addModelPlaceholder')}
            className="w-56"
          />
          <Button
            type="submit"
            variant="outline"
            size="xs"
            leftIcon={addingModel ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            disabled={modelIdInput.trim() === '' || addingModel || busy || batchBusy}
          >
            {t('aiHub.providersPage.addModelAction')}
          </Button>
        </form>
      )}

      {selectedIds.size > 0 && (
        <div
          data-testid="selection-toolbar"
          className="mb-2 flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-indigo-500/20 bg-indigo-500/[0.06] px-3 py-2 text-xs text-indigo-300"
        >
          <span className="font-semibold text-white">
            {t('aiHub.providersPage.selectedCount', { count: selectedIds.size })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            leftIcon={<Globe size={12} />}
            onClick={() => void handleBatchPublish()}
            disabled={isActionsDisabled}
          >
            {t('aiHub.providersPage.batchPublish')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            leftIcon={<EyeOff size={12} />}
            onClick={() => void handleBatchDisable()}
            disabled={isActionsDisabled}
          >
            {selectedAllDisabled ? t('aiHub.providersPage.batchEnable') : t('aiHub.providersPage.batchDisable')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            leftIcon={
              probeProgress ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Radio size={12} />
              )
            }
            onClick={() => void handleBatchProbe()}
            disabled={isActionsDisabled}
          >
            {probeProgress
              ? t('aiHub.providersPage.batchProbeProgress', probeProgress)
              : t('aiHub.providersPage.batchProbe')}
          </Button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mb-2 flex shrink-0 items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 py-2 text-xs text-red-300"
        >
          <TriangleAlert size={14} className="shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="font-semibold">{t('aiHub.providersPage.discoveryFailed')}. </span>
            <span className="break-words">{error}</span>
            <span className="mt-1 block text-slate-400">
              {t('aiHub.providersPage.discoveryFailedHint')}
            </span>
          </span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            leftIcon={<RefreshCw size={12} />}
            onClick={onDiscover}
            disabled={busy || discovering || batchBusy}
          >
            {t('aiHub.providersPage.discover')}
          </Button>
        </div>
      )}

      {loading ? (
        <SkeletonLoader variant="table-row" count={3} />
      ) : models.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <EmptyState
            icon={Boxes}
            title={t('aiHub.providersPage.modelsEmpty')}
            description={t('aiHub.providersPage.modelsEmptyHint')}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-white/[0.06]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    aria-label={t('aiHub.providersPage.selectAll')}
                    checked={allVisibleSelected}
                    onChange={e => handleSelectAll(e.target.checked)}
                    disabled={visibleModels.length === 0 || isActionsDisabled}
                  />
                </TableHead>
                <TableHead>{t('aiHub.providersPage.modelId')}</TableHead>
                <TableHead>{t('aiHub.providersPage.modelDisplay')}</TableHead>
                <TableHead>{t('aiHub.providersPage.modelSource')}</TableHead>
                <TableHead className="w-20">{t('aiHub.providersPage.enabled')}</TableHead>
                {onExposeModel && <TableHead className="w-32" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleModels.map(model => {
                const probe = probeResults[model.upstreamModelId];
                return (
                  <TableRow key={model.id}>
                    <TableCell className="w-10">
                      <Checkbox
                        aria-label={`Select ${model.upstreamModelId}`}
                        checked={selectedIds.has(model.id)}
                        onChange={e => handleToggleSelect(model.id, e.target.checked)}
                        disabled={isActionsDisabled}
                      />
                    </TableCell>
                    <TableCell className="max-w-[240px] truncate font-mono text-slate-300">
                      <div className="flex items-center gap-2">
                        <span className="truncate" title={model.upstreamModelId}>{model.upstreamModelId}</span>
                        {probe && (
                          <Badge
                            size="sm"
                            variant={probe.ok ? 'success' : 'danger'}
                            title={probe.reason}
                          >
                            {probe.ok ? (
                              <>
                                <Check size={10} className="mr-0.5 inline shrink-0" />
                                {probe.latencyMs != null ? `${probe.latencyMs}ms` : 'ok'}
                              </>
                            ) : (
                              <>
                                <X size={10} className="mr-0.5 inline shrink-0" />
                                {probe.reason || 'err'}
                              </>
                            )}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate" title={model.displayName ?? undefined}>
                      {model.displayName || '—'}
                    </TableCell>
                    <TableCell className="text-slate-400">{model.discoverySource}</TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'inline-block h-2 w-2 rounded-full',
                          model.enabled ? 'bg-emerald-400' : 'bg-slate-600'
                        )}
                      />
                    </TableCell>
                    {onExposeModel && (
                      <TableCell>
                        {published?.[model.id] ? (
                          <Badge
                            size="sm"
                            variant="slate"
                            title={`${t('aiHub.providersPage.exposePublished')}: ${published[model.id]}`}
                          >
                            <Globe size={12} className="shrink-0 text-indigo-300" />
                            {published[model.id]}
                          </Badge>
                        ) : (
                          <ButtonBase
                            type="button"
                            onClick={() => onExposeModel(model)}
                            title={t('aiHub.providersPage.exposeHint')}
                            className="flex items-center gap-1.5 rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1 text-[11px] font-medium text-slate-300 transition-colors hover:bg-white/[0.05] hover:text-white"
                          >
                            <Globe size={12} className="shrink-0 text-indigo-300" />
                            {t('aiHub.providersPage.exposeModel')}
                          </ButtonBase>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {hiddenCount > 0 && (
            <div className="px-3 py-2 text-[11px] text-slate-500">
              {t('apiKeys.moreCount', { count: hiddenCount })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
