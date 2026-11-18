import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowUpDown,
  Boxes,
  EyeOff,
  Globe,
  Loader2,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import type { ModelHealthRow, UpstreamModel } from '@/lib/backend/modules/aiGateway';
import {
  listModelHealth,
  listUpstreamModelsPage,
  probeEndpointModels,
} from '@/lib/backend/modules/aiGateway';
import { useAiGatewayStore } from '@/stores/aiGateway';
import {
  askConfirm,
  Badge,
  Button,
  ButtonBase,
  Checkbox,
  EmptyState,
  FilterDropdown,
  Input,
  OverflowMenu,
  SegmentedControl,
  SkeletonLoader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Toggle,
  Tooltip,
} from '@/components/ui';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

export interface PublishedModelRef {
  publicModelId: string;
  enabled: boolean;
}

export interface ProviderModelsPanelProps {
  endpointId?: string;
  busy: boolean;
  discovering: boolean;
  error?: string | null;
  onDiscover: () => void;
  onAddModel?: (modelId: string) => Promise<boolean>;
  onExposeModel?: (model: UpstreamModel) => void;
  published?: Record<string, PublishedModelRef>;
  onPublishedChange?: () => void;
}

type Segment = 'live' | 'all';
type SortKey = 'last_seen' | 'id' | 'display_name';

const LIVE_WINDOW_MINUTES = 120;
const SEARCH_DEBOUNCE_MS = 300;

const MODEL_CLASSES = ['chat', 'vision', 'image', 'video', 'audio', 'embed', 'rerank', '3d'] as const;
type ModelClass = (typeof MODEL_CLASSES)[number];

const CLASS_LABEL_KEY: Record<ModelClass, string> = {
  chat: 'aiHub.providersPage.classChat',
  vision: 'aiHub.providersPage.classVision',
  image: 'aiHub.providersPage.classImage',
  video: 'aiHub.providersPage.classVideo',
  audio: 'aiHub.providersPage.classAudio',
  embed: 'aiHub.providersPage.classEmbed',
  rerank: 'aiHub.providersPage.classRerank',
  '3d': 'aiHub.providersPage.class3d',
};

const SOURCE_LABEL_KEY: Record<string, string> = {
  probe: 'aiHub.providersPage.sourceProbe',
  manual: 'aiHub.providersPage.sourceManual',
  opencode_import: 'aiHub.providersPage.sourceOpencodeImport',
  autoreg_hook: 'aiHub.providersPage.sourceAutoregHook',
};

const HEALTH_DOT: Record<string, string> = {
  usable: 'bg-emerald-400',
  alive: 'bg-amber-400',
  down: 'bg-red-400',
  unchecked: 'bg-slate-600',
};

function modelClassOf(model: UpstreamModel): ModelClass {
  const raw = model.capabilities?.model_class;
  if (typeof raw === 'string') {
    const found = MODEL_CLASSES.find(cls => cls === raw);
    if (found) return found;
  }
  return 'chat';
}

function vendorOf(model: UpstreamModel): string | null {
  const raw = model.capabilities?.vendor;
  return typeof raw === 'string' && raw.trim() !== '' ? raw : null;
}

function isFreeModel(model: UpstreamModel): boolean {
  if (model.upstreamModelId.endsWith(':free')) return true;
  const groups = model.capabilities?.groups;
  return Array.isArray(groups) && groups.includes('free');
}

function numberCapability(model: UpstreamModel, key: string): number | null {
  const raw = model.capabilities?.[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function sourceLabel(source: string): string {
  const key = SOURCE_LABEL_KEY[source];
  return key ? t(key) : source;
}

function formatVerifiedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

interface HealthView {
  state: 'usable' | 'alive' | 'down' | 'unchecked';
  latencyMs: number | null;
  tooltip: string;
}

function healthView(row: ModelHealthRow | undefined): HealthView {
  if (!row || (row.status === 'unknown' && !row.lastVerifiedAt)) {
    return { state: 'unchecked', latencyMs: null, tooltip: t('aiHub.providersPage.healthNotChecked') };
  }
  const state = row.usable ? 'usable' : row.alive ? 'alive' : 'down';
  const parts = [row.reason];
  if (row.lastVerifiedAt) {
    parts.push(t('aiHub.providersPage.healthCheckedAt', { at: formatVerifiedAt(row.lastVerifiedAt) }));
  }
  return { state, latencyMs: row.latencyMs ?? null, tooltip: parts.join(' · ') };
}

function chipClass(active: boolean): string {
  return cn(
    'inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium transition-colors',
    active
      ? 'border-indigo-500/35 bg-indigo-500/12 text-indigo-200'
      : 'border-white/10 bg-white/[0.02] text-slate-400 hover:bg-white/5 hover:text-slate-200'
  );
}

export function ProviderModelsPanel(props: ProviderModelsPanelProps): JSX.Element {
  const {
    endpointId,
    busy,
    discovering,
    error,
    onDiscover,
    onAddModel,
    onExposeModel,
    published,
    onPublishedChange,
  } = props;

  const storeModels = useAiGatewayStore(state => state.upstreamModels);
  const createPublicModel = useAiGatewayStore(state => state.createPublicModel);
  const createRouteTarget = useAiGatewayStore(state => state.createRouteTarget);
  const updateUpstreamModel = useAiGatewayStore(state => state.updateUpstreamModel);
  const updatePublicModel = useAiGatewayStore(state => state.updatePublicModel);
  const deletePublicModel = useAiGatewayStore(state => state.deletePublicModel);

  const [segment, setSegment] = useState<Segment>('live');
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [orderBy, setOrderBy] = useState<SortKey>('last_seen');
  const [classes, setClasses] = useState<Set<ModelClass>>(() => new Set<ModelClass>(['chat', 'vision']));
  const [vendor, setVendor] = useState('');
  const [freeOnly, setFreeOnly] = useState(false);
  const [publishedOnly, setPublishedOnly] = useState(false);
  const [problemsOnly, setProblemsOnly] = useState(false);

  const [rows, setRows] = useState<UpstreamModel[]>([]);
  const [total, setTotal] = useState(0);
  const [liveTotal, setLiveTotal] = useState(0);
  const [allTotal, setAllTotal] = useState(0);
  const [health, setHealth] = useState<Record<string, ModelHealthRow>>({});
  const [loading, setLoading] = useState(true);

  const [modelIdInput, setModelIdInput] = useState('');
  const [addingModel, setAddingModel] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [probeProgress, setProbeProgress] = useState<{ done: number; total: number } | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    const handle = window.setTimeout(() => setQuery(queryInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [queryInput]);

  const loadHealth = useCallback(async () => {
    if (!endpointId) return;
    try {
      const page = await listModelHealth({ endpointId, limit: 0 });
      const map: Record<string, ModelHealthRow> = {};
      for (const row of page.models) map[row.model] = row;
      setHealth(map);
    } catch {
      setHealth({});
    }
  }, [endpointId]);

  useEffect(() => {
    if (!endpointId) return;
    const seq = ++requestSeq.current;
    const q = query === '' ? undefined : query;
    const alive = segment === 'live' ? LIVE_WINDOW_MINUTES : undefined;
    const otherAlive = segment === 'live' ? undefined : LIVE_WINDOW_MINUTES;
    void (async () => {
      await Promise.resolve();
      if (seq !== requestSeq.current) return;
      setLoading(true);
      try {
        const [page, otherPage] = await Promise.all([
          listUpstreamModelsPage(endpointId, { q, aliveWithinMinutes: alive, orderBy, limit: 0 }),
          listUpstreamModelsPage(endpointId, { q, aliveWithinMinutes: otherAlive, limit: 1 }),
        ]);
        if (seq !== requestSeq.current) return;
        setRows(page.models);
        setTotal(page.total);
        if (segment === 'live') {
          setLiveTotal(page.total);
          setAllTotal(otherPage.total);
        } else {
          setAllTotal(page.total);
          setLiveTotal(otherPage.total);
        }
      } catch {
        if (seq !== requestSeq.current) return;
        setRows([]);
        setTotal(0);
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
      try {
        const healthPage = await listModelHealth({ endpointId, limit: 0 });
        if (seq !== requestSeq.current) return;
        const map: Record<string, ModelHealthRow> = {};
        for (const row of healthPage.models) map[row.model] = row;
        setHealth(map);
      } catch {
        if (seq !== requestSeq.current) return;
        setHealth({});
      }
    })();
  }, [endpointId, segment, query, orderBy, storeModels]);

  const vendors = useMemo(() => {
    const set = new Set<string>();
    for (const model of rows) {
      const value = vendorOf(model);
      if (value) set.add(value);
    }
    return Array.from(set).sort();
  }, [rows]);

  const classCounts = useMemo(() => {
    const counts = new Map<ModelClass, number>();
    for (const model of rows) {
      const cls = modelClassOf(model);
      counts.set(cls, (counts.get(cls) ?? 0) + 1);
    }
    return counts;
  }, [rows]);

  const filteredRows = useMemo(
    () =>
      rows.filter(model => {
        if (!classes.has(modelClassOf(model))) return false;
        if (vendor !== '' && vendorOf(model) !== vendor) return false;
        if (freeOnly && !isFreeModel(model)) return false;
        if (publishedOnly && !published?.[model.id]?.enabled) return false;
        if (problemsOnly) {
          const row = health[model.upstreamModelId];
          if (!row || row.alive || row.status === 'unknown') return false;
        }
        return true;
      }),
    [rows, classes, vendor, freeOnly, publishedOnly, problemsOnly, published, health]
  );

  const selectedRows = useMemo(
    () => filteredRows.filter(model => selectedIds.has(model.id)),
    [filteredRows, selectedIds]
  );
  const selectedCount = selectedRows.length;
  const allVisibleSelected = filteredRows.length > 0 && selectedCount === filteredRows.length;

  const handleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(filteredRows.map(model => model.id)) : new Set());
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

  const handleToggleEnabled = async (model: UpstreamModel, enabled: boolean) => {
    setRows(prev => prev.map(m => (m.id === model.id ? { ...m, enabled } : m)));
    try {
      await updateUpstreamModel({
        id: model.id,
        enabled,
        selectionSource: enabled ? 'manual_allow' : 'manual_deny',
      });
    } catch (e) {
      setRows(prev => prev.map(m => (m.id === model.id ? { ...m, enabled: model.enabled } : m)));
      toast.error(e instanceof Error ? e.message : t('aiHub.providersPage.toggleFailed'));
    }
  };

  const handleTogglePublished = async (model: UpstreamModel, enabled: boolean) => {
    const ref = published?.[model.id];
    if (!ref) return;
    try {
      await updatePublicModel({ id: ref.publicModelId, enabled });
      onPublishedChange?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('aiHub.providersPage.publishFailed'));
    }
  };

  const handleRemoveAlias = async (model: UpstreamModel) => {
    const ref = published?.[model.id];
    if (!ref) return;
    const ok = await askConfirm({
      title: t('aiHub.providersPage.removeAlias'),
      message: t('aiHub.providersPage.removeAliasConfirm', { name: ref.publicModelId }),
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deletePublicModel(ref.publicModelId);
      toast.success(t('aiHub.providersPage.aliasRemoved'));
      onPublishedChange?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('aiHub.providersPage.publishFailed'));
    }
  };

  const handleBatchPublish = async () => {
    const targets = selectedRows.filter(model => !published?.[model.id]);
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
          continue;
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
    selectedRows.length > 0 && selectedRows.every(model => !model.enabled);

  const handleBatchDisable = async () => {
    if (selectedRows.length === 0) return;
    const enabling = selectedAllDisabled;
    const targets = selectedRows.filter(model => (enabling ? !model.enabled : model.enabled));
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
          continue;
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
    if (selectedRows.length === 0) return;
    const targetEndpointId = endpointId || selectedRows[0].providerEndpointId;
    if (!targetEndpointId) return;

    setBatchBusy(true);
    setProbeProgress({ done: 0, total: selectedRows.length });
    try {
      const result = await probeEndpointModels({
        endpointId: targetEndpointId,
        models: selectedRows.map(model => model.upstreamModelId),
        maxTokens: 1,
        budgetSeconds: 60,
        concurrency: 8,
        limit: 0,
      });

      if (!result.ok && !result.models) {
        toast.error(result.error || t('aiHub.providersPage.batchProbeFailed'));
        return;
      }

      const probedRows = result.models || [];
      let okCount = 0;
      for (const row of probedRows) {
        if (row.ok) okCount += 1;
      }
      setProbeProgress({ done: probedRows.length, total: selectedRows.length });
      toast.success(
        t('aiHub.providersPage.batchProbeSuccess', { ok: okCount, total: selectedRows.length })
      );
      setSelectedIds(new Set());
      await loadHealth();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('aiHub.providersPage.batchProbeFailed'));
    } finally {
      setBatchBusy(false);
      setProbeProgress(null);
    }
  };

  const isActionsDisabled = busy || batchBusy;

  const sortOptions = [
    { value: 'last_seen', label: t('aiHub.providersPage.sortLastSeen') },
    { value: 'id', label: t('aiHub.providersPage.sortId') },
    { value: 'display_name', label: t('aiHub.providersPage.sortDisplayName') },
  ];

  const vendorOptions = [
    { value: '', label: t('aiHub.providersPage.vendorAll') },
    ...vendors.map(value => ({ value, label: value })),
  ];

  const toggleClass = (cls: ModelClass) => {
    setClasses(prev => {
      const next = new Set(prev);
      if (next.has(cls)) {
        next.delete(cls);
      } else {
        next.add(cls);
      }
      return next;
    });
  };

  const renderEmpty = () => {
    if (query !== '') {
      return (
        <EmptyState
          icon={Search}
          title={t('aiHub.providersPage.modelsNoMatch', { query })}
          description={t('aiHub.providersPage.modelsNoMatchHint')}
        />
      );
    }
    if (total === 0) {
      if (segment === 'live' && allTotal > 0) {
        return (
          <EmptyState
            icon={Radio}
            title={t('aiHub.providersPage.liveEmpty')}
            description={t('aiHub.providersPage.liveEmptyHint')}
          />
        );
      }
      return (
        <EmptyState
          icon={Boxes}
          title={t('aiHub.providersPage.modelsEmpty')}
          description={t('aiHub.providersPage.modelsEmptyHint')}
        />
      );
    }
    return (
      <EmptyState
        icon={Search}
        title={t('aiHub.providersPage.modelsFilteredEmpty')}
        description={t('aiHub.providersPage.modelsFilteredEmptyHint')}
      />
    );
  };

  if (!endpointId) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <EmptyState
            icon={Boxes}
            title={t('aiHub.providersPage.modelsEmpty')}
            description={t('aiHub.providersPage.modelsEmptyHint')}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 pb-2">
        <Input
          aria-label={t('aiHub.providersPage.searchModels')}
          value={queryInput}
          onChange={event => setQueryInput(event.target.value)}
          placeholder={t('aiHub.providersPage.searchModels')}
          leftIcon={<Search size={12} />}
          className="min-w-[180px] flex-1"
        />
        <SegmentedControl
          size="sm"
          stretch={false}
          value={segment}
          onChange={value => setSegment(value === 'all' ? 'all' : 'live')}
          options={[
            {
              value: 'live',
              label: `${t('aiHub.providersPage.segmentLive')} (${liveTotal})`,
              tooltip: t('aiHub.providersPage.segmentLiveHint'),
            },
            {
              value: 'all',
              label: `${t('aiHub.providersPage.segmentAll')} (${allTotal})`,
            },
          ]}
        />
        <FilterDropdown
          value={orderBy}
          onChange={value =>
            setOrderBy(value === 'id' || value === 'display_name' ? value : 'last_seen')
          }
          options={sortOptions}
          icon={<ArrowUpDown size={12} />}
        />
        <span className="shrink-0 text-xs tabular-nums text-slate-500">
          {t('aiHub.providersPage.modelsFound', { shown: filteredRows.length, total })}
        </span>
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="ml-auto shrink-0 text-xs"
          leftIcon={<RefreshCw size={12} className={discovering ? 'animate-spin' : undefined} />}
          onClick={onDiscover}
          disabled={busy || discovering || batchBusy}
        >
          {discovering ? t('aiHub.providersPage.discovering') : t('aiHub.providersPage.discover')}
        </Button>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 pb-2">
        {MODEL_CLASSES.map(cls => {
          const active = classes.has(cls);
          const count = classCounts.get(cls) ?? 0;
          return (
            <ButtonBase
              key={cls}
              type="button"
              aria-pressed={active}
              onClick={() => toggleClass(cls)}
              className={chipClass(active)}
            >
              {t(CLASS_LABEL_KEY[cls])}
              {count > 0 && <span className="tabular-nums opacity-70">{count}</span>}
            </ButtonBase>
          );
        })}
        <span className="mx-0.5 h-4 w-px bg-white/10" aria-hidden="true" />
        <FilterDropdown
          value={vendor}
          onChange={setVendor}
          options={vendorOptions}
          placeholder={t('aiHub.providersPage.vendorFilter')}
          showActiveState
          triggerClassName="h-7 text-xs"
        />
        <ButtonBase
          type="button"
          aria-pressed={freeOnly}
          onClick={() => setFreeOnly(prev => !prev)}
          className={chipClass(freeOnly)}
        >
          {t('aiHub.providersPage.freeOnly')}
        </ButtonBase>
        <ButtonBase
          type="button"
          aria-pressed={publishedOnly}
          onClick={() => setPublishedOnly(prev => !prev)}
          className={chipClass(publishedOnly)}
        >
          {t('aiHub.providersPage.publishedOnly')}
        </ButtonBase>
        <ButtonBase
          type="button"
          aria-pressed={problemsOnly}
          onClick={() => setProblemsOnly(prev => !prev)}
          className={chipClass(problemsOnly)}
        >
          {t('aiHub.providersPage.problemsOnly')}
        </ButtonBase>
        {onAddModel && (
          <form
            className="ml-auto flex items-center gap-1.5"
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
              className="w-44"
            />
            <Button
              type="submit"
              variant="outline"
              size="sm"
              className="px-2 text-xs"
              aria-label={t('aiHub.providersPage.addModelAction')}
              title={t('aiHub.providersPage.addModelAction')}
              leftIcon={addingModel ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              disabled={modelIdInput.trim() === '' || addingModel || busy || batchBusy}
            />
          </form>
        )}
      </div>

      {selectedCount > 0 && (
        <div
          data-testid="selection-toolbar"
          className="mb-2 flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-indigo-500/20 bg-indigo-500/[0.06] px-3 py-2 text-xs text-indigo-300"
        >
          <span className="font-semibold text-white">
            {t('aiHub.providersPage.selectedOnPage', { count: selectedCount })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="text-xs"
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
            className="text-xs"
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
            className="text-xs"
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
            className="shrink-0 text-xs"
            leftIcon={<RefreshCw size={12} />}
            onClick={onDiscover}
            disabled={busy || discovering || batchBusy}
          >
            {t('aiHub.providersPage.discover')}
          </Button>
        </div>
      )}

      {loading && rows.length === 0 ? (
        <SkeletonLoader variant="table-row" count={5} />
      ) : filteredRows.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">{renderEmpty()}</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-white/[0.06]">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-vsc-panel-solid">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10">
                  <Checkbox
                    aria-label={t('aiHub.providersPage.selectAllPage')}
                    checked={allVisibleSelected}
                    onChange={e => handleSelectAll(e.target.checked)}
                    disabled={filteredRows.length === 0 || isActionsDisabled}
                  />
                </TableHead>
                <TableHead className="text-xs">{t('aiHub.providersPage.modelId')}</TableHead>
                <TableHead className="text-xs">{t('aiHub.providersPage.colClass')}</TableHead>
                <TableHead className="w-32 text-right text-xs">{t('aiHub.providersPage.colPricing')}</TableHead>
                <TableHead className="w-28 text-xs">{t('aiHub.providersPage.colHealth')}</TableHead>
                <TableHead className="w-16 text-xs">{t('aiHub.providersPage.enabled')}</TableHead>
                <TableHead className="w-24 text-xs">{t('aiHub.providersPage.colPublish')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.map(model => {
                const cls = modelClassOf(model);
                const vendorName = vendorOf(model);
                const quotaType = numberCapability(model, 'quota_type');
                const price = numberCapability(model, 'model_price');
                const ratio = numberCapability(model, 'model_ratio');
                const completionRatio = numberCapability(model, 'completion_ratio');
                const view = healthView(health[model.upstreamModelId]);
                const ref = published?.[model.id];
                const displayName = model.displayName || model.upstreamModelId;
                return (
                  <TableRow key={model.id} className="hover:bg-white/[0.02]">
                    <TableCell className="w-10">
                      <Checkbox
                        aria-label={t('aiHub.providersPage.selectModelAria', { model: model.upstreamModelId })}
                        checked={selectedIds.has(model.id)}
                        onChange={e => handleToggleSelect(model.id, e.target.checked)}
                        disabled={isActionsDisabled}
                      />
                    </TableCell>
                    <TableCell className="max-w-[280px]">
                      <div className="truncate text-xs font-medium text-slate-200" title={displayName}>
                        {displayName}
                      </div>
                      <div className="truncate font-mono text-[11px] text-slate-500" title={model.upstreamModelId}>
                        {model.upstreamModelId}
                        <span className="ml-1.5 font-sans text-slate-600">
                          · {sourceLabel(model.discoverySource)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge size="sm" variant="slate">{t(CLASS_LABEL_KEY[cls])}</Badge>
                        {vendorName && <Badge size="sm" variant="outline">{vendorName}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {quotaType === 1 ? (
                        <Tooltip content={t('aiHub.providersPage.priceTooltip')}>
                          <Badge size="sm" variant="warning">
                            {t('aiHub.providersPage.perCall')}
                            {price != null ? ` · $${price.toFixed(2)}` : ''}
                          </Badge>
                        </Tooltip>
                      ) : ratio != null || completionRatio != null ? (
                        <Tooltip content={t('aiHub.providersPage.ratioTooltip')}>
                          <span className="font-mono text-xs tabular-nums text-slate-300">
                            {ratio != null ? `$${ratio.toFixed(2)}` : '—'} / {completionRatio != null ? `$${completionRatio.toFixed(2)}` : '—'}
                          </span>
                        </Tooltip>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Tooltip content={view.tooltip}>
                        <span className="inline-flex items-center gap-1.5 text-xs tabular-nums text-slate-400">
                          <span className={cn('h-2 w-2 shrink-0 rounded-full', HEALTH_DOT[view.state])} />
                          {view.state === 'unchecked'
                            ? t('aiHub.providersPage.healthNotChecked')
                            : view.latencyMs != null
                              ? `${view.latencyMs}ms`
                              : t(`aiHub.providersPage.healthState.${view.state}`)}
                        </span>
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <Toggle
                        size="sm"
                        label=""
                        ariaLabel={t('aiHub.providersPage.enableToggleAria', { model: model.upstreamModelId })}
                        checked={model.enabled}
                        onChange={value => void handleToggleEnabled(model, value)}
                        disabled={isActionsDisabled}
                      />
                    </TableCell>
                    <TableCell>
                      {ref ? (
                        <div className="flex items-center gap-1.5">
                          <Toggle
                            size="sm"
                            label=""
                            ariaLabel={t('aiHub.providersPage.publishToggleAria', { model: ref.publicModelId })}
                            checked={ref.enabled}
                            tooltip={ref.enabled ? t('aiHub.providersPage.publishedTooltip') : t('aiHub.providersPage.publishHint')}
                            onChange={value => void handleTogglePublished(model, value)}
                            disabled={isActionsDisabled}
                          />
                          <span
                            className="max-w-[160px] truncate font-mono text-[11px] text-indigo-300"
                            title={ref.publicModelId}
                          >
                            {ref.publicModelId}
                          </span>
                          <OverflowMenu
                            size="sm"
                            triggerLabel={t('aiHub.providersPage.removeAlias')}
                            items={[
                              {
                                id: 'remove-alias',
                                label: t('aiHub.providersPage.removeAlias'),
                                icon: <Trash2 size={12} />,
                                tone: 'danger',
                                onSelect: () => void handleRemoveAlias(model),
                              },
                            ]}
                          />
                        </div>
                      ) : onExposeModel ? (
                        <ButtonBase
                          type="button"
                          onClick={() => onExposeModel(model)}
                          aria-label={t('aiHub.providersPage.publishModel')}
                          title={t('aiHub.providersPage.publishModel')}
                          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/[0.04] hover:text-indigo-300"
                        >
                          <Globe size={14} className="shrink-0" />
                        </ButtonBase>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}