import { useState } from 'react';
import { Play, Square, Pause, ChevronDown, ToggleLeft, ToggleRight } from 'lucide-react';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/utils';
import { Button, GlassCard, Badge, Input } from '@/components/ui';
import { registrationControl } from '../../lib/tauri';
import type { PipelineStepOverride } from './PipelineStepConfigPanel';

interface LaunchPadProps {
  count: number;
  onCountChange: (count: number) => void;
  isRunning: boolean;
  canStart: boolean;
  pythonAvailable: boolean | null;
  onStart: () => void;
  onStop: () => void;
  jobId?: string | null;
  pipelineSteps?: PipelineStepOverride[];
  onPipelineStepsChange?: (steps: PipelineStepOverride[]) => void;
}

export function LaunchPad({
  count,
  onCountChange,
  isRunning,
  canStart,
  pythonAvailable,
  onStart,
  onStop,
  jobId,
  pipelineSteps,
  onPipelineStepsChange,
}: LaunchPadProps) {
  const [showStepConfig, setShowStepConfig] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const isPythonBlocked = pythonAvailable === false;
  const startBlocked = !canStart || isPythonBlocked;

  const handlePauseResume = async () => {
    if (!jobId) return;
    try {
      await registrationControl(jobId, isPaused ? 'resume' : 'pause');
      setIsPaused(!isPaused);
    } catch {
      // ignore
    }
  };

  return (
    <GlassCard className="shrink-0 border-indigo-500/20 bg-gradient-to-b from-indigo-500/[0.06] to-transparent">
      <div className="flex items-center gap-3 p-3">
        {/* Count Input */}
        <Input
          type="number"
          min={1}
          max={100}
          value={count.toString()}
          onChange={e => onCountChange(parseInt(e.target.value) || 1)}
          disabled={isRunning}
          className="w-16 text-center font-mono font-bold text-lg tabular-nums text-white"
          containerClassName="w-16"
        />

        {/* Start/Stop/Pause Buttons */}
        {!isRunning ? (
          <Button
            type="button"
            onClick={onStart}
            disabled={startBlocked}
            variant="primary"
            size="lg"
            leftIcon={<Play className="w-4 h-4" />}
            className="flex-1"
          >
            {t('autoReg.start')}
          </Button>
        ) : (
          <div className="flex-1 flex items-center gap-2">
            <Button
              type="button"
              onClick={handlePauseResume}
              variant="secondary"
              size="lg"
              leftIcon={<Pause className="w-4 h-4" />}
              className="flex-1"
            >
              {isPaused ? t('autoReg.resume') : t('autoReg.pause')}
            </Button>
            <Button
              type="button"
              onClick={onStop}
              variant="danger"
              size="lg"
              leftIcon={<Square className="w-4 h-4" />}
              className="flex-1"
            >
              {t('autoReg.stop')}
            </Button>
          </div>
        )}
      </div>

      {/* Status indicator */}
      <div className="flex items-center justify-end gap-2 px-3 pb-3">
        {isPythonBlocked ? (
          <Badge variant="danger" size="sm">Python авто-рег недоступен</Badge>
        ) : canStart ? (
          <Badge variant="success" size="sm" withDot withPulse>{t('autoReg.readyToStart')}</Badge>
        ) : (
          <Badge variant="warning" size="sm">{t('autoReg.configureMailFirst')}</Badge>
        )}
      </div>

      {/* Collapsible step config */}
      {pipelineSteps && pipelineSteps.length > 0 && onPipelineStepsChange && (
        <div className="border-t border-white/5">
          <button
            onClick={() => setShowStepConfig(!showStepConfig)}
            className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-white/[0.02] transition-colors"
          >
            <span className="text-[10px] text-slate-500">
              {t('autoReg.pipelineSteps')}
            </span>
            <ChevronDown
              className={cn(
                'w-3 h-3 text-slate-600 transition-transform',
                showStepConfig && 'rotate-180'
              )}
            />
          </button>

          {showStepConfig && (
            <div className="px-3 pb-2 space-y-0.5">
              {pipelineSteps.map(step => (
                <div key={step.id} className="flex items-center gap-2 py-0.5">
                  <div
                    className={cn(
                      'w-1.5 h-1.5 rounded-full shrink-0',
                      step.enabled ? 'bg-indigo-400' : 'bg-slate-700'
                    )}
                  />
                  <span
                    className={cn(
                      'text-[11px] flex-1 truncate',
                      step.enabled ? 'text-slate-400' : 'text-slate-600 line-through'
                    )}
                  >
                    {step.label}
                  </span>
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={() =>
                        onPipelineStepsChange(
                          pipelineSteps.map(s =>
                            s.id === step.id ? { ...s, enabled: !s.enabled } : s
                          )
                        )
                      }
                      className={cn(
                        'p-0.5 rounded',
                        step.enabled ? 'text-emerald-500/60' : 'text-slate-700'
                      )}
                    >
                      {step.enabled ? (
                        <ToggleRight className="w-3.5 h-3.5" />
                      ) : (
                        <ToggleLeft className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      onClick={() =>
                        onPipelineStepsChange(
                          pipelineSteps.map(s =>
                            s.id === step.id ? { ...s, pauseAfter: !s.pauseAfter } : s
                          )
                        )
                      }
                      className={cn(
                        'p-0.5 rounded',
                        step.pauseAfter ? 'text-amber-400' : 'text-slate-700'
                      )}
                    >
                      <Pause className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {isPythonBlocked && (
        <div className="px-3 pb-3 text-xs text-slate-500">
          Установите Python + DrissionPage
        </div>
      )}
    </GlassCard>
  );
}
