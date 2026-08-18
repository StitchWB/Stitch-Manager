import { Button, Textarea } from '@/components/ui';
import { t } from '@/lib/i18n';
import type { ScenarioReplayStatus } from '@/lib/scenarioRecorder/useScenarioReplay';
import type { ScenarioRunnerMode } from '@/lib/scenarioRecorder/types';

type TimelineEntry = { ts: string; level: string; message: string };

type StepEvent = {
  ts: string;
  index: number;
  total: number;
  kind: string;
  status: 'start' | 'done' | 'fail';
  selector?: string | null;
  url?: string | null;
  error?: string | null;
};

type ReplayDiagnosticsPanelProps = {
  status: ScenarioReplayStatus;
  progressLabel: string;
  manualPauseReason: string | null;
  runtimeInstalled: boolean | null;
  runtimeCheckError: string | null;
  runtimeChecking: boolean;
  onRefreshRuntime: () => void;
  configJson: string;
  onConfigJsonChange: (value: string) => void;
  loadingSettings: boolean;
  stderr: Array<{ ts: string; line: string }>;
  lastFailedStep: StepEvent | null;
  error: string | null;
  reportPath: string | null;
  hasDiagnosticsPaths: boolean;
  onCopyReportPath: () => void;
  onOpenReportFolder: () => void;
  timelineEntries: TimelineEntry[];
  timelineLoading: boolean;
  runnerMode: ScenarioRunnerMode;
};

export function ReplayDiagnosticsPanel({
  status,
  progressLabel,
  manualPauseReason,
  runtimeInstalled,
  runtimeCheckError,
  runtimeChecking,
  onRefreshRuntime,
  configJson,
  onConfigJsonChange,
  loadingSettings,
  stderr,
  lastFailedStep,
  error,
  reportPath,
  hasDiagnosticsPaths,
  onCopyReportPath,
  onOpenReportFolder,
  timelineEntries,
  timelineLoading,
  runnerMode,
}: ReplayDiagnosticsPanelProps) {
  const isNativeRunner = runnerMode === 'native';

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-slate-300">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <div className="text-slate-400">{t('recorder.replay.statusLabel')}</div>
            <div className="text-slate-200 capitalize">{status}</div>
          </div>
          <div>
            <div className="text-slate-400">{t('recorder.replay.progressLabel')}</div>
            <div className="text-slate-200">{progressLabel}</div>
          </div>
          <div>
            <div className="text-slate-400">{t('recorder.replay.manualPause')}</div>
            <div className="text-slate-200 truncate">{manualPauseReason ?? '—'}</div>
          </div>
        </div>
      </div>

      {isNativeRunner ? (
        <div
          className={`rounded-lg border p-3 ${
            runtimeInstalled === true
              ? 'border-emerald-500/20 bg-emerald-500/5'
              : runtimeInstalled === false
                ? 'border-amber-500/20 bg-amber-500/5'
                : 'border-white/10 bg-black/20'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-400">{t('recorder.replay.runtimeSection')}</div>
            <Button
              size="xs"
              variant="secondary"
              onClick={onRefreshRuntime}
              disabled={runtimeChecking}
            >
              {runtimeChecking ? t('common.loading') : t('common.refresh')}
            </Button>
          </div>
          <div className="mt-2 text-sm text-slate-200">
            {runtimeInstalled === true
              ? t('recorder.replay.runtimeInstalled')
              : runtimeInstalled === false
                ? t('recorder.replay.runtimeNotInstalled')
                : t('recorder.replay.runtimeUnknown')}
          </div>
          {runtimeCheckError ? (
            <div className="mt-1 text-xs text-red-300">{runtimeCheckError}</div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-3 text-xs text-cyan-100">
          {t('recorder.extensionRunnerBridgeHint')}
        </div>
      )}

      <div className="rounded-lg border border-white/10 bg-black/20 p-3">
        <div className="text-xs text-slate-400">{t('recorder.replay.runnerConfig')}</div>
        <div className="text-[11px] text-slate-500">
          {loadingSettings
            ? t('recorder.replay.loadingSettings')
            : t('recorder.replay.fromProfile')}
        </div>
        <Textarea
          containerClassName="mt-2"
          className="h-24 min-h-[96px] rounded-md px-2 py-1 text-xs font-mono resize-none"
          value={configJson}
          onChange={e => onConfigJsonChange(e.target.value)}
          placeholder="{}"
        />
      </div>

      {stderr.length > 0 && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
          <div className="text-xs text-red-200 mb-2">{t('recorder.replay.pythonStderr')}</div>
          <div className="max-h-32 overflow-auto space-y-1">
            {stderr.slice(0, 30).map((e, idx) => (
              <div key={`${e.ts}-${idx}`} className="text-[11px] font-mono text-red-200/90">
                {e.line}
              </div>
            ))}
          </div>
        </div>
      )}

      {(lastFailedStep || error) && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
          <div className="text-xs text-red-200 mb-2">{t('recorder.replay.failureDetails')}</div>
          <div className="space-y-1 text-xs text-red-100">
            {lastFailedStep ? (
              <>
                <div>
                  {t('recorder.replay.failureStep')}: {lastFailedStep.index}/{lastFailedStep.total}{' '}
                  • {lastFailedStep.kind}
                </div>
                {lastFailedStep.selector ? (
                  <div>
                    {t('recorder.replay.failureSelector')}: {lastFailedStep.selector}
                  </div>
                ) : null}
                {lastFailedStep.url ? (
                  <div>
                    {t('recorder.replay.failureUrl')}: {lastFailedStep.url}
                  </div>
                ) : null}
                {lastFailedStep.error ? (
                  <div>
                    {t('recorder.replay.failureError')}: {lastFailedStep.error}
                  </div>
                ) : null}
              </>
            ) : null}
            {error ? (
              <div>
                {t('recorder.replay.failureRunner')}: {error}
              </div>
            ) : null}
            {reportPath ? (
              <div>
                {t('recorder.replay.failureReport')}: {reportPath}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {hasDiagnosticsPaths && reportPath ? (
        <div className="flex flex-wrap gap-2">
          <Button size="xs" variant="secondary" onClick={onCopyReportPath}>
            {t('recorder.replay.copyReportPath')}
          </Button>
          <Button size="xs" variant="secondary" onClick={onOpenReportFolder}>
            {t('recorder.replay.openReportFolder')}
          </Button>
        </div>
      ) : null}

      <div className="rounded-lg border border-white/10 bg-black/20 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs text-slate-400">{t('recorder.replay.timelineTitle')}</div>
          {timelineLoading ? (
            <div className="text-[11px] text-slate-500">{t('recorder.replay.refreshing')}</div>
          ) : null}
        </div>
        <div className="max-h-36 overflow-auto space-y-1">
          {timelineEntries.length === 0 ? (
            <div className="text-xs text-slate-500">{t('recorder.replay.timelineEmpty')}</div>
          ) : (
            timelineEntries.slice(0, 80).map((entry, idx) => (
              <div key={`${entry.ts}-${idx}`} className="text-[11px] font-mono text-slate-200">
                <span className="text-slate-500 mr-2">
                  {new Date(entry.ts).toLocaleTimeString('en-US', {
                    hour12: false,
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
                <span
                  className={`mr-2 ${
                    entry.level === 'error'
                      ? 'text-red-300'
                      : entry.level === 'warn'
                        ? 'text-amber-300'
                        : 'text-slate-300'
                  }`}
                >
                  {entry.level.toUpperCase()}
                </span>
                <span>{entry.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
