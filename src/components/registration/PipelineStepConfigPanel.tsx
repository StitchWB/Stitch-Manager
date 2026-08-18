import { Pause, ToggleLeft, ToggleRight, ChevronLeft, Settings2 } from 'lucide-react';
import { t } from '@/lib/i18n';
import { Badge, GlassCard, IconButton, Button } from '@/components/ui';
import { cn } from '../../lib/utils';

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
    // Persistence is optional; the current run still uses the in-memory state.
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
    // Persistence is optional; the current run still uses the in-memory state.
  }
}

export interface PipelineStepOverride {
  id: string;
  label: string;
  enabled: boolean;
  pauseAfter: boolean;
  skippable: boolean;
}

// ─── Compact summary bar ──────────────────────────────────────────────────────

interface PipelineStepSummaryBarProps {
  steps: PipelineStepOverride[];
  onConfigure: () => void;
  disabled?: boolean;
}

/**
 * Renders a single-row "6/6 · 0 пауз  [Настроить ›]" bar.
 * Used inside the bottom of CommandCenter on all tabs so it never takes
 * up the full panel height.
 */
export function PipelineStepSummaryBar({
  steps,
  onConfigure,
  disabled = false,
}: PipelineStepSummaryBarProps) {
  if (steps.length === 0) return null;

  const enabledCount = steps.filter(s => s.enabled).length;
  const activePauses = steps.filter(s => s.pauseAfter).length;

  return (
    <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-t border-white/[0.06] bg-white/[0.01]">
      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 shrink-0">
        {t('uiTexts.scenarioLabel')}
      </span>
      <div className="flex items-center gap-1 flex-1 min-w-0">
        <Badge variant="info" size="sm">{enabledCount}/{steps.length}</Badge>
        {activePauses > 0 && (
          <Badge variant="warning" size="sm">{activePauses} {activePauses === 1 ? 'пауза' : 'паузы'}</Badge>
        )}
      </div>
      <Button
        variant="ghost"
        size="xs"
        onClick={onConfigure}
        disabled={disabled}
        rightIcon={<Settings2 className="w-3 h-3" />}
        className="text-[10px] text-slate-400 hover:text-slate-200 shrink-0 px-1.5 py-0.5"
      >
        {t('uiTexts.configure')}
      </Button>
    </div>
  );
}

// ─── Full editor (replaces tab content area) ─────────────────────────────────

interface PipelineStepConfigPanelProps {
  steps: PipelineStepOverride[];
  onChange: (steps: PipelineStepOverride[]) => void;
  onBack: () => void;
  disabled?: boolean;
}

/**
 * Full scenario editor — shown when user clicks "Настроить" in the summary bar.
 * It occupies the same scrollable area as a regular tab, so it doesn't add
 * extra height to the panel.
 */
export function PipelineStepConfigPanel({
  steps,
  onChange,
  onBack,
  disabled = false,
}: PipelineStepConfigPanelProps) {
  if (steps.length === 0) return null;

  const activePauses = steps.filter(step => step.pauseAfter).length;
  const enabledCount = steps.filter(step => step.enabled).length;

  const toggleEnabled = (id: string) => {
    const next = steps.map(step => (step.id === id ? { ...step, enabled: !step.enabled } : step));
    const changed = next.find(step => step.id === id);
    if (changed) {
      const overrides = loadEnabledOverrides();
      overrides[id] = changed.enabled;
      saveEnabledOverrides(overrides);
    }
    onChange(next);
  };

  const togglePause = (id: string) => {
    const next = steps.map(step => (step.id === id ? { ...step, pauseAfter: !step.pauseAfter } : step));
    const changed = next.find(step => step.id === id);
    if (changed) {
      const overrides = loadPauseOverrides();
      overrides[id] = changed.pauseAfter;
      savePauseOverrides(overrides);
    }
    onChange(next);
  };

  return (
    <div className={cn('flex flex-col gap-2', disabled && 'opacity-60')}>
      {/* Header row */}
      <div className="flex items-center gap-2">
        <IconButton
          size="sm"
          variant="ghost"
          onClick={onBack}
          title="Назад"
          className="p-1 text-slate-400 hover:text-slate-200"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </IconButton>
        <div className="flex-1">
          <div className="text-xs font-semibold text-slate-200">{t('uiTexts.scenarioSteps')}</div>
          <div className="text-[10px] text-slate-500">
            {t('uiTexts.stepsSummary', { enabled: enabledCount, total: steps.length, pauses: activePauses })}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Badge variant="info" size="sm">{enabledCount}/{steps.length}</Badge>
          {activePauses > 0 && (
            <Badge variant="warning" size="sm">{activePauses}</Badge>
          )}
        </div>
      </div>

      {/* Steps list */}
      <GlassCard className="p-0 overflow-hidden">
        <div className="divide-y divide-white/[0.04]">
          {steps.map((step, idx) => (
            <div
              key={step.id}
              className={cn(
                'flex items-center gap-2 px-3 py-2',
                step.enabled ? 'bg-white/[0.01]' : 'opacity-40'
              )}
            >
              <span className="text-[9px] text-slate-600 w-4 shrink-0 text-right">{idx + 1}</span>
              <span className={cn(
                'w-1.5 h-1.5 rounded-full shrink-0',
                step.enabled ? 'bg-indigo-400' : 'bg-slate-700'
              )} />
              <span className={cn(
                'min-w-0 flex-1 text-xs',
                step.enabled ? 'text-slate-300' : 'text-slate-500 line-through'
              )}>
                {step.label}
              </span>
              <div className="flex items-center gap-0.5 shrink-0">
                <IconButton
                  size="sm"
                  variant="ghost"
                  onClick={() => togglePause(step.id)}
                  disabled={disabled || !step.enabled}
                  title={step.pauseAfter ? 'Отменить паузу после шага' : 'Поставить паузу после шага'}
                  className={cn('p-1', step.pauseAfter ? 'text-amber-400' : 'text-slate-600 hover:text-slate-400')}
                >
                  <Pause className="w-3.5 h-3.5" />
                </IconButton>
                <IconButton
                  size="sm"
                  variant="ghost"
                  onClick={() => toggleEnabled(step.id)}
                  disabled={disabled || (!step.skippable && step.enabled)}
                  title={
                    !step.skippable && step.enabled
                      ? 'Этот шаг обязателен'
                      : step.enabled
                        ? 'Отключить шаг'
                        : 'Включить шаг'
                  }
                  className={cn('p-1', step.enabled ? 'text-emerald-400' : 'text-slate-600 hover:text-slate-400')}
                >
                  {step.enabled ? (
                    <ToggleRight className="w-3.5 h-3.5" />
                  ) : (
                    <ToggleLeft className="w-3.5 h-3.5" />
                  )}
                </IconButton>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      <p className="text-[10px] text-slate-600 px-1">
        {t('uiTexts.pauseHint')}
      </p>
    </div>
  );
}
