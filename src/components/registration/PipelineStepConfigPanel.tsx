import { useState, useCallback } from 'react';
import { Pause, ToggleLeft, ToggleRight, ChevronDown } from 'lucide-react';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/utils';

export interface PipelineStepOverride {
  id: string;
  label: string;
  enabled: boolean;
  pauseAfter: boolean;
  skippable: boolean;
}

interface PipelineStepConfigPanelProps {
  steps: PipelineStepOverride[];
  onChange: (steps: PipelineStepOverride[]) => void;
  disabled?: boolean;
}

export function PipelineStepConfigPanel({
  steps,
  onChange,
  disabled = false,
}: PipelineStepConfigPanelProps) {
  const [expanded, setExpanded] = useState(false);

  const toggleEnabled = useCallback(
    (id: string) => {
      const next = steps.map(s => (s.id === id ? { ...s, enabled: !s.enabled } : s));
      onChange(next);
    },
    [steps, onChange]
  );

  const togglePause = useCallback(
    (id: string) => {
      const next = steps.map(s => (s.id === id ? { ...s, pauseAfter: !s.pauseAfter } : s));
      onChange(next);
    },
    [steps, onChange]
  );

  if (steps.length === 0) return null;

  const activePauses = steps.filter(s => s.pauseAfter).length;

  return (
    <div className={cn('border-t border-white/5', disabled && 'opacity-50 pointer-events-none')}>
      {/* Collapsible header — always visible, one line */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider">
            {t('autoReg.pipelineSteps')}
          </span>
          {activePauses > 0 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-medium">
              {activePauses} {t('autoReg.pause').toLowerCase()}
            </span>
          )}
        </div>
        <ChevronDown
          className={cn(
            'w-3.5 h-3.5 text-slate-600 transition-transform',
            expanded && 'rotate-180'
          )}
        />
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-0.5">
          {steps.map((step) => (
            <div
              key={step.id}
              className={cn(
                'flex items-center gap-2 py-0.5 rounded px-1.5',
                step.enabled ? 'hover:bg-white/[0.02]' : 'opacity-50'
              )}
            >
              {/* Tiny dot indicator */}
              <div
                className={cn(
                  'w-1.5 h-1.5 rounded-full shrink-0',
                  step.enabled ? 'bg-slate-500' : 'bg-slate-700'
                )}
              />

              {/* Label */}
              <span
                className={cn(
                  'text-[11px] flex-1 truncate',
                  step.enabled ? 'text-slate-400' : 'text-slate-600 line-through'
                )}
              >
                {step.label}
              </span>

              {/* Compact controls */}
              <div className="flex items-center gap-0.5 shrink-0">
                {/* Enable/disable — tiny icon */}
                <button
                  onClick={() => toggleEnabled(step.id)}
                  className={cn(
                    'p-1 rounded transition-colors',
                    step.enabled
                      ? 'text-emerald-500/60 hover:text-emerald-400 hover:bg-emerald-500/10'
                      : 'text-slate-700 hover:text-slate-500 hover:bg-white/5'
                  )}
                  title={step.enabled ? t('autoReg.stepEnabled') : t('autoReg.stepDisabled')}
                >
                  {step.enabled ? (
                    <ToggleRight className="w-3.5 h-3.5" />
                  ) : (
                    <ToggleLeft className="w-3.5 h-3.5" />
                  )}
                </button>

                {/* Pause after — only icon */}
                <button
                  onClick={() => togglePause(step.id)}
                  className={cn(
                    'p-1 rounded transition-colors',
                    step.pauseAfter
                      ? 'text-amber-400 hover:text-amber-300 hover:bg-amber-500/10'
                      : 'text-slate-700 hover:text-slate-500 hover:bg-white/5'
                  )}
                  title={
                    step.pauseAfter
                      ? t('autoReg.pipeline.unsetPause')
                      : t('autoReg.pipeline.setPause')
                  }
                >
                  <Pause className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
