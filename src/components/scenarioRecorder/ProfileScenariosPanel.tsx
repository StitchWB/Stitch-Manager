import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Copy,
  Heart,
  Pencil,
  PlayCircle,
  PlusCircle,
  RefreshCw,
  Repeat2,
  FolderOpen,
  Tag,
} from 'lucide-react';
import {
  Modal,
  Button,
  Input,
  Textarea,
  Badge,
  MultiFilterDropdown,
  ConfirmDialog,
  IconButton,
} from '@/components/ui';
import {
  listRecordedScenarios,
  setRecordedScenarioFavorite,
  updateRecordedScenario,
  duplicateRecordedScenario,
  listScenarioRevisions,
  rollbackRecordedScenario,
  type ScenarioMetadata,
  type ScenarioRevisionItem,
  type ScenarioRecordItem,
} from '@/lib/tauri/modules/pythonJobs';
import { openInFileManager, copyToClipboard } from '@/lib/tauri/modules/utils';
import { t } from '@/lib/i18n';
import { toast } from 'sonner';
import { formatProfileAlias } from '@/lib/profiles/displayName';

type ProfileScenariosPanelProps = {
  alias: string | null;
  isOpen: boolean;
  onClose: () => void;
  onRecord: () => void;
  onReplay: (scenarioPath?: string) => void;
  onComposeFlow?: () => void;
  variant?: 'modal' | 'panel';
};

export function ProfileScenariosPanel({
  alias,
  isOpen,
  onClose,
  onRecord,
  onReplay,
  onComposeFlow,
  variant = 'modal',
}: ProfileScenariosPanelProps) {
  const displayAlias = formatProfileAlias(alias);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ScenarioRecordItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editItem, setEditItem] = useState<ScenarioRecordItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editTagsText, setEditTagsText] = useState('');
  const [duplicateConfirmOpen, setDuplicateConfirmOpen] = useState(false);
  const [duplicateLoading, setDuplicateLoading] = useState(false);
  const [duplicateTarget, setDuplicateTarget] = useState<ScenarioRecordItem | null>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyItem, setHistoryItem] = useState<ScenarioRecordItem | null>(null);
  const [revisions, setRevisions] = useState<ScenarioRevisionItem[]>([]);
  const [rollbackLoading, setRollbackLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !alias) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const next = await listRecordedScenarios({ alias, limit: 50 });
        if (!cancelled) setItems(next);
      } catch (e) {
        if (!cancelled) {
          setItems([]);
          setError(e instanceof Error ? e.message : 'Failed to load scenarios');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [alias, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setFavoritesOnly(false);
      setSelectedTags([]);
      setEditOpen(false);
      setEditItem(null);
      setDuplicateConfirmOpen(false);
      setDuplicateTarget(null);
      setHistoryOpen(false);
      setHistoryItem(null);
      setRevisions([]);
    }
  }, [isOpen]);

  const parseTagsFromText = useCallback((raw: string): string[] => {
    const parts = raw
      .split(',')
      .map(p => p.trim())
      .filter(Boolean);
    const normalized = parts.map(p => p.toLowerCase());
    return Array.from(new Set(normalized));
  }, []);

  const toTagLabel = useCallback((tag: string) => tag.trim().toLowerCase(), []);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      const tags = item.metadata?.tags ?? [];
      for (const tag of tags) {
        const t = toTagLabel(tag);
        if (t) set.add(t);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items, toTagLabel]);

  const tagOptions = useMemo(
    () =>
      allTags.map(tag => ({
        value: tag,
        label: tag,
      })),
    [allTags]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter(item => (favoritesOnly ? item.favorite : true))
      .filter(item => {
        if (selectedTags.length === 0) return true;
        const tags = (item.metadata?.tags ?? []).map(toTagLabel);
        return selectedTags.every(t => tags.includes(t));
      })
      .filter(item => {
        if (!q) return true;
        const tags = (item.metadata?.tags ?? []).join(', ');
        return (
          item.name.toLowerCase().includes(q) ||
          item.scenarioPath.toLowerCase().includes(q) ||
          (item.startedUrl ?? '').toLowerCase().includes(q) ||
          tags.toLowerCase().includes(q)
        );
      });
  }, [favoritesOnly, items, query, selectedTags, toTagLabel]);

  const formatLastPlayed = useCallback((value?: string | null) => {
    if (!value) return '—';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return value;
    return dt.toLocaleString();
  }, []);

  const healthVariant = useCallback((score?: number | null) => {
    if (score == null) return 'outline' as const;
    if (score >= 85) return 'success' as const;
    if (score >= 60) return 'warning' as const;
    return 'danger' as const;
  }, []);

  const safeMeta = useCallback((m?: ScenarioMetadata | null): ScenarioMetadata => {
    return {
      description: m?.description ?? null,
      tags: Array.isArray(m?.tags) ? m!.tags.filter(Boolean) : [],
      lastStatus: m?.lastStatus ?? null,
      lastDurationMs: m?.lastDurationMs ?? null,
      lastRunAt: m?.lastRunAt ?? null,
    };
  }, []);

  const openEdit = useCallback(
    (item: ScenarioRecordItem) => {
      setEditItem(item);
      setEditName(item.name);
      const meta = safeMeta(item.metadata);
      setEditDescription(meta.description ?? '');
      setEditTagsText((meta.tags ?? []).join(', '));
      setEditOpen(true);
    },
    [safeMeta]
  );

  const saveEdit = useCallback(async () => {
    if (!editItem) return;
    const nextTags = parseTagsFromText(editTagsText);
    const nextMeta: ScenarioMetadata = {
      ...safeMeta(editItem.metadata),
      description: editDescription.trim() ? editDescription.trim() : null,
      tags: nextTags,
    };

    setEditSaving(true);
    try {
      const updated = await updateRecordedScenario({
        scenarioId: editItem.id,
        name: editName.trim() ? editName.trim() : editItem.name,
        metadata: nextMeta,
        revisionReason: 'metadata',
      });
      setItems(prev => prev.map(it => (it.id === updated.id ? updated : it)));
      toast.success(t('common.saved'));
      setEditOpen(false);
      setEditItem(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setEditSaving(false);
    }
  }, [editDescription, editItem, editName, editTagsText, parseTagsFromText, safeMeta]);

  const toggleFavorite = useCallback(async (item: ScenarioRecordItem) => {
    try {
      await setRecordedScenarioFavorite({ scenarioId: item.id, favorite: !item.favorite });
      setItems(prev =>
        prev.map(it => (it.id === item.id ? { ...it, favorite: !it.favorite } : it))
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error'));
    }
  }, []);

  const openDuplicateConfirm = useCallback((item: ScenarioRecordItem) => {
    setDuplicateTarget(item);
    setDuplicateConfirmOpen(true);
  }, []);

  const openHistory = useCallback(async (item: ScenarioRecordItem) => {
    setHistoryItem(item);
    setHistoryError(null);
    setHistoryLoading(true);
    setRevisions([]);
    setHistoryOpen(true);
    try {
      const rows = await listScenarioRevisions({ scenarioId: item.id, limit: 50 });
      setRevisions(rows);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const doRollback = useCallback(
    async (versionNo: number) => {
      if (!historyItem) return;
      setRollbackLoading(true);
      try {
        const updated = await rollbackRecordedScenario({
          scenarioId: historyItem.id,
          versionNo,
        });
        setItems(prev => prev.map(it => (it.id === updated.id ? updated : it)));
        setHistoryItem(updated);
        toast.success(t('common.saved'));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t('common.error'));
      } finally {
        setRollbackLoading(false);
      }
    },
    [historyItem]
  );

  const confirmDuplicate = useCallback(async () => {
    if (!duplicateTarget) return;
    setDuplicateLoading(true);
    try {
      const created = await duplicateRecordedScenario({ scenarioId: duplicateTarget.id });
      setItems(prev => [created, ...prev]);
      toast.success(t('common.saved'));
      setDuplicateConfirmOpen(false);
      setDuplicateTarget(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setDuplicateLoading(false);
    }
  }, [duplicateTarget]);

  const handleRefresh = useCallback(() => {
    if (!alias) return;
    setLoading(true);
    setError(null);
    listRecordedScenarios({ alias, limit: 50 })
      .then(next => {
        setItems(next);
        setError(null);
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load scenarios'))
      .finally(() => setLoading(false));
  }, [alias]);

  if (!isOpen) return null;

  const content = (
    <div className="space-y-4">
      {variant === 'modal' ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-slate-400">Scenario library</div>
            <div className="text-sm text-slate-200">Pick a saved scenario or record a new one.</div>
          </div>
          <Button
            size="xs"
            variant="secondary"
            onClick={handleRefresh}
            disabled={!alias || loading}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('scenarios.searchPlaceholder')}
          className="h-9"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="xs"
            variant={favoritesOnly ? 'primary' : 'secondary'}
            onClick={() => setFavoritesOnly(v => !v)}
            leftIcon={<Heart size={14} />}
          >
            {t('scenarios.favoritesOnly')}
          </Button>

          <MultiFilterDropdown
            values={selectedTags}
            onChange={setSelectedTags}
            icon={<Tag size={14} />}
            placeholder={t('scenarios.tagsFilterLabel')}
            triggerClassName="h-8"
            menuClassName="min-w-[260px]"
            showActiveState
            showFooterActions
            options={tagOptions}
            renderValue={values =>
              values.length === 0 ? t('scenarios.tagsFilterLabel') : values.join(', ')
            }
          />

          <Button
            size="xs"
            variant="secondary"
            onClick={handleRefresh}
            disabled={!alias || loading}
            leftIcon={<RefreshCw size={14} />}
          >
            {loading ? t('common.loading') : t('common.refresh')}
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-black/20 p-3">
        {loading ? (
          <div className="text-xs text-slate-500">{t('common.loading')}</div>
        ) : error ? (
          <div className="text-xs text-amber-300">{error}</div>
        ) : items.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Archive size={14} /> {t('scenarios.noScenarios')}
          </div>
        ) : (
          <div className="max-h-96 overflow-auto space-y-2 pr-1">
            {filtered.length === 0 ? (
              <div className="text-xs text-slate-500">{t('common.none')}</div>
            ) : (
              filtered.map(item => {
                const meta = safeMeta(item.metadata);
                return (
                  <div
                    key={item.id}
                    className="rounded-lg border border-white/10 bg-white/[0.02] hover:bg-white/[0.04] transition-colors px-3 py-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        className="flex-1 text-left"
                        onClick={() => onReplay(item.scenarioPath)}
                      >
                        <div className="flex items-center gap-2">
                          <div className="text-sm text-slate-100 font-medium truncate">
                            {item.name}
                          </div>
                          {item.favorite ? <Heart size={14} className="text-pink-300" /> : null}
                          {item.missing ? (
                            <Badge variant="warning" size="sm" className="normal-case">
                              {t('scenarios.missingFile')}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500 truncate">
                          {new Date(item.createdAt).toLocaleString()} • {item.scenarioPath}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Badge variant="outline" size="sm" className="normal-case">
                            {item.stepsCount} {t('scenarios.stepsCount')}
                          </Badge>
                          <Badge variant="outline" size="sm" className="normal-case">
                            {t('scenarios.playCount')}: {item.playCount}
                          </Badge>
                          <Badge variant="outline" size="sm" className="normal-case">
                            {t('scenarios.lastPlayed')}: {formatLastPlayed(item.lastPlayedAt)}
                          </Badge>
                          {item.healthScore != null ? (
                            <Badge
                              variant={healthVariant(item.healthScore)}
                              size="sm"
                              className="normal-case"
                            >
                              {t('scenarios.healthScore')}: {item.healthScore}
                            </Badge>
                          ) : null}
                          {meta.lastStatus ? (
                            <Badge variant="info" size="sm" className="normal-case">
                              {t('scenarios.lastStatus')}: {meta.lastStatus}
                            </Badge>
                          ) : null}
                          {meta.lastDurationMs != null ? (
                            <Badge variant="outline" size="sm" className="normal-case">
                              {t('scenarios.lastDuration')}:{' '}
                              {Math.round(meta.lastDurationMs / 100) / 10}s
                            </Badge>
                          ) : null}
                        </div>
                        {meta.tags.length ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {meta.tags.slice(0, 6).map(tag => (
                              <Badge key={tag} variant="default" size="sm" className="normal-case">
                                {tag}
                              </Badge>
                            ))}
                            {meta.tags.length > 6 ? (
                              <Badge variant="outline" size="sm" className="normal-case">
                                +{meta.tags.length - 6}
                              </Badge>
                            ) : null}
                          </div>
                        ) : null}
                        {meta.description ? (
                          <div className="mt-2 text-xs text-slate-400 whitespace-pre-wrap">
                            {meta.description}
                          </div>
                        ) : null}
                      </button>

                      <div className="flex items-center gap-1.5">
                        <IconButton
                          size="sm"
                          variant="ghost"
                          onClick={() => void toggleFavorite(item)}
                          aria-label={t('scenarios.toggleFavorite')}
                        >
                          <Heart size={16} className={item.favorite ? 'text-pink-300' : ''} />
                        </IconButton>
                        <IconButton
                          size="sm"
                          variant="ghost"
                          onClick={() => openEdit(item)}
                          aria-label={t('scenarios.editScenario')}
                        >
                          <Pencil size={16} />
                        </IconButton>
                        <IconButton
                          size="sm"
                          variant="ghost"
                          onClick={() => openDuplicateConfirm(item)}
                          aria-label={t('scenarios.duplicateScenario')}
                        >
                          <Repeat2 size={16} />
                        </IconButton>
                        <IconButton
                          size="sm"
                          variant="ghost"
                          onClick={() => void openHistory(item)}
                          aria-label={t('common.history')}
                        >
                          <Archive size={16} />
                        </IconButton>
                        <IconButton
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            void openInFileManager({ path: item.scenarioPath }).catch(() => {
                              toast.error(t('common.error'));
                            })
                          }
                          aria-label={t('scenarios.openFolder')}
                        >
                          <FolderOpen size={16} />
                        </IconButton>
                        <IconButton
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            void copyToClipboard({ text: item.scenarioPath }).then(
                              () => toast.success(t('common.success')),
                              () => toast.error(t('common.error'))
                            )
                          }
                          aria-label={t('scenarios.copyPath')}
                        >
                          <Copy size={16} />
                        </IconButton>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      <Modal
        isOpen={editOpen}
        onClose={() => {
          setEditOpen(false);
          setEditItem(null);
        }}
        title={t('scenarios.editScenario')}
        size="lg"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditOpen(false)} disabled={editSaving}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={() => void saveEdit()} isLoading={editSaving}>
              {t('scenarios.update')}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Input
            label={t('common.name')}
            value={editName}
            onChange={e => setEditName(e.target.value)}
            placeholder="scenario"
          />
          <Textarea
            label={t('scenarios.description')}
            value={editDescription}
            onChange={e => setEditDescription(e.target.value)}
            rows={3}
          />
          <Input
            label={t('scenarios.tags')}
            value={editTagsText}
            onChange={e => setEditTagsText(e.target.value)}
            placeholder={t('scenarios.tagsHint')}
          />
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={duplicateConfirmOpen}
        onClose={() => {
          setDuplicateConfirmOpen(false);
          setDuplicateTarget(null);
        }}
        onConfirm={() => void confirmDuplicate()}
        title={t('scenarios.duplicateScenario')}
        message={
          <div className="space-y-1">
            <div className="text-slate-200">{duplicateTarget?.name ?? ''}</div>
            <div className="text-xs text-slate-400">{duplicateTarget?.scenarioPath ?? ''}</div>
          </div>
        }
        confirmText={t('common.confirm')}
        cancelText={t('common.cancel')}
        variant="warning"
        isLoading={duplicateLoading}
      />

      <Modal
        isOpen={historyOpen}
        onClose={() => {
          setHistoryOpen(false);
          setHistoryItem(null);
          setRevisions([]);
          setHistoryError(null);
        }}
        title={t('common.history')}
        size="lg"
      >
        <div className="space-y-3">
          <div className="text-sm text-slate-200 font-medium">{historyItem?.name ?? ''}</div>
          <div className="text-xs text-slate-500 break-all">{historyItem?.scenarioPath ?? ''}</div>

          {historyLoading ? (
            <div className="text-xs text-slate-500">{t('common.loading')}</div>
          ) : historyError ? (
            <div className="text-xs text-amber-300">{historyError}</div>
          ) : revisions.length === 0 ? (
            <div className="text-xs text-slate-500">{t('common.none')}</div>
          ) : (
            <div className="max-h-80 overflow-auto rounded-lg border border-white/10 bg-black/20 p-2 space-y-2">
              {revisions.map(r => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-xs text-slate-200">
                      v{r.versionNo} <span className="text-slate-500">•</span>{' '}
                      <span className="text-slate-400">
                        {new Date(r.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {r.reason ? (
                      <div className="text-[11px] text-slate-500 truncate">{r.reason}</div>
                    ) : null}
                  </div>
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => void doRollback(r.versionNo)}
                    isLoading={rollbackLoading}
                  >
                    {t('common.rollback')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );

  if (variant === 'panel') {
    return (
      <div className="rounded-2xl border border-white/10 bg-[#0f1115]/70 px-5 py-5 shadow-[0_16px_50px_rgba(0,0,0,0.35)]">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-4">
          <div>
            <div className="text-xs text-slate-500 uppercase tracking-[0.2em]">
              Scenario library
            </div>
            <div className="text-lg text-white font-semibold mt-1">
              {alias ? `${displayAlias} scenarios` : 'Scenarios'}
            </div>
            {alias && displayAlias !== alias ? (
              <div className="text-[11px] text-slate-500 truncate font-mono">{alias}</div>
            ) : null}
            <div className="text-sm text-slate-400">
              Pick a saved scenario, or record a new flow for this profile.
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={handleRefresh}
              disabled={!alias || loading}
            >
              {loading ? 'Loading…' : 'Refresh'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onReplay()}>
              <PlayCircle size={16} className="mr-1" />
              Replay from file
            </Button>
            {onComposeFlow ? (
              <Button size="sm" variant="secondary" onClick={onComposeFlow}>
                <PlayCircle size={16} className="mr-1" />
                Compose flow
              </Button>
            ) : null}
            <Button size="sm" variant="primary" onClick={onRecord}>
              <PlusCircle size={16} className="mr-1" />
              Record scenario
            </Button>
          </div>
        </div>
        {content}
      </div>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={alias ? `${displayAlias} scenarios` : 'Scenarios'}
      size="lg"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => onReplay()}>
              <PlayCircle size={16} className="mr-1" />
              Replay from file
            </Button>
            {onComposeFlow ? (
              <Button variant="secondary" onClick={onComposeFlow}>
                <PlayCircle size={16} className="mr-1" />
                Compose flow
              </Button>
            ) : null}
            <Button variant="primary" onClick={onRecord}>
              <PlusCircle size={16} className="mr-1" />
              Record scenario
            </Button>
          </div>
        </div>
      }
    >
      {content}
    </Modal>
  );
}
