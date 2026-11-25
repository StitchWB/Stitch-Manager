import { AlertTriangle, FileDiff, Play, ShieldAlert } from 'lucide-react';

import { Badge, Button, EmptyState, GlassCard } from '@/components/ui';
import type {
  ModelDiffSummary,
  ModelSyncPreviewFile,
  ModelSyncPreviewResponse,
  ModelSyncShaMismatch,
  ModelSyncTarget,
} from '@/lib/backend/modules/modelSync';
import { t } from '@/lib/i18n';

/** Defensive renderer-side redaction. The backend already emits ********;
 * this second pass guarantees the UI never expands or reprints credential
 * values if a malformed/legacy diff reaches the renderer. */
export function redactDiffCredentials(diff: string): string {
  return diff
    .replace(
      /("(?:apiKey|apikey|api_key|token|secret|key)"\s*:\s*")([^"]*)(")/gi,
      '$1********$3',
    )
    .replace(
      /^([+-]?\s*(?:apiKey|apikey|api_key|token|secret|key)\s*:\s*)([^\s,]+)/gim,
      '$1********',
    );
}

function DiffSummaryBadges({ diff }: { diff: ModelDiffSummary | undefined }) {
  if (!diff) return null;
  const parts: Array<[string, number, 'success' | 'danger' | 'warning' | 'slate']> = [
    [t('modelSync.preview.added'), diff.added.length, 'success'],
    [t('modelSync.preview.removed'), diff.removed.length, 'danger'],
    [t('modelSync.preview.updated'), diff.updated.length, 'warning'],
    [t('modelSync.preview.unchanged'), diff.unchanged.length, 'slate'],
  ];
  return (
    <div className="flex flex-wrap gap-1.5">
      {parts.map(([label, count, variant]) => (
        <Badge key={label} variant={variant} size="sm">
          {count} {label}
        </Badge>
      ))}
      {!diff.added.length && !diff.removed.length && !diff.updated.length ? (
        <Badge variant="slate" size="sm">{t('modelSync.preview.noChanges')}</Badge>
      ) : null}
    </div>
  );
}

function targetLabel(target: ModelSyncTarget): string {
  return target === 'opencode'
    ? t('modelSync.preview.targetOpencode')
    : t('modelSync.preview.targetOmp');
}

function commentsMayBeDropped(file: ModelSyncPreviewFile): boolean {
  return file.target === 'opencode' && file.exists && file.path.toLowerCase().endsWith('.jsonc');
}

interface SyncPreviewPanelProps {
  preview: ModelSyncPreviewResponse | null;
  isFresh: boolean;
  previewing: boolean;
  applying: boolean;
  canApply: boolean;
  conflictMismatches: ModelSyncShaMismatch[] | null;
  onPreview: () => void;
  onApply: () => void;
}

export function SyncPreviewPanel({
  preview,
  isFresh,
  previewing,
  applying,
  canApply,
  conflictMismatches,
  onPreview,
  onApply,
}: SyncPreviewPanelProps) {
  const files = preview?.files || [];
  const warnings = preview?.warnings || [];
  const errors = preview?.errors || [];
  const unknownModelIds = preview?.unknownModelIds || [];

  return (
    <GlassCard className="p-4" data-testid="model-sync-preview-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">{t('modelSync.preview.title')}</h2>
          <p className="mt-1 text-xs text-slate-500">{t('modelSync.preview.description')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onPreview}
            isLoading={previewing}
            leftIcon={<FileDiff size={14} />}
            data-testid="model-sync-preview-button"
          >
            {t('modelSync.preview.generate')}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={onApply}
            disabled={!canApply}
            isLoading={applying}
            leftIcon={<Play size={14} />}
            title={!canApply ? t('modelSync.preview.applyDisabled') : undefined}
            data-testid="model-sync-apply-button"
          >
            {applying ? t('modelSync.preview.applying') : t('modelSync.preview.apply')}
          </Button>
        </div>
      </div>

      <div className="mt-3">
        {!canApply ? (
          <p className="text-[11px] text-slate-500">{t('modelSync.preview.applyDisabled')}</p>
        ) : (
          <p className="text-[11px] text-emerald-300">{t('modelSync.preview.ready')}</p>
        )}
        {preview && !isFresh ? (
          <Badge variant="warning" size="sm" className="mt-2">
            {t('modelSync.preview.stale')}
          </Badge>
        ) : null}
      </div>

      {conflictMismatches?.length ? (
        <div
          className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3"
          data-testid="model-sync-conflict"
        >
          <div className="flex items-start gap-2">
            <ShieldAlert size={16} className="mt-0.5 shrink-0 text-red-300" />
            <div>
              <h3 className="text-sm font-semibold text-red-200">
                {t('modelSync.preview.conflictTitle')}
              </h3>
              <p className="mt-1 text-xs leading-5 text-red-200/80">
                {t('modelSync.preview.conflictDescription')}
              </p>
            </div>
          </div>
          <div className="mt-3 space-y-2">
            {conflictMismatches.map(mismatch => (
              <div key={mismatch.path} className="rounded border border-red-500/20 bg-black/20 p-2 text-xs">
                <div className="break-all font-mono text-red-100">{mismatch.path}</div>
                <div className="mt-1 text-red-200/80">{mismatch.error}</div>
                <div className="mt-1 grid gap-1 font-mono text-[10px] text-red-200/60 md:grid-cols-2">
                  <span>{t('modelSync.preview.conflictExpected')}: {mismatch.expected ?? '∅'}</span>
                  <span>{t('modelSync.preview.conflictActual')}: {mismatch.actual ?? '∅'}</span>
                </div>
              </div>
            ))}
          </div>
          <Badge variant="danger" size="sm" className="mt-3">
            {t('modelSync.preview.repreviewRequired')}
          </Badge>
        </div>
      ) : null}

      {!preview ? (
        <EmptyState
          compact
          icon={FileDiff}
          title={t('modelSync.preview.noPreview')}
          className="mt-4"
        />
      ) : (
        <div className="mt-4 space-y-4">
          {errors.length ? (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
              <h3 className="text-xs font-semibold text-red-300">{t('modelSync.preview.errors')}</h3>
              <ul className="mt-2 space-y-1 text-xs text-red-200">
                {errors.map(error => <li key={error}>{error}</li>)}
              </ul>
            </div>
          ) : null}

          {warnings.length ? (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <h3 className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                <AlertTriangle size={13} />
                {t('modelSync.preview.warnings')}
              </h3>
              <ul className="mt-2 space-y-1 text-xs text-amber-200/90">
                {warnings.map(warning => <li key={warning}>{warning}</li>)}
              </ul>
            </div>
          ) : null}

          {unknownModelIds.length ? (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
              {t('modelSync.preview.unknownModels')}: {unknownModelIds.join(', ')}
            </div>
          ) : null}

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t('modelSync.preview.summary')}
            </h3>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {(['opencode', 'omp'] as const).map(target => {
                const diff = preview.modelDiffs?.[target];
                if (!diff) return null;
                return (
                  <div key={target} className="rounded-lg border border-white/[0.06] bg-black/20 p-3">
                    <div className="mb-2 text-xs font-semibold text-slate-200">{targetLabel(target)}</div>
                    <DiffSummaryBadges diff={diff} />
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {t('modelSync.preview.files')}
            </h3>
            {files.length === 0 ? (
              <EmptyState
                compact
                icon={FileDiff}
                title={t('modelSync.preview.noFiles')}
                className="mt-2"
              />
            ) : (
              <div className="mt-2 space-y-2">
                {files.map(file => (
                  <details
                    key={`${file.kind}:${file.path}`}
                    className="rounded-lg border border-white/[0.06] bg-black/20"
                    open={file.changed && files.length <= 2}
                  >
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 p-3">
                      <Badge variant={file.changed ? 'warning' : 'slate'} size="sm">
                        {file.changed ? t('modelSync.preview.updated') : t('modelSync.preview.unchanged')}
                      </Badge>
                      <Badge variant="outline" size="sm">{file.kind}</Badge>
                      <span className="min-w-0 flex-1 break-all font-mono text-xs text-slate-200">
                        {file.path}
                      </span>
                      {commentsMayBeDropped(file) ? (
                        <Badge variant="warning" size="sm">
                          {t('modelSync.preview.commentsMayBeDropped')}
                        </Badge>
                      ) : null}
                    </summary>
                    <div className="border-t border-white/[0.06] p-3">
                      {file.diff ? (
                        <pre className="max-h-80 overflow-auto rounded bg-black/40 p-3 text-[11px] leading-5 text-slate-300">
                          {redactDiffCredentials(file.diff)}
                        </pre>
                      ) : (
                        <p className="text-xs text-slate-500">{t('modelSync.preview.noDiff')}</p>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </GlassCard>
  );
}
