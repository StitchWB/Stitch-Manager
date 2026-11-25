import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, Settings2, Waypoints } from 'lucide-react';

import Header from '@/components/layout/Header';
import { GatewayStatusCard } from '@/components/model-sync/GatewayStatusCard';
import { ModelCatalogTable } from '@/components/model-sync/ModelCatalogTable';
import { OpenCodeTargetCard } from '@/components/model-sync/OpenCodeTargetCard';
import { OmpTargetCard, type OmpRoleSelection } from '@/components/model-sync/OmpTargetCard';
import { SecurityKeysSection } from '@/components/model-sync/SecurityKeysSection';
import { SyncPreviewPanel } from '@/components/model-sync/SyncPreviewPanel';
import { SyncResultPanel } from '@/components/model-sync/SyncResultPanel';
import { Button, LoadingSpinner, PageHeader } from '@/components/ui';
import {
  OMP_ROLES,
  modelSyncApply,
  modelSyncCatalog,
  modelSyncPreview,
  modelSyncRestore,
  modelSyncStatus,
  type ModelSyncApplyFileResult,
  type ModelSyncApplyParams,
  type ModelSyncApplyResponse,
  type ModelSyncCatalogModel,
  type ModelSyncPlanParams,
  type ModelSyncPreviewResponse,
  type ModelSyncSchemaOverride,
  type ModelSyncShaMismatch,
  type ModelSyncStatusResponse,
  type ModelSyncTarget,
} from '@/lib/backend/modules/modelSync';
import { t } from '@/lib/i18n';

function emptyRoleSelections(): Record<string, OmpRoleSelection> {
  return Object.fromEntries(OMP_ROLES.map(role => [role, { model: '', effort: '' }]));
}

function sortedIds(ids: Set<string>): string[] {
  return [...ids].sort();
}

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="pt-2">
      <h2 className="text-lg font-semibold tracking-tight text-slate-100">{title}</h2>
      {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
    </div>
  );
}

function collectSyncedIds(status: ModelSyncStatusResponse | null): Set<string> {
  const synced = new Set<string>();
  for (const id of status?.opencode?.stitchModels || []) synced.add(id);
  for (const profile of status?.omp?.profiles || []) {
    for (const id of profile.stitchModels || []) synced.add(id);
  }
  return synced;
}

export default function ModelSync() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<ModelSyncStatusResponse | null>(null);
  const [catalog, setCatalog] = useState<ModelSyncCatalogModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [syncedIds, setSyncedIds] = useState<Set<string>>(new Set());
  const [opencodeEnabled, setOpencodeEnabled] = useState(true);
  const [ompEnabled, setOmpEnabled] = useState(true);
  const [schemaOverride, setSchemaOverride] = useState<ModelSyncSchemaOverride>('auto');
  const [defaultModel, setDefaultModel] = useState('');
  // v1-only: written as the top-level small_model selector; ignored for v2.
  const [smallModel, setSmallModel] = useState('');
  const [pruneUnselected, setPruneUnselected] = useState(true);
  const [ensureEnabled, setEnsureEnabled] = useState(true);
  const [ompProfile, setOmpProfile] = useState('default');
  const [roleSelections, setRoleSelections] = useState<Record<string, OmpRoleSelection>>(emptyRoleSelections);

  const [preview, setPreview] = useState<ModelSyncPreviewResponse | null>(null);
  const [previewFingerprint, setPreviewFingerprint] = useState<string | null>(null);
  const [previewParams, setPreviewParams] = useState<ModelSyncPlanParams | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<ModelSyncApplyResponse | null>(null);
  const [conflictMismatches, setConflictMismatches] = useState<ModelSyncShaMismatch[] | null>(null);
  const [restoringPath, setRestoringPath] = useState<string | null>(null);
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const initializedSelection = useRef(false);

  const load = useCallback(async (initializeSelection: boolean) => {
    setLoading(true);
    setLoadError(null);
    try {
      const [catalogResponse, statusResponse] = await Promise.all([
        modelSyncCatalog(),
        modelSyncStatus(),
      ]);
      const models = catalogResponse.models || [];
      setCatalog(models);
      setStatus(statusResponse);
      const synced = collectSyncedIds(statusResponse);
      const catalogIds = new Set(models.map(model => model.id));
      const validSynced = new Set([...synced].filter(id => catalogIds.has(id)));
      setSyncedIds(validSynced);

      if (initializeSelection && !initializedSelection.current) {
        initializedSelection.current = true;
        const initialSelection = validSynced.size
          ? new Set(validSynced)
          : new Set(models.map(model => model.id));
        setSelectedIds(initialSelection);
        // initialize the small-model picker from the live config, but only
        // when it points at a stitch model that is part of the selection —
        // otherwise the picker has no matching option to display
        const currentSmall = statusResponse.opencode?.smallModel;
        if (currentSmall?.startsWith('stitch/')) {
          const smallId = currentSmall.slice('stitch/'.length).split(':', 1)[0];
          if (initialSelection.has(smallId)) setSmallModel(currentSmall);
        }
        const profiles = statusResponse.omp?.profiles || [];
        const hinted = profiles.find(profile => profile.name === statusResponse.omp?.profileHint);
        const defaultProfile = profiles.find(profile => profile.isDefault) || profiles[0];
        setOmpProfile((hinted || defaultProfile)?.name || 'default');
      }

      if (!catalogResponse.ok) {
        setLoadError(catalogResponse.error || t('modelSync.loadError'));
      } else if (!statusResponse.ok) {
        setLoadError(statusResponse.error || t('modelSync.loadError'));
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t('modelSync.loadError'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  const buildPlanParams = useCallback((): ModelSyncPlanParams => {
    const targets: ModelSyncTarget[] = [];
    if (opencodeEnabled) targets.push('opencode');
    if (ompEnabled) targets.push('omp');

    const roles = OMP_ROLES.map(role => {
      const selection = roleSelections[role];
      if (!selection?.model) return null;
      return {
        role,
        model: selection.model,
        ...(selection.effort ? { effort: selection.effort } : {}),
      };
    }).filter((role): role is NonNullable<typeof role> => Boolean(role));

    const params: ModelSyncPlanParams = {
      targets,
      models: sortedIds(selectedIds),
      schema: schemaOverride,
      pruneUnselected,
      ensureEnabled,
    };
    if (defaultModel) params.defaultModel = defaultModel;
    if (smallModel) params.smallModel = smallModel;
    if (ompEnabled) params.ompProfile = ompProfile;
    if (roles.length) params.roles = roles;
    return params;
  }, [
    opencodeEnabled,
    ompEnabled,
    selectedIds,
    schemaOverride,
    pruneUnselected,
    ensureEnabled,
    defaultModel,
    smallModel,
    ompProfile,
    roleSelections,
  ]);

  const currentFingerprint = useMemo(
    () => JSON.stringify(buildPlanParams()),
    [buildPlanParams],
  );
  const previewIsFresh = Boolean(
    preview && previewFingerprint && previewFingerprint === currentFingerprint,
  );

  const selectedModels = useMemo(
    () => catalog.filter(model => selectedIds.has(model.id)),
    [catalog, selectedIds],
  );

  const conflictPaths = useMemo(
    () => new Set((conflictMismatches || []).map(mismatch => mismatch.path)),
    [conflictMismatches],
  );

  const clearPreviewForEdit = () => {
    // The fingerprint check is authoritative; clearing only removes visual
    // clutter for edits made after a conflict forced a re-preview.
    if (conflictMismatches) setPreview(null);
  };

  const handlePreview = useCallback(async () => {
    setClientError(null);
    setConflictMismatches(null);
    const params = buildPlanParams();
    if (!params.targets?.length) {
      setClientError(t('modelSync.preview.noTargets'));
      return;
    }
    if (!params.models?.length) {
      setClientError(t('modelSync.preview.noModelsSelected'));
      return;
    }
    setPreviewing(true);
    try {
      const response = await modelSyncPreview(params);
      setPreview(response);
      setPreviewParams(params);
      setPreviewFingerprint(JSON.stringify(params));
    } catch (error) {
      setPreview({
        ok: false,
        errors: [error instanceof Error ? error.message : String(error)],
        warnings: [],
        files: [],
        expectedSha256: {},
      });
      setPreviewParams(params);
      setPreviewFingerprint(JSON.stringify(params));
    } finally {
      setPreviewing(false);
    }
  }, [buildPlanParams]);

  const handleApply = useCallback(async () => {
    if (!preview || !previewIsFresh || !previewParams || !preview.expectedSha256) return;
    setApplying(true);
    setRestoreMessage(null);
    setRestoreError(null);
    try {
      const params: ModelSyncApplyParams = {
        ...previewParams,
        expectedSha256: preview.expectedSha256,
      };
      const response = await modelSyncApply(params);
      if (response.status === 409 || response.error === 'conflict') {
        setConflictMismatches(response.mismatches || []);
        // Conflict protocol: the old expectedSha256 map is unsafe now, so the
        // user must generate a fresh preview before Apply becomes enabled.
        setPreview(null);
        setPreviewFingerprint(null);
        setPreviewParams(null);
        return;
      }
      setApplyResult(response);
      if (response.ok) {
        setPreview(null);
        setPreviewFingerprint(null);
        setPreviewParams(null);
        void load(false);
      }
    } catch (error) {
      setApplyResult({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        files: [],
      });
    } finally {
      setApplying(false);
    }
  }, [preview, previewIsFresh, previewParams, load]);

  const handleRestore = useCallback(async (file: ModelSyncApplyFileResult) => {
    if (!file.backupPath) return;
    setRestoringPath(file.path);
    setRestoreMessage(null);
    setRestoreError(null);
    try {
      const response = await modelSyncRestore({
        entries: [{ path: file.path, backupPath: file.backupPath }],
      });
      if (response.ok) {
        setRestoreMessage(t('modelSync.result.restored'));
      } else {
        setRestoreError(
          `${t('modelSync.result.restoreFailed')}: ${response.error || response.files?.find(item => item.path === file.path)?.error || 'unknown'}`,
        );
      }
    } catch (error) {
      setRestoreError(
        `${t('modelSync.result.restoreFailed')}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setRestoringPath(null);
    }
  }, []);

  const canApply = Boolean(
    preview?.ok && previewIsFresh && !previewing && !applying && status?.gatewayRunning,
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-void-base" data-testid="model-sync-page">
      <Header title={t('modelSync.navTitle')} icon={<Waypoints size={18} />} />
      <PageHeader
        eyebrow={t('modelSync.eyebrow')}
        title={t('modelSync.title')}
        description={t('modelSync.description')}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate('/ai/opencode-config')}
              leftIcon={<Settings2 size={14} />}
            >
              {t('modelSync.advancedEditor')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void load(false)}
              isLoading={loading}
              leftIcon={<RefreshCw size={14} />}
            >
              {t('modelSync.refresh')}
            </Button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto p-4 md:p-8">
        {loading && !status && !catalog.length ? (
          <div className="flex h-48 items-center justify-center gap-3 text-sm text-slate-400">
            <LoadingSpinner size="sm" />
            {t('modelSync.loading')}
          </div>
        ) : (
          <div className="mx-auto max-w-7xl space-y-6">
            {loadError ? (
              <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-200">
                <span className="font-semibold">{t('modelSync.loadError')}: </span>
                {loadError}
              </div>
            ) : null}

            <GatewayStatusCard status={status} modelCount={catalog.length} />

            <section aria-label={t('modelSync.sections.targets')} className="space-y-4">
              <SectionHeader
                title={t('modelSync.sections.targets')}
                description={t('modelSync.sections.targetsDescription')}
              />
              <div className="grid gap-5 xl:grid-cols-2">
                <OpenCodeTargetCard
                  status={status?.opencode}
                  enabled={opencodeEnabled}
                  onEnabledChange={value => {
                    setOpencodeEnabled(value);
                    clearPreviewForEdit();
                  }}
                  schemaOverride={schemaOverride}
                  onSchemaOverrideChange={setSchemaOverride}
                  defaultModel={defaultModel}
                  onDefaultModelChange={setDefaultModel}
                  smallModel={smallModel}
                  onSmallModelChange={setSmallModel}
                  pruneUnselected={pruneUnselected}
                  onPruneUnselectedChange={setPruneUnselected}
                  selectedModels={selectedModels}
                  conflictPaths={conflictPaths}
                />
                <OmpTargetCard
                  profiles={status?.omp?.profiles || []}
                  profileHint={status?.omp?.profileHint || null}
                  binaryPath={status?.omp?.binaryPath || null}
                  binaryVersion={status?.omp?.version || null}
                  enabled={ompEnabled}
                  onEnabledChange={value => {
                    setOmpEnabled(value);
                    clearPreviewForEdit();
                  }}
                  selectedProfile={ompProfile}
                  onSelectedProfileChange={setOmpProfile}
                  roleSelections={roleSelections}
                  onRoleSelectionsChange={setRoleSelections}
                  pruneUnselected={pruneUnselected}
                  onPruneUnselectedChange={setPruneUnselected}
                  ensureEnabled={ensureEnabled}
                  onEnsureEnabledChange={setEnsureEnabled}
                  selectedModels={selectedModels}
                />
              </div>
            </section>

            <SecurityKeysSection status={status} />

            <section aria-label={t('modelSync.sections.catalog')} className="space-y-4">
              <SectionHeader
                title={t('modelSync.sections.catalog')}
                description={t('modelSync.sections.catalogDescription')}
              />
              <ModelCatalogTable
                models={catalog}
                selectedIds={selectedIds}
                syncedIds={syncedIds}
                onSelectionChange={ids => {
                  setSelectedIds(ids);
                  clearPreviewForEdit();
                }}
              />
            </section>

            {clientError ? (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-200">
                {clientError}
              </div>
            ) : null}

            <section aria-label={t('modelSync.sections.sync')} className="space-y-4">
              <SectionHeader
                title={t('modelSync.sections.sync')}
                description={t('modelSync.sections.syncDescription')}
              />
              <SyncPreviewPanel
                preview={preview}
                isFresh={previewIsFresh}
                previewing={previewing}
                applying={applying}
                canApply={canApply}
                conflictMismatches={conflictMismatches}
                onPreview={() => void handlePreview()}
                onApply={() => void handleApply()}
              />

              <SyncResultPanel
                result={applyResult}
                restoringPath={restoringPath}
                restoreMessage={restoreMessage}
                restoreError={restoreError}
                onRestore={file => void handleRestore(file)}
              />
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
