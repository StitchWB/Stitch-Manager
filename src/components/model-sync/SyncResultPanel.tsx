import { Link } from 'react-router-dom';
import { CheckCircle2, ExternalLink, RotateCcw } from 'lucide-react';

import { Badge, Button, GlassCard } from '@/components/ui';
import type {
  ModelSyncApplyFileResult,
  ModelSyncApplyResponse,
} from '@/lib/backend/modules/modelSync';
import { t } from '@/lib/i18n';

interface SyncResultPanelProps {
  result: ModelSyncApplyResponse | null;
  restoringPath: string | null;
  restoreMessage: string | null;
  restoreError: string | null;
  onRestore: (file: ModelSyncApplyFileResult) => void;
}

export function SyncResultPanel({
  result,
  restoringPath,
  restoreMessage,
  restoreError,
  onRestore,
}: SyncResultPanelProps) {
  if (!result) return null;
  const files = result.files || [];
  const writtenCount = files.filter(file => file.written).length;

  return (
    <GlassCard className="p-4" data-testid="model-sync-result-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${result.ok ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>
            <CheckCircle2 size={17} />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-100">{t('modelSync.result.title')}</h2>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badge variant={result.ok ? 'success' : 'danger'} size="sm">
                {t('modelSync.result.filesWritten')}: {writtenCount}
              </Badge>
              {result.schema ? (
                <Badge variant="slate" size="sm">
                  {t('modelSync.result.schema')}: {result.schema}
                </Badge>
              ) : null}
            </div>
          </div>
        </div>
        <Link to="/ai/opencode-config" className="inline-flex items-center gap-1.5 text-xs text-indigo-300 hover:text-indigo-200">
          {t('modelSync.result.advancedLink')}
          <ExternalLink size={12} />
        </Link>
      </div>

      {result.ok ? (
        <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-200">
          <span className="font-semibold">{t('modelSync.result.verification')}: </span>
          {t('modelSync.result.verificationPassed')}
        </div>
      ) : null}

      {result.error ? (
        <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-200">
          <span className="font-semibold">{t('modelSync.result.error')}: </span>
          {result.error}
        </div>
      ) : null}

      {result.warnings?.length ? (
        <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
          <h3 className="text-xs font-semibold text-amber-300">{t('modelSync.result.warnings')}</h3>
          <ul className="mt-2 space-y-1 text-xs text-amber-200/90">
            {result.warnings.map(warning => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      ) : null}

      {restoreMessage ? (
        <p className="mt-3 text-xs text-emerald-300" data-testid="model-sync-restore-success">
          {restoreMessage}
        </p>
      ) : null}
      {restoreError ? (
        <p className="mt-3 text-xs text-red-300" data-testid="model-sync-restore-error">
          {restoreError}
        </p>
      ) : null}

      <div className="mt-4 space-y-2">
        {files.length === 0 ? (
          <p className="text-xs text-slate-500">{t('modelSync.result.noFiles')}</p>
        ) : (
          files.map(file => (
            <div key={file.path} className="rounded-lg border border-white/[0.06] bg-black/20 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={file.error ? 'danger' : file.written ? 'success' : file.skipped ? 'warning' : 'slate'}
                  size="sm"
                >
                  {file.error
                    ? t('modelSync.result.error')
                    : file.written
                      ? t('modelSync.preview.updated')
                      : file.skipped
                        ? t('modelSync.result.skipped')
                        : t('modelSync.result.unchanged')}
                </Badge>
                <Badge variant="outline" size="sm">{file.kind}</Badge>
                <span className="min-w-0 flex-1 break-all font-mono text-xs text-slate-200">
                  {file.path}
                </span>
                {file.backupPath ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => onRestore(file)}
                    isLoading={restoringPath === file.path}
                    leftIcon={<RotateCcw size={12} />}
                  >
                    {restoringPath === file.path
                      ? t('modelSync.result.restoring')
                      : t('modelSync.result.restore')}
                  </Button>
                ) : null}
              </div>
              <div className="mt-2 grid gap-1 text-[11px] text-slate-500">
                {file.backupPath ? (
                  <div>
                    {t('modelSync.result.backupPath')}: <span className="break-all font-mono">{file.backupPath}</span>
                  </div>
                ) : null}
                <div>
                  {t('modelSync.result.rollbackStatus')}: {file.rolledBack
                    ? t('modelSync.result.rolledBack')
                    : t('modelSync.result.notRolledBack')}
                  {file.rollbackError ? ` — ${file.rollbackError}` : ''}
                </div>
                {file.error ? <div className="text-red-300">{file.error}</div> : null}
              </div>
            </div>
          ))
        )}
      </div>
    </GlassCard>
  );
}
