import { useState } from 'react';
import { Boxes, Globe, Loader2, Plus, RefreshCw, TriangleAlert } from 'lucide-react';
import type { UpstreamModel } from '@/lib/backend/modules/aiGateway';
import {
  Badge,
  Button,
  ButtonBase,
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
  models: UpstreamModel[];
  loading: boolean;
  busy: boolean;
  discovering: boolean;
  error?: string | null;
  onDiscover: () => void;
  onAddModel?: (modelId: string) => Promise<boolean>;
  onExposeModel?: (model: UpstreamModel) => void;
  published?: Record<string, string>;
}

const RENDER_CAP = 500;

export function ProviderModelsPanel(props: ProviderModelsPanelProps): JSX.Element {
  const { models, loading, busy, discovering, error, onDiscover, onAddModel, onExposeModel, published } = props;
  const [modelIdInput, setModelIdInput] = useState('');
  const [addingModel, setAddingModel] = useState(false);
  const visibleModels = models.slice(0, RENDER_CAP);
  const hiddenCount = models.length - visibleModels.length;

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
          disabled={busy || discovering}
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
            disabled={modelIdInput.trim() === '' || addingModel || busy}
          >
            {t('aiHub.providersPage.addModelAction')}
          </Button>
        </form>
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
            disabled={busy || discovering}
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
                <TableHead>{t('aiHub.providersPage.modelId')}</TableHead>
                <TableHead>{t('aiHub.providersPage.modelDisplay')}</TableHead>
                <TableHead>{t('aiHub.providersPage.modelSource')}</TableHead>
                <TableHead className="w-20">{t('aiHub.providersPage.enabled')}</TableHead>
                {onExposeModel && <TableHead className="w-32" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleModels.map(model => (
                <TableRow key={model.id}>
                  <TableCell className="max-w-[240px] truncate font-mono text-slate-300">
                    {model.upstreamModelId}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate">
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
              ))}
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
