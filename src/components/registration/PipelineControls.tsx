import { useState, useEffect, useCallback, useRef } from 'react';
import { registrationControl, type PipelineControlAction } from '../../lib/tauri';
import { Button, Badge } from '@/components/ui';
import { Play, SkipForward, Hand, X } from 'lucide-react';
import { t } from '@/lib/i18n';
import { useRegistrationStore } from '../../stores/registration';
import { playCaptchaAlert, stopCaptchaAlert } from '../../lib/audio/captchaAlert';
import type {
  PipelineStepConfig,
  PipelineStepStatus,
  PipelineStepWaitingEvent,
} from '../../types/pipeline';

function getStr(raw: Record<string, unknown>, key: string): string {
  const val = raw[key];
  return typeof val === 'string' ? val : '';
}

function getBool(raw: Record<string, unknown>, key: string): boolean {
  const val = raw[key];
  return typeof val === 'boolean' ? val : false;
}

function getStringArray(val: unknown): string[] | undefined {
  if (Array.isArray(val) && val.every((item) => typeof item === 'string')) {
    return val as string[];
  }
  return undefined;
}

function normalizeStepConfig(raw: Record<string, unknown>): PipelineStepConfig {
  return {
    id: getStr(raw, 'id'),
    label: getStr(raw, 'label') || getStr(raw, 'id') || 'Step',
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
    required: typeof raw.required === 'boolean' ? raw.required : true,
    skippable: getBool(raw, 'skippable'),
    pauseAfter: typeof raw.pause_after === 'boolean' ? raw.pause_after : typeof raw.pauseAfter === 'boolean' ? raw.pauseAfter : false,
    allowManual: typeof raw.allow_manual === 'boolean' ? raw.allow_manual : typeof raw.allowManual === 'boolean' ? raw.allowManual : false,
    retryOnFail: typeof raw.retry_on_fail === 'boolean' ? raw.retry_on_fail : typeof raw.retryOnFail === 'boolean' ? raw.retryOnFail : false,
    status: (getStr(raw, 'status') || 'pending') as PipelineStepStatus,
    config: typeof raw.config === 'object' && raw.config !== null && !Array.isArray(raw.config) ? raw.config as Record<string, unknown> : {},
  };
}

function normalizeWaitingEvent(raw: Record<string, unknown>): PipelineStepWaitingEvent | null {
  if (!raw) return null;
  const reasonVal = getStr(raw, 'reason');
  const reason: PipelineStepWaitingEvent['reason'] =
    reasonVal === 'manual' || reasonVal === 'failure_choose' || reasonVal === 'pause_after'
      ? reasonVal
      : 'pause_after';
  return {
    jobId: getStr(raw, 'jobId') || getStr(raw, 'job_id'),
    stepId: getStr(raw, 'stepId') || getStr(raw, 'step_id'),
    reason,
    options: getStringArray(raw.options),
  };
}

interface PipelineControlsProps {
  jobId: string | null;
  isRunning: boolean;
}

const STATUS_ICON: Record<PipelineStepStatus, string> = {
  pending: '○',
  running: '◐',
  completed: '●',
  skipped: '—',
  failed: '✗',
  waiting: '⏸',
};

const STATUS_COLOR: Record<PipelineStepStatus, string> = {
  pending: 'text-slate-500',
  running: 'text-blue-400',
  completed: 'text-emerald-400',
  skipped: 'text-slate-600',
  failed: 'text-red-400',
  waiting: 'text-amber-400',
};

export function PipelineControls({ jobId, isRunning }: PipelineControlsProps) {
  const [steps, setSteps] = useState<PipelineStepConfig[]>([]);
  const [waitingStep, setWaitingStep] = useState<PipelineStepWaitingEvent | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [runFinished, setRunFinished] = useState(false);
  const listenersRef = useRef<(() => void)[]>([]);
  const jobIdRef = useRef<string | null>(null);
  const alertIntervalRef = useRef<number | null>(null);

  // Sound alert config
  const { captchaSoundEnabled, captchaSoundFile } = useRegistrationStore(
    state => ({
      captchaSoundEnabled: state.config.advanced.captchaSoundEnabled,
      captchaSoundFile: state.config.advanced.captchaSoundFile,
    })
  );

  const startRepeatingAlert = useCallback(() => {
    if (!captchaSoundEnabled || alertIntervalRef.current !== null) return;
    playCaptchaAlert(captchaSoundFile);
    alertIntervalRef.current = window.setInterval(() => {
      playCaptchaAlert(captchaSoundFile);
    }, 3000);
  }, [captchaSoundEnabled, captchaSoundFile]);

  const stopRepeatingAlert = useCallback(() => {
    if (alertIntervalRef.current !== null) {
      window.clearInterval(alertIntervalRef.current);
      alertIntervalRef.current = null;
    }
    stopCaptchaAlert();
  }, []);

  // Reset state when jobId changes (new run starts)
  useEffect(() => {
    if (jobId !== jobIdRef.current) {
      jobIdRef.current = jobId;
      setSteps([]);
      setWaitingStep(null);
      setManualMode(false);
      setRunFinished(false);
    }
  }, [jobId]);

  // Register Tauri event listeners when jobId is set
  useEffect(() => {
    if (!jobId) {
      listenersRef.current.forEach((unlisten) => unlisten());
      listenersRef.current = [];
      return;
    }

    let cancelled = false;
    const listeners: (() => void)[] = [];

    (async () => {
      const { listen } = await import('@/lib/events');
      if (cancelled) return;

      const register = async (event: string, handler: (payload: Record<string, unknown>) => void) => {
        const unlisten = await listen(event, (evt) => {
          const payload = evt.payload as Record<string, unknown>;
          const payloadJobId = payload?.jobId;
          if (payloadJobId && payloadJobId !== jobId) return;
          handler(payload);
        });
        listeners.push(unlisten);
      };

      await register('registration:pipeline_config', (payload) => {
        const data = typeof payload.data === 'object' && payload.data !== null && !Array.isArray(payload.data) ? payload.data as Record<string, unknown> : undefined;
        if (data) {
          const steps = Array.isArray(data.steps) ? data.steps as Record<string, unknown>[] : undefined;
          if (steps) {
            setSteps(steps.map(normalizeStepConfig));
            setRunFinished(false);
          }
        }
      });

      await register('registration:step_started', (payload) => {
        const data = typeof payload.data === 'object' && payload.data !== null && !Array.isArray(payload.data) ? payload.data as Record<string, unknown> : undefined;
        if (data) {
          const step = typeof data.step === 'object' && data.step !== null && !Array.isArray(data.step) ? data.step as Record<string, unknown> : undefined;
          if (step) {
            const normalized = normalizeStepConfig(step);
            setSteps((prev) =>
              prev.map((s) =>
                s.id === normalized.id ? { ...s, ...normalized } : s
              )
            );
          }
        }
      });

      await register('registration:step_completed', (payload) => {
        const data = typeof payload.data === 'object' && payload.data !== null && !Array.isArray(payload.data) ? payload.data as Record<string, unknown> : undefined;
        if (data) {
          const stepId = typeof data.step_id === 'string' ? data.step_id : typeof data.stepId === 'string' ? data.stepId : undefined;
          if (stepId) {
            setSteps((prev) =>
              prev.map((s) =>
                s.id === stepId ? { ...s, status: 'completed' as PipelineStepStatus } : s
              )
            );
          }
        }
      });

      await register('registration:step_failed', (payload) => {
        const data = typeof payload.data === 'object' && payload.data !== null && !Array.isArray(payload.data) ? payload.data as Record<string, unknown> : undefined;
        if (data) {
          const stepId = typeof data.step_id === 'string' ? data.step_id : typeof data.stepId === 'string' ? data.stepId : undefined;
          if (stepId) {
            setSteps((prev) =>
              prev.map((s) =>
                s.id === stepId ? { ...s, status: 'failed' as PipelineStepStatus } : s
              )
            );
          }
        }
      });

      await register('registration:step_skipped', (payload) => {
        const data = typeof payload.data === 'object' && payload.data !== null && !Array.isArray(payload.data) ? payload.data as Record<string, unknown> : undefined;
        if (data) {
          const stepId = typeof data.step_id === 'string' ? data.step_id : typeof data.stepId === 'string' ? data.stepId : undefined;
          if (stepId) {
            setSteps((prev) =>
              prev.map((s) =>
                s.id === stepId ? { ...s, status: 'skipped' as PipelineStepStatus } : s
              )
            );
          }
        }
      });

      await register('registration:step_waiting', (payload) => {
        const data = typeof payload.data === 'object' && payload.data !== null && !Array.isArray(payload.data) ? payload.data as Record<string, unknown> : undefined;
        if (data) {
          const normalized = normalizeWaitingEvent(data);
          if (normalized) {
            setWaitingStep(normalized);
            setSteps((prev) =>
              prev.map((s) =>
                s.id === normalized.stepId ? { ...s, status: 'waiting' as PipelineStepStatus } : s
              )
            );
            if (normalized.reason === 'manual' && captchaSoundEnabled) {
              startRepeatingAlert();
            }
          }
        }
      });

      await register('registration:pipeline_resumed', () => {
        setWaitingStep(null);
        setManualMode(false);
        stopRepeatingAlert();
      });

      await register('registration:manual_mode_entered', () => {
        setManualMode(true);
        if (captchaSoundEnabled) {
          startRepeatingAlert();
        }
      });

      await register('registration:manual_mode_exited', () => {
        setManualMode(false);
        setWaitingStep(null);
        stopRepeatingAlert();
      });

      await register('registration:pipeline_aborted', () => {
        setWaitingStep(null);
        setManualMode(false);
        setRunFinished(true);
        stopRepeatingAlert();
      });

      listenersRef.current = listeners;
    })();

    return () => {
      cancelled = true;
      listeners.forEach((unlisten) => unlisten());
      stopRepeatingAlert();
    };
  }, [jobId, captchaSoundEnabled, startRepeatingAlert, stopRepeatingAlert]);

  // Mark run finished when isRunning goes from true to false and we have steps
  useEffect(() => {
    if (!isRunning && steps.length > 0 && !runFinished) {
      setRunFinished(true);
    }
  }, [isRunning, steps.length, runFinished]);

  const sendCommand = useCallback(
    (command: PipelineControlAction, stepId?: string, data?: Record<string, unknown>) => {
      if (!jobId) return;
      registrationControl(jobId, command, stepId, data).catch(console.error);
    },
    [jobId]
  );

  // Fallback: detect waiting state from steps array if event was missed
  const activeWaitingStepId =
    waitingStep?.stepId ??
    steps.find((s) => s.status === 'waiting' && (s.pauseAfter || s.allowManual))?.id ??
    null;

  const activeWaitingStep = activeWaitingStepId
    ? {
        stepId: activeWaitingStepId,
        reason: 'pause_after' as const,
      }
    : null;

  const waitingStepConfig = activeWaitingStepId
    ? steps.find((s) => s.id === activeWaitingStepId)
    : null;

  // Only hide if there's no job and no persisted steps from a finished run
  if (!jobId && steps.length === 0) return null;

  return (
    <div className="border-b border-white/5">
      {/* Horizontal step progress */}
      <div className="px-4 py-2 flex items-center gap-1 overflow-x-auto">
        {steps.map((step, i) => (
          <div key={step.id} className="flex items-center gap-1 shrink-0">
            {i > 0 && <span className="text-slate-700 text-[10px] mx-0.5">→</span>}
            <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/[0.03]">
              <span
                className={`${STATUS_COLOR[step.status]} text-xs ${step.status === 'running' ? 'animate-pulse' : ''}`}
              >
                {STATUS_ICON[step.status]}
              </span>
              <span
                className={`text-xs whitespace-nowrap ${
                  step.status === 'pending' && !step.enabled
                    ? 'line-through text-slate-600'
                    : step.status === 'completed'
                      ? 'text-slate-300'
                      : step.status === 'running'
                        ? 'text-white font-medium'
                        : 'text-slate-400'
                }`}
              >
                {step.label}
              </span>
              {step.status === 'failed' && step.skippable && (
                <Button
                  size="xs"
                  variant="danger"
                  onClick={() => sendCommand('skip', step.id)}
                  className="text-[10px] px-1 py-0.5 rounded bg-red-500/20 text-red-300 hover:bg-red-500/30"
                >
                  {t('autoReg.pipeline.skip').toLowerCase()}
                </Button>
              )}
              {step.status === 'failed' && step.retryOnFail && (
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => sendCommand('retry', step.id)}
                  className="text-[10px] px-1 py-0.5 rounded bg-blue-500/20 text-blue-300 hover:bg-blue-500/30"
                >
                  {t('common.retry')}
                </Button>
              )}
            </div>
          </div>
        ))}
        {runFinished && (
          <span className="text-[10px] text-slate-500 ml-2">{t('autoReg.pipeline.done')}</span>
        )}
      </div>

      {/* Waiting controls — inline, only when paused */}
      {activeWaitingStep && (
        <div className="px-4 py-2 flex items-center gap-2 bg-amber-500/[0.04] border-t border-amber-500/10">
          <Badge variant="warning" size="sm" withDot withPulse>
            {manualMode ? t('autoReg.pipeline.manual') : t('autoReg.pipeline.paused')}
          </Badge>
          <span className="text-xs text-slate-400">
            {waitingStepConfig?.label || activeWaitingStep.stepId}
          </span>
          <div className="flex items-center gap-1.5 ml-auto">
            <Button
              size="xs"
              variant="primary"
              leftIcon={<Play className="w-3 h-3" />}
              onClick={() => sendCommand('resume', activeWaitingStep.stepId)}
              className="animate-pulse"
            >
              {t('autoReg.pipeline.resume')}
            </Button>

            {waitingStepConfig?.skippable && (
              <Button
                size="xs"
                variant="ghost"
                leftIcon={<SkipForward className="w-3 h-3" />}
                onClick={() => sendCommand('skip', activeWaitingStep.stepId)}
              >
                {t('autoReg.pipeline.skip')}
              </Button>
            )}

            {waitingStepConfig?.allowManual && !manualMode && (
              <Button
                size="xs"
                variant="ghost"
                leftIcon={<Hand className="w-3 h-3" />}
                onClick={() => sendCommand('manual', activeWaitingStep.stepId)}
              >
                {t('autoReg.pipeline.takeOver')}
              </Button>
            )}

            {manualMode && (
              <Button
                size="xs"
                variant="primary"
                leftIcon={<Play className="w-3 h-3" />}
                onClick={() => sendCommand('resume', activeWaitingStep.stepId)}
              >
                {t('autoReg.pipeline.done')}
              </Button>
            )}

            <Button
              size="xs"
              variant="danger"
              leftIcon={<X className="w-3 h-3" />}
              onClick={() => sendCommand('abort', activeWaitingStep.stepId)}
            >
              {t('autoReg.pipeline.abort')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
