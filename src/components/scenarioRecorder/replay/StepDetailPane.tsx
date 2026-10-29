import { t } from '@/lib/i18n';
import type { ReplayPreflightResult } from '@/lib/backend/modules/pythonJobs';

type StepDetailPaneProps = {
  scenarioPath: string;
  scenarioName: string;
  preflight: ReplayPreflightResult | null;
  lastEvent: string | null;
  progressLabel: string;
};

export function StepDetailPane({
  scenarioPath,
  scenarioName,
  preflight,
  lastEvent,
  progressLabel
}: StepDetailPaneProps) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-3">
      <div>
        <div className="text-xs text-slate-400">
          {t('recorder.replay.selectedScenario')}
        </div>
        <div className="text-sm text-slate-200">
          {scenarioName}
        </div>
        {scenarioPath ?
        <div className="text-[11px] text-slate-500 font-mono break-all">
            {scenarioPath}
          </div> :

        <div className="text-[11px] text-slate-500">
            {t('recorder.replay.noScenarioLoaded')}
          </div>
        }
      </div>
      <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-slate-300">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-slate-400">{t('recorder.replay.stepsLabel')}</div>
            <div className="text-slate-200">{preflight?.totalSteps ?? '—'}</div>
          </div>
          <div>
            <div className="text-slate-400">
              {t('recorder.replay.healthScoreLabel')}
            </div>
            <div className="text-slate-200">{preflight?.healthScore ?? '—'}</div>
          </div>
          <div>
            <div className="text-slate-400">{t('recorder.replay.lastEvent')}</div>
            <div className="text-slate-200 truncate">
              {lastEvent ?? '—'}
            </div>
          </div>
          <div>
            <div className="text-slate-400">{t('recorder.replay.progressLabel')}</div>
            <div className="text-slate-200">{progressLabel}</div>
          </div>
        </div>
      </div>
    </div>);

}
