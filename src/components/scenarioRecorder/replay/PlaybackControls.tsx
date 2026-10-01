import { Button, Checkbox } from '@/components/ui';
import { t } from '@/lib/i18n';

type PlaybackControlsProps = {
  retryFromFailedStep: boolean;
  onRetryFromFailedStepChange: (checked: boolean) => void;
  lastFailedStep: { index: number } | null;
  explicitRetryStep: number | null;
  onSelectExplicitRetryStep: (step: number) => void;
};

export function PlaybackControls({
  retryFromFailedStep,
  onRetryFromFailedStepChange,
  lastFailedStep,
  explicitRetryStep,
  onSelectExplicitRetryStep
}: PlaybackControlsProps) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <Checkbox
          label={t('recorder.replay.retryFromFailedStep')}
          checked={retryFromFailedStep}
          onChange={(e) => onRetryFromFailedStepChange(e.target.checked)}
          className="text-xs text-slate-300"
        />
        <Button
          size="xs"
          variant="ghost"
          className="text-xs text-indigo-300 hover:text-indigo-200 disabled:text-slate-500"
          disabled={!lastFailedStep?.index || lastFailedStep.index <= 1}
          onClick={() => {
            if (!lastFailedStep?.index || lastFailedStep.index <= 1) return;
            onSelectExplicitRetryStep(lastFailedStep.index);
          }}>

          {lastFailedStep?.index && lastFailedStep.index > 1 ?
          t('recorder.replay.retryFromStepAction', { step: lastFailedStep.index }) :
          t('recorder.replay.retryFromStepUnavailable')}
        </Button>
      </div>
      {explicitRetryStep ?
      <div className="mt-2 text-[11px] text-indigo-300">
          {t('recorder.replay.retryFromStepSelected', { step: explicitRetryStep })}
        </div> :
      null}
    </div>);

}
