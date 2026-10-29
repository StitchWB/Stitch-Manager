import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Button } from '@/components/ui';
import {
  deleteRecordedScenario,
  listRecordedScenarios,
  reindexRecordedScenarios,
  setRecordedScenarioFavorite,
  setRecordedScenarioTier,
  updateRecordedScenario,
  duplicateRecordedScenario,
  listScenarioRevisions,
  rollbackRecordedScenario,
  type ScenarioMetadata,
  type ScenarioRevisionItem,
  type ScenarioRecordItem } from
'@/lib/backend/modules/pythonJobs';
import { t } from '@/lib/i18n';
import { toast } from 'sonner';
import { formatProfileAlias } from '@/lib/profiles/displayName';
import { useUIPreferencesStore } from '@/stores/uiPreferences';
import { useAuthStore, effectiveRole } from '@/stores/auth';
import { BatchOpsBar } from './panels/BatchOpsBar';
import { FilterRow } from './panels/FilterRow';
import { ReplayControls } from './panels/ReplayControls';
import { ScenarioList } from './panels/ScenarioList';
import { ScenarioDialogs } from './panels/ScenarioDialogs';
import { safeMeta } from './panels/scenarioMeta';

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
  variant = 'modal'
}: ProfileScenariosPanelProps) {
  const displayAlias = formatProfileAlias(alias);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ScenarioRecordItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const viewMode = useUIPreferencesStore((state) => state.scenariosPage.viewMode);
  const setScenariosViewMode = useUIPreferencesStore((state) => state.setScenariosViewMode);
  const currentUser = useAuthStore((state) => state.user);
  // effective role: an admin previewing a non-admin role must lose the admin-only edit controls
  const isAdmin = effectiveRole(currentUser) === 'admin';

  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editItem, setEditItem] = useState<ScenarioRecordItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editTagsText, setEditTagsText] = useState('');
  const [editTier, setEditTier] = useState<string>('user');

  const [duplicateLoading, setDuplicateLoading] = useState(false);

  const [showLocked, setShowLocked] = useState(true);
  const [howToGetItem, setHowToGetItem] = useState<ScenarioRecordItem | null>(null);


  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyItem, setHistoryItem] = useState<ScenarioRecordItem | null>(null);
  const [revisions, setRevisions] = useState<ScenarioRevisionItem[]>([]);
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleteLoadingId, setDeleteLoadingId] = useState<string | null>(null);

  const fetchScenarioItems = useCallback(async (targetAlias: string) => {
    let next = await listRecordedScenarios({ alias: targetAlias, limit: 50 });
    if (next.length > 0) return next;

    // If DB index is stale, try one best-effort reindex for this alias.
    try {
      const reindex = await reindexRecordedScenarios({ alias: targetAlias });
      if (reindex.indexed > 0) {
        next = await listRecordedScenarios({ alias: targetAlias, limit: 50 });
      }
    } catch {

      // best effort only
    }
    return next;
  }, []);

  useEffect(() => {
    if (!isOpen || !alias) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const next = await fetchScenarioItems(alias);
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
  }, [alias, fetchScenarioItems, isOpen]);

  useEffect(() => {
    queueMicrotask(() => {
    if (!isOpen) {
      setQuery('');
      setFavoritesOnly(false);
      setSelectedTags([]);
      setEditOpen(false);
      setEditItem(null);
      setHistoryOpen(false);
      setHistoryItem(null);
      setRevisions([]);
      setPendingDeleteId(null);
      setDeleteLoadingId(null);
    }
    });
  }, [isOpen]);

  useEffect(() => {
    if (!pendingDeleteId) return;
    const timer = window.setTimeout(() => {
      setPendingDeleteId((current) => current === pendingDeleteId ? null : current);
    }, 4500);
    return () => window.clearTimeout(timer);
  }, [pendingDeleteId]);

  const parseTagsFromText = useCallback((raw: string): string[] => {
    const parts = raw.
    split(',').
    map((p) => p.trim()).
    filter(Boolean);
    const normalized = parts.map((p) => p.toLowerCase());
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
    allTags.map((tag) => ({
      value: tag,
      label: tag
    })),
    [allTags]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.
    filter((item) => favoritesOnly ? item.favorite : true).
    filter((item) => showLocked ? true : item.locked !== true).
    filter((item) => {
      if (selectedTags.length === 0) return true;
      const tags = (item.metadata?.tags ?? []).map(toTagLabel);
      return selectedTags.every((t) => tags.includes(t));
    }).
    filter((item) => {
      if (!q) return true;
      const tags = (item.metadata?.tags ?? []).join(', ');
      return (
        item.name.toLowerCase().includes(q) ||
        item.scenarioPath.toLowerCase().includes(q) ||
        (item.startedUrl ?? '').toLowerCase().includes(q) ||
        tags.toLowerCase().includes(q));

    });
  }, [favoritesOnly, items, query, selectedTags, showLocked, toTagLabel]);

  const openEdit = useCallback(
    (item: ScenarioRecordItem) => {
      setEditItem(item);
      setEditName(item.name);
      const meta = safeMeta(item.metadata);
      setEditDescription(meta.description ?? '');
      setEditTagsText((meta.tags ?? []).join(', '));
      setEditTier(item.min_role ?? 'user');
      setEditOpen(true);
    },
    []
  );

  const saveEdit = useCallback(async () => {
    if (!editItem) return;
    const nextTags = parseTagsFromText(editTagsText);
    const nextMeta: ScenarioMetadata = {
      ...safeMeta(editItem.metadata),
      description: editDescription.trim() ? editDescription.trim() : null,
      tags: nextTags
    };

    setEditSaving(true);
    try {
      const updated = await updateRecordedScenario({
        scenarioId: editItem.id,
        name: editName.trim() ? editName.trim() : editItem.name,
        metadata: nextMeta,
        revisionReason: 'metadata'
      });

      if (isAdmin && editTier !== (editItem.min_role ?? 'user')) {
        await setRecordedScenarioTier(editItem.id, editTier);
        if (alias) {
          const next = await fetchScenarioItems(alias);
          setItems(next);
        } else {
          setItems((prev) => prev.map((it) => it.id === updated.id ? updated : it));
        }
      } else {
        setItems((prev) => prev.map((it) => it.id === updated.id ? updated : it));
      }

      toast.success(t('common.saved'));
      setEditOpen(false);
      setEditItem(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setEditSaving(false);
    }
  }, [alias, editDescription, editItem, editName, editTagsText, editTier, fetchScenarioItems, isAdmin, parseTagsFromText]);

  const toggleFavorite = useCallback(async (item: ScenarioRecordItem) => {
    try {
      await setRecordedScenarioFavorite({ scenarioId: item.id, favorite: !item.favorite });
      setItems((prev) =>
      prev.map((it) => it.id === item.id ? { ...it, favorite: !it.favorite } : it)
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error'));
    }
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
          versionNo
        });
        setItems((prev) => prev.map((it) => it.id === updated.id ? updated : it));
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

  // Two-step duplicate (no confirm modal): first click arms, second duplicates.
  const confirmDuplicate = useCallback(async (item: ScenarioRecordItem) => {
    setDuplicateLoading(true);
    try {
      const created = await duplicateRecordedScenario({ scenarioId: item.id });
      setItems((prev) => [created, ...prev]);
      toast.success(t('common.saved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setDuplicateLoading(false);
    }
  }, []);

  const handleDeleteClick = useCallback(
    async (item: ScenarioRecordItem) => {
      if (deleteLoadingId) return;

      if (pendingDeleteId !== item.id) {
        setPendingDeleteId(item.id);
        return;
      }

      setDeleteLoadingId(item.id);
      try {
        await deleteRecordedScenario(item.id);
        setItems((prev) => prev.filter((it) => it.id !== item.id));
        setPendingDeleteId(null);
        toast.success(t('common.success'));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t('common.error'));
      } finally {
        setDeleteLoadingId(null);
      }
    },
    [deleteLoadingId, pendingDeleteId]
  );

  const handleRefresh = useCallback(() => {
    if (!alias) return;
    setLoading(true);
    setError(null);
    fetchScenarioItems(alias).
    then((next) => {
      setItems(next);
      setError(null);
    }).
    catch((e) => setError(e instanceof Error ? e.message : t('common.error'))).
    finally(() => setLoading(false));
  }, [alias, fetchScenarioItems]);

  if (!isOpen) return null;

  const content =
  <div className="space-y-4">
      {variant === 'modal' ?
    <BatchOpsBar loading={loading} refreshDisabled={!alias || loading} onRefresh={handleRefresh} /> :
    null}

      <FilterRow
      query={query}
      onQueryChange={setQuery}
      favoritesOnly={favoritesOnly}
      onToggleFavorites={() => setFavoritesOnly((v) => !v)}
      showLocked={showLocked}
      onToggleLocked={() => setShowLocked((v) => !v)}
      selectedTags={selectedTags}
      onSelectedTagsChange={setSelectedTags}
      tagOptions={tagOptions}
      viewMode={viewMode}
      onViewModeChange={(value) =>
      setScenariosViewMode(value as 'cards' | 'list' === 'list' ? 'list' : 'cards')
      }
      onRefresh={handleRefresh}
      refreshDisabled={!alias || loading}
      loading={loading}
      filteredCount={filtered.length}
      itemsCount={items.length} />


      <ScenarioList
      loading={loading}
      error={error}
      itemsCount={items.length}
      filtered={filtered}
      viewMode={viewMode}
      onReplay={onReplay}
      duplicateLoading={duplicateLoading}
      pendingDeleteId={pendingDeleteId}
      deleteLoadingId={deleteLoadingId}
      onHowToGet={setHowToGetItem}
      onToggleFavorite={(item) => void toggleFavorite(item)}
      onEdit={openEdit}
      onDuplicate={(item) => void confirmDuplicate(item)}
      onOpenHistory={(item) => void openHistory(item)}
      onDeleteClick={(item) => void handleDeleteClick(item)} />


      <ScenarioDialogs
      editOpen={editOpen}
      editSaving={editSaving}
      editName={editName}
      editDescription={editDescription}
      editTagsText={editTagsText}
      editTier={editTier}
      isAdmin={isAdmin}
      onEditClose={() => {
        setEditOpen(false);
        setEditItem(null);
      }}
      onEditCancel={() => setEditOpen(false)}
      onEditNameChange={setEditName}
      onEditDescriptionChange={setEditDescription}
      onEditTagsTextChange={setEditTagsText}
      onEditTierChange={setEditTier}
      onEditSave={() => void saveEdit()}
      historyOpen={historyOpen}
      historyItem={historyItem}
      historyLoading={historyLoading}
      historyError={historyError}
      revisions={revisions}
      rollbackLoading={rollbackLoading}
      onHistoryClose={() => {
        setHistoryOpen(false);
        setHistoryItem(null);
        setRevisions([]);
        setHistoryError(null);
      }}
      onRollback={(versionNo) => void doRollback(versionNo)}
      howToGetItem={howToGetItem}
      onHowToGetClose={() => setHowToGetItem(null)} />

    </div>;


  if (variant === 'panel') {
    return (
      <div className="rounded-2xl border border-white/10 bg-vsc-panel/70 px-6 py-6 shadow-[0_16px_50px_rgba(0,0,0,0.35)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2 min-w-0">
            <div className="text-xs text-slate-500 uppercase tracking-[0.3em]">
              {t('scenarios.libraryTitle')}
            </div>
            <div className="flex flex-wrap items-center gap-3 min-w-0">
              <div className="text-lg text-white font-semibold truncate min-w-0">
                {alias ? `${displayAlias} ${t('scenarios.title')}` : t('scenarios.title')}
              </div>
              {alias && displayAlias !== alias ?
              <div className="text-[11px] text-slate-500 truncate font-mono min-w-0">{alias}</div> :
              null}
            </div>
            <div className="text-sm text-slate-400">{t('scenarios.librarySubtitle')}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2 justify-start lg:justify-end">
            <ReplayControls
              variant="panel"
              loading={loading}
              refreshDisabled={!alias || loading}
              onRefresh={handleRefresh}
              onReplay={() => onReplay()}
              onComposeFlow={onComposeFlow}
              onRecord={onRecord} />

          </div>
        </div>
        <div className="mt-5">{content}</div>
      </div>);

  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={alias ? `${displayAlias} ${t('scenarios.title')}` : t('scenarios.title')}
      size="lg"
      footer={
      <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
          <div className="flex gap-2">
            <ReplayControls
            variant="modal"
            onReplay={() => onReplay()}
            onComposeFlow={onComposeFlow}
            onRecord={onRecord} />

          </div>
        </div>
      }>

      {content}
    </Modal>);

}
