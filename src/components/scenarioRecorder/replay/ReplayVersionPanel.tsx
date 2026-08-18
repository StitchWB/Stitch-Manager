import { Button, Select } from '@/components/ui';
import { t } from '@/lib/i18n';
import type { ScenarioRevisionItem } from '@/lib/backend/modules/pythonJobs';

type ReplayVersionPanelProps = {
  loading: boolean;
  error: string | null;
  versions: Array<ScenarioRevisionItem & {isActive: boolean;}>;
  selectedVersionNo: number | null;
  onSelectedVersionNoChange: (value: number | null) => void;
  rollbackLoading: boolean;
  runSelectedLoading: boolean;
  selectedVersionHasRunnablePath: boolean;
  onRollbackSelected: () => void;
  onRunSelected: () => void;
};

export function ReplayVersionPanel({
  loading,
  error,
  versions,
  selectedVersionNo,
  onSelectedVersionNoChange,
  rollbackLoading,
  runSelectedLoading,
  selectedVersionHasRunnablePath,
  onRollbackSelected,
  onRunSelected
}: ReplayVersionPanelProps) {
  const hasVersions = versions.length > 0;

  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-3">
      <div className="text-xs text-slate-400">{t('recorder.replay.versionTitle')}</div>

      {loading ? <div className="text-xs text-slate-500">{t('common.loading')}</div> : null}
      {!loading && error ?
      <div className="text-xs text-amber-300">
          {t('recorder.replay.versionLoadError', { error })}
        </div> :
      null}

      {!loading && !error ?
      <>
          <Select
          value={selectedVersionNo == null ? '' : String(selectedVersionNo)}
          onValueChange={(value) => {
            const next = Number(value);
            onSelectedVersionNoChange(Number.isFinite(next) && next > 0 ? next : null);
          }}
          disabled={!hasVersions}>

            <option value="">{t('recorder.replay.versionSelect')}</option>
            {versions.map((version) =>
          <option key={version.id} value={String(version.versionNo)}>
                {t('recorder.replay.versionPrefix')}{version.versionNo}
                {version.isActive ? ` • ${t('recorder.replay.versionCurrent')}` : ''}
              </option>
          )}
          </Select>

          {selectedVersionNo != null ?
        <div className="text-[11px] text-slate-500">
              {t('recorder.replay.versionSelected')}{t("recorder.replay_version_panel.v")}{selectedVersionNo}
            </div> :
        null}

          <div className="flex flex-wrap gap-2">
            <Button
            size="xs"
            disabled={
            selectedVersionNo == null || !selectedVersionHasRunnablePath || runSelectedLoading
            }
            onClick={onRunSelected}
            isLoading={runSelectedLoading}>

              {t('recorder.replay.versionRunAction')}
            </Button>
            <Button
            size="xs"
            variant="secondary"
            disabled={selectedVersionNo == null || rollbackLoading}
            onClick={onRollbackSelected}
            isLoading={rollbackLoading}>

              {t('recorder.replay.versionRollbackAction')}
            </Button>
          </div>
        </> :
      null}
    </div>);

}