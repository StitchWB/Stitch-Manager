import { Archive, Heart, Lock } from 'lucide-react';
import { Badge, ListHeaderRow } from '@/components/ui';
import { TierBadge } from '@/components/ui/TierBadge';
import type { ScenarioRecordItem } from '@/lib/backend/modules/pythonJobs';
import { t } from '@/lib/i18n';
import { ScenarioItemActions } from './ScenarioItemActions';
import { formatDateTime, formatLastPlayed, healthVariant, safeMeta } from './scenarioMeta';

type ScenarioActionHandlers = {
  duplicateLoading: boolean;
  pendingDeleteId: string | null;
  deleteLoadingId: string | null;
  onHowToGet: (item: ScenarioRecordItem) => void;
  onToggleFavorite: (item: ScenarioRecordItem) => void;
  onEdit: (item: ScenarioRecordItem) => void;
  onDuplicate: (item: ScenarioRecordItem) => void;
  onOpenHistory: (item: ScenarioRecordItem) => void;
  onDeleteClick: (item: ScenarioRecordItem) => void;
};

type ScenarioListProps = ScenarioActionHandlers & {
  loading: boolean;
  error: string | null;
  itemsCount: number;
  filtered: ScenarioRecordItem[];
  viewMode: string;
  onReplay: (scenarioPath?: string) => void;
};

function ScenarioListRow({
  item,
  onReplay,
  actions
}: {
  item: ScenarioRecordItem;
  onReplay: (scenarioPath?: string) => void;
  actions: ScenarioActionHandlers;
}) {
  const meta = safeMeta(item.metadata);
  const isLocked = item.locked === true;
  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2 hover:bg-white/[0.04]${isLocked ? ' opacity-50' : ''}`}>

      <div
        className={`min-w-0 text-left ${isLocked ? 'cursor-not-allowed' : 'cursor-pointer'}`}
        onClick={() => { if (!isLocked) onReplay(item.scenarioPath); }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (!isLocked && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onReplay(item.scenarioPath); }}}
        title={item.name}>

        <div className="flex items-center gap-2 min-w-0">
          <div className="text-sm text-slate-100 font-semibold truncate min-w-0">
            {item.name}
          </div>
          {item.favorite ? <Heart size={14} className="text-pink-300" /> : null}
          {item.missing ?
          <Badge variant="warning" size="sm" className="normal-case">
              {t('scenarios.missingFile')}
            </Badge> :
          null}
          {isLocked ? <Lock size={14} className="text-amber-400 shrink-0" /> : null}
          {isLocked && item.min_role ?
          <TierBadge tier={item.min_role} size="sm" /> :
          null}
        </div>
        <div
          className="mt-1 text-[11px] text-slate-500 font-mono truncate"
          title={item.scenarioPath}>

          {item.scenarioPath}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          <span>
            {item.stepsCount} {t('scenarios.stepsCount')}
          </span>
          <span>•</span>
          <span>
            {t('scenarios.playCount')}: {item.playCount}
          </span>
          <span>•</span>
          <span>
            {t('scenarios.lastPlayed')}: {formatLastPlayed(item.lastPlayedAt)}
          </span>
          {meta.lastStatus ?
          <>
              <span>•</span>
              <span>
                {t('scenarios.lastStatus')}: {meta.lastStatus}
              </span>
            </> :
          null}
        </div>
      </div>

      <ScenarioItemActions item={item} isLocked={isLocked} view="list" {...actions} />
    </div>);

}

function ScenarioCard({
  item,
  viewMode,
  onReplay,
  actions
}: {
  item: ScenarioRecordItem;
  viewMode: string;
  onReplay: (scenarioPath?: string) => void;
  actions: ScenarioActionHandlers;
}) {
  const meta = safeMeta(item.metadata);
  const isLocked = item.locked === true;
  return (
    <div
      className={`rounded-xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.04] transition-colors ${
      viewMode === 'cards' ? 'px-4 py-3' : 'px-3 py-2'}${isLocked ? ' opacity-50' : ''}`
      }>

      <div
        className={`flex ${
        viewMode === 'cards' ?
        'flex-col gap-3 sm:flex-row sm:items-start sm:justify-between' :
        'flex-col gap-2 lg:flex-row lg:items-center lg:justify-between'}`
        }>

        <div
          className={`min-w-0 flex-1 text-left ${isLocked ? 'cursor-not-allowed' : 'cursor-pointer'}`}
          onClick={() => { if (!isLocked) onReplay(item.scenarioPath); }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (!isLocked && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onReplay(item.scenarioPath); }}}
          title={item.name}>

          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <div className="text-sm text-slate-100 font-semibold truncate min-w-0">
              {item.name}
            </div>
            {item.favorite ? <Heart size={14} className="text-pink-300" /> : null}
            {item.missing ?
            <Badge variant="warning" size="sm" className="normal-case">
                {t('scenarios.missingFile')}
              </Badge> :
            null}
            {isLocked ? <Lock size={14} className="text-amber-400 shrink-0" /> : null}
            {isLocked && item.min_role ?
            <TierBadge tier={item.min_role} size="sm" /> :
            null}
          </div>
          <div
            className="mt-1 text-[11px] text-slate-500 font-mono truncate"
            title={item.scenarioPath}>

            {item.scenarioPath}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span className="text-slate-400">
              {t('accounts.created')}{' '}
              <span className="text-slate-300 tabular-nums">
                {formatDateTime(item.createdAt)}
              </span>
            </span>
            <span className="text-slate-600">•</span>
            <span className="text-slate-400">
              {t('logs.lastUpdated')}{' '}
              <span className="text-slate-300 tabular-nums">
                {formatDateTime(item.updatedAt)}
              </span>
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge variant="outline" size="sm" className="normal-case">
              {item.stepsCount} {t('scenarios.stepsCount')}
            </Badge>
            <Badge variant="outline" size="sm" className="normal-case">
              {t('scenarios.playCount')}: {item.playCount}
            </Badge>
            <Badge variant="outline" size="sm" className="normal-case">
              {t('scenarios.lastPlayed')}: {formatLastPlayed(item.lastPlayedAt)}
            </Badge>
            {item.healthScore != null ?
            <Badge
              variant={healthVariant(item.healthScore)}
              size="sm"
              className="normal-case">

                {t('scenarios.healthScore')}: {item.healthScore}
              </Badge> :
            null}
            {meta.lastStatus ?
            <Badge variant="info" size="sm" className="normal-case">
                {t('scenarios.lastStatus')}: {meta.lastStatus}
              </Badge> :
            null}
            {meta.lastDurationMs != null ?
            <Badge variant="outline" size="sm" className="normal-case">
                {t('scenarios.lastDurationValue', { duration: Math.round(meta.lastDurationMs / 100) / 10 })}
              </Badge> :
            null}
          </div>
          {meta.tags.length && viewMode === 'cards' ?
          <div className="mt-3 flex flex-wrap gap-1.5">
              {meta.tags.slice(0, 6).map((tag) =>
            <Badge key={tag} variant="default" size="sm" className="normal-case">
                  {tag}
                </Badge>
            )}
              {meta.tags.length > 6 ?
            <Badge variant="outline" size="sm" className="normal-case">
                  +{meta.tags.length - 6}
                </Badge> :
            null}
            </div> :
          null}
          {meta.description && viewMode === 'cards' ?
          <div className="mt-3 text-xs text-slate-400 whitespace-pre-wrap break-words">
              {meta.description}
            </div> :
          null}
        </div>

        <ScenarioItemActions item={item} isLocked={isLocked} view="cards" {...actions} />
      </div>
    </div>);

}

export function ScenarioList({
  loading,
  error,
  itemsCount,
  filtered,
  viewMode,
  onReplay,
  ...actions
}: ScenarioListProps) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/25 p-3">
      {loading ?
      <div className="text-xs text-slate-500">{t('common.loading')}</div> :
      error ?
      <div className="text-xs text-amber-300">{error}</div> :
      itemsCount === 0 ?
      <div className="flex items-center gap-2 text-xs text-slate-500">
          <Archive size={14} /> {t('scenarios.noScenarios')}
        </div> :

      <div className="max-h-[60vh] overflow-y-auto overflow-x-hidden space-y-3 pr-1">
          {filtered.length === 0 ?
        <div className="text-xs text-slate-500">{t('common.none')}</div> :
        viewMode === 'list' ?
        <div className="rounded-lg border border-white/10 overflow-hidden">
              <ListHeaderRow className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
                <div>{t('common.name')}</div>
                <div className="text-right">{t('common.actions')}</div>
              </ListHeaderRow>
              <div className="divide-y divide-white/10">
                {filtered.map((item) =>
            <ScenarioListRow key={item.id} item={item} onReplay={onReplay} actions={actions} />
            )}
              </div>
            </div> :

        filtered.map((item) =>
        <ScenarioCard key={item.id} item={item} viewMode={viewMode} onReplay={onReplay} actions={actions} />
        )
        }
        </div>
      }
    </div>);

}
