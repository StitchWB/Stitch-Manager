import { useState, useCallback, useEffect, useRef } from 'react';
import { Pause, ToggleLeft, ToggleRight, ChevronDown } from 'lucide-react';
import { IconButton } from '@/components/ui';
import { t } from '@/lib/i18n';
import { cn } from '../../lib/utils';

const STORAGE_KEY = 'pipeline-steps-panel-expanded';
export const STORAGE_KEY_ENABLED = 'pipeline-steps-enabled';
export const STORAGE_KEY_PAUSE = 'pipeline-steps-pause';

export function loadEnabledOverrides(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ENABLED);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveEnabledOverrides(map: Record<string, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY_ENABLED, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export function loadPauseOverrides(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PAUSE);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function savePauseOverrides(map: Record<string, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY_PAUSE, JSON.stringify(map));
  } catch {
    // ignore
  }
}

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
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const appliedStepsRef = useRef<string>('');

  // Apply persisted enabled and pause overrides when steps change (first mount or new pipeline)
  useEffect(() => {
    if (steps.length === 0) return;
    const stepsKey = steps.map(s => s.id).join(',');
    if (appliedStepsRef.current === stepsKey) return;
    appliedStepsRef.current = stepsKey;

    const enabledOverrides = loadEnabledOverrides();
    const pauseOverrides = loadPauseOverrides();
    const hasEnabledOverrides = steps.some(s => enabledOverrides[s.id] !== undefined && enabledOverrides[s.id] !== s.enabled);
    const hasPauseOverrides = steps.some(s => pauseOverrides[s.id] !== undefined && pauseOverrides[s.id] !== s.pauseAfter);
    if (hasEnabledOverrides || hasPauseOverrides) {
      const next = steps.map(s => ({
        ...s,
        enabled: enabledOverrides[s.id] !== undefined ? enabledOverrides[s.id] : s.enabled,
        pauseAfter: pauseOverrides[s.id] !== undefined ? pauseOverrides[s.id] : s.pauseAfter,
      }));
      onChange(next);
    }
  }, [steps, onChange]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, expanded ? 'true' : 'false');
    } catch {
      // ignore
    }
  }, [expanded]);

  const toggleEnabled = useCallback(
    (id: string) => {
      const next = steps.map(s => (s.id === id ? { ...s, enabled: !s.enabled } : s));
      const overrides = loadEnabledOverrides();
      const step = next.find(s => s.id === id);
      if (step) {
        overrides[id] = step.enabled;
        saveEnabledOverrides(overrides);
      }
      onChange(next);
    },
    [steps, onChange]
  );

  const togglePause = useCallback(
    (id: string) => {
      const next = steps.map(s => (s.id === id ? { ...s, pauseAfter: !s.pauseAfter } : s));
      const step = next.find(s => s.id === id);
      if (step) {
        const overrides = loadPauseOverrides();
        overrides[id] = step.pauseAfter;
        savePauseOverrides(overrides);
      }
      onChange(next);
    },
    [steps, onChange]
  );

  if (steps.length === 0) return null;

  const activePauses = steps.filter(s => s.pauseAfter).length;
  const disabledCount = steps.filter(s => !s.enabled).length;

  return (
    <div className={cn('border-t border-white/5', disabled && 'opacity-50 pointer-events-none')}>
      {/* Collapsible header — always visible, one line */}
      <div
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2 hover:bg-white/[0.04] transition-colors cursor-pointer"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded); }}}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm text-white font-bold uppercase tracking-wide drop-shadow-sm">
            {t('autoReg.pipelineSteps')}
          </span>
          {activePauses > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-medium border border-amber-500/20">
              {activePauses} {t('autoReg.pause').toLowerCase()}
            </span>
          )}
          {disabledCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-500/15 text-slate-400 font-medium border border-slate-500/20">
              {disabledCount} {t('autoReg.disabled').toLowerCase()}
            </span>
          )}
        </div>
        <ChevronDown
          className={cn(
            'w-4 h-4 text-slate-400 transition-transform',
            expanded && 'rotate-180'
          )}
        />
      </div>

      {expanded && (
        <div className="px-4 pb-3 space-y-0.5">
          {steps.map((step) => (
            <div
              key={step.id}
              className={cn(
                'flex items-center gap-2 py-1 rounded px-2 transition-colors',
                step.enabled ? 'hover:bg-white/[0.06]' : 'opacity-50 hover:bg-white/[0.03]'
              )}
            >
              {/* Status indicator */}
              <div
                className={cn(
                  'w-2 h-2 rounded-full shrink-0',
                  step.enabled ? 'bg-emerald-500/80' : 'bg-red-400/60'
                )}
              />

              {/* Label */}
              <span
                className={cn(
                  'text-xs flex-1 truncate select-none',
                  step.enabled ? 'text-slate-300' : 'text-red-400/80 line-through'
                )}
              >
                {step.label}
              </span>
              {!step.enabled && (
                <span className="text-[9px] text-red-400/60 font-medium uppercase tracking-wider shrink-0">
                  {t('autoReg.disabled')}
                </span>
              )}

              {/* Controls */}
              <div className="flex items-center gap-1 shrink-0">
                {/* Enable/disable */}
                <IconButton
                  size="sm"
                  variant="ghost"
                  onClick={() => toggleEnabled(step.id)}
                  className={cn(
                    'p-1 rounded transition-colors',
                    step.enabled
                      ? 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/15'
                      : 'text-slate-600 hover:text-slate-400 hover:bg-white/5'
                  )}
                  title={step.enabled ? t('autoReg.stepEnabled') : t('autoReg.stepDisabled')}
                >
                  {step.enabled ? (
                    <ToggleRight className="w-4 h-4" />
                  ) : (
                    <ToggleLeft className="w-4 h-4" />
                  )}
                </IconButton>

                {/* Pause after */}
                <IconButton
                  size="sm"
                  variant="ghost"
                  onClick={() => togglePause(step.id)}
                  className={cn(
                    'p-1 rounded transition-colors',
                    step.pauseAfter
                      ? 'text-amber-400 hover:text-amber-300 hover:bg-amber-500/15'
                      : 'text-slate-600 hover:text-slate-400 hover:bg-white/5'
                  )}
                  title={
                    step.pauseAfter
                      ? t('autoReg.pipeline.unsetPause')
                      : t('autoReg.pipeline.setPause')
                  }
                >
                  <Pause className="w-3.5 h-3.5" />
                </IconButton>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
