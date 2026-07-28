import { Button, Checkbox, Input, Textarea } from '@/components/ui';
import { t } from '@/lib/i18n';
import type { ReplayPreflightResult } from '@/lib/backend/modules/pythonJobs';
import type { ScenarioReplayStatus } from '@/lib/scenarioRecorder/useScenarioReplay';
import type { ScenarioRunnerMode } from '@/lib/scenarioRecorder/types';

type ReplayOverviewPanelProps = {
  scenarioPath: string;
  onScenarioPathChange: (value: string) => void;
  preflight: ReplayPreflightResult | null;
  preflightLoading: boolean;
  loadingSettings: boolean;
  configJson: string;
  onConfigJsonChange: (value: string) => void;
  startUrl: string;
  onStartUrlChange: (value: string) => void;
  continueOnError: boolean;
  onContinueOnErrorChange: (value: boolean) => void;
  runtimeInstalled: boolean | null;
  runtimeCheckError: string | null;
  status: ScenarioReplayStatus;
  progressLabel: string;
  manualPauseReason: string | null;
  runtimeChecking: boolean;
  onRefreshRuntime: () => void;
  runnerMode: ScenarioRunnerMode;
};

export function ReplayOverviewPanel({
  scenarioPath,
  onScenarioPathChange,
  preflight,
  preflightLoading,
  loadingSettings,
  configJson,
  onConfigJsonChange,
  startUrl,
  onStartUrlChange,
  continueOnError,
  onContinueOnErrorChange,
  runtimeInstalled,
  runtimeCheckError,
  status,
  progressLabel,
  manualPauseReason,
  runtimeChecking,
  onRefreshRuntime,
  runnerMode,
}: ReplayOverviewPanelProps) {
  const isNativeRunner = runnerMode === 'native';

  return (
    <div className="space-y-3">
      <Input
        label={t('recorder.replay.scenarioPath')}
        value={scenarioPath}
        onChange={e => onScenarioPathChange(e.target.value)}
        placeholder={t('recorder.replay.scenarioPathPlaceholder')}
        className="h-9"
      />

      <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-2">
        <div className="text-xs text-slate-400">{t('recorder.replay.runHealth')}</div>
        {preflightLoading ? (
          <div className="text-xs text-slate-500">{t('recorder.replay.validating')}</div>
        ) : preflight ? (
          <div className="space-y-1 text-xs">
            <div className="text-slate-200">
              {t('recorder.replay.validLabel')}:{' '}
              {preflight.valid ? t('common.yes') : t('common.no')} •{' '}
              {t('recorder.replay.stepsLabel')}: {preflight.totalSteps} •{' '}
              {t('recorder.replay.droppedLabel')}: {preflight.droppedSteps}
            </div>
            <div className="text-slate-200 font-semibold">
              {t('recorder.replay.healthScoreLabel')}: {preflight.healthScore}/100
            </div>
            {preflight.healthNotes.some(note => note.includes('proxy.switch')) ? (
              <div className="text-amber-300">{t('proxyLibrary.stepRestartBoundary')}</div>
            ) : null}
            {preflight.issues.length > 0 && (
              <div className="text-amber-300">
                {t('recorder.replay.issuesLabel')}{' '}
                {preflight.issues
                  .slice(0, 5)
                  .map(i => `#${i.index} ${i.reason}`)
                  .join(' • ')}
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-slate-500">{t('recorder.replay.noScenarioLoaded')}</div>
        )}
      </div>

      {isNativeRunner ? (
        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-400">{t('recorder.replay.runtimeSection')}</div>
              <div className="text-sm text-slate-200">
                {runtimeInstalled === true
                  ? t('recorder.replay.runtimeInstalled')
                  : runtimeInstalled === false
                    ? t('recorder.replay.runtimeNotInstalled')
                    : t('recorder.replay.runtimeUnknown')}
              </div>
            </div>
            <Button
              size="xs"
              variant="ghost"
              onClick={onRefreshRuntime}
              disabled={runtimeChecking}
              className="text-xs text-slate-400 hover:text-slate-200"
            >
              {runtimeChecking ? t('common.loading') : t('common.refresh')}
            </Button>
          </div>
          {runtimeCheckError ? (
            <div className="mt-2 text-xs text-red-300">{runtimeCheckError}</div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-4 text-xs text-cyan-100">
          {t('recorder.extensionRunnerBridgeHint')}
        </div>
      )}

      <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-xs text-slate-300">
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

      <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-3">
        <Input
          label={t('recorder.replay.startUrl')}
          value={startUrl}
          onChange={e => onStartUrlChange(e.target.value)}
          className="h-9"
        />

        <div className="h-9 px-2 rounded-md border border-white/10 bg-black/30 inline-flex items-center">
          <Checkbox
            checked={continueOnError}
            onChange={e => onContinueOnErrorChange(e.target.checked)}
            label={t('recorder.replay.continueOnError')}
            className="py-0 px-0 hover:bg-transparent"
          />
        </div>

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
      </div>
    </div>
  );
}
