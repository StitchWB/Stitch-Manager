import { useState, useEffect, useCallback } from 'react';
import { registrationControl, type PipelineControlAction } from '../../lib/tauri';
import { Button, GlassCard, Badge } from '@/components/ui';
import { Play, SkipForward, Hand, X } from 'lucide-react';
import type {
  PipelineStepConfig,
  PipelineStepStatus,
  PipelineStepWaitingEvent,
} from '../../types/pipeline';

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

  useEffect(() => {
    if (!isRunning) {
      setSteps([]);
      setWaitingStep(null);
      setManualMode(false);
      return;
    }

    const unlistenPromises: Promise<() => void>[] = [];

    import('@tauri-apps/api/event').then(({ listen }) => {
      const handler = (label: string) => (event: any) => {
        console.log(`[PipelineControls] ${label}`, event.payload);
      };

      unlistenPromises.push(
        listen('registration:pipeline_config', (event: any) => {
          handler('pipeline_config')(event);
          const data = event.payload?.data;
          if (data?.steps) {
            setSteps(data.steps);
          }
        })
      );

      unlistenPromises.push(
        listen('registration:step_started', (event: any) => {
          console.log('[PipelineControls] step_started', event.payload);
          const data = event.payload?.data;
          if (data?.step) {
            setSteps(prev =>
              prev.map(s => (s.id === data.step.id ? { ...s, ...data.step, status: data.step.status as PipelineStepStatus } : s))
            );
          }
        })
      );

      unlistenPromises.push(
        listen('registration:step_completed', (event: any) => {
          const data = event.payload?.data;
          if (data?.stepId) {
            setSteps(prev =>
              prev.map(s => (s.id === data.stepId ? { ...s, status: 'completed' as PipelineStepStatus } : s))
            );
          }
        })
      );

      unlistenPromises.push(
        listen('registration:step_failed', (event: any) => {
          const data = event.payload?.data;
          if (data?.stepId) {
            setSteps(prev =>
              prev.map(s => (s.id === data.stepId ? { ...s, status: 'failed' as PipelineStepStatus } : s))
            );
          }
        })
      );

      unlistenPromises.push(
        listen('registration:step_skipped', (event: any) => {
          const data = event.payload?.data;
          if (data?.stepId) {
            setSteps(prev =>
              prev.map(s => (s.id === data.stepId ? { ...s, status: 'skipped' as PipelineStepStatus } : s))
            );
          }
        })
      );

      unlistenPromises.push(
        listen('registration:step_waiting', (event: any) => {
          console.log('[PipelineControls] step_waiting', event.payload);
          const data = event.payload?.data;
          if (data) {
            setWaitingStep(data as PipelineStepWaitingEvent);
          }
        })
      );

      unlistenPromises.push(
        listen('registration:pipeline_paused', () => {
          // handled by step_waiting
        })
      );

      unlistenPromises.push(
        listen('registration:pipeline_resumed', () => {
          setWaitingStep(null);
          setManualMode(false);
        })
      );

      unlistenPromises.push(
        listen('registration:manual_mode_entered', () => {
          setManualMode(true);
        })
      );

      unlistenPromises.push(
        listen('registration:manual_mode_exited', () => {
          setManualMode(false);
          setWaitingStep(null);
        })
      );

      unlistenPromises.push(
        listen('registration:pipeline_aborted', () => {
          setWaitingStep(null);
          setManualMode(false);
        })
      );
    });

    return () => {
      Promise.all(unlistenPromises).then(unlisteners => {
        unlisteners.forEach(u => u());
      });
    };
  }, [isRunning]);

  const sendCommand = useCallback(
    (command: PipelineControlAction, stepId?: string) => {
      if (!jobId) return;
      registrationControl(jobId, command, stepId).catch(console.error);
    },
    [jobId]
  );

  if (!isRunning || steps.length === 0) return null;

  const waitingStepConfig = waitingStep ? steps.find(s => s.id === waitingStep.stepId) : null;

  return (
    <GlassCard className="shrink-0 border-amber-500/20 bg-gradient-to-b from-amber-500/[0.06] to-transparent">
      {/* Step Progress */}
      <div className="p-3 space-y-1">
        <div className="text-[10px] uppercase tracking-widest text-slate-400 mb-2">Pipeline Steps</div>
        {steps.map(step => (
          <div key={step.id} className="flex items-center gap-2 text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={step.enabled}
                disabled={step.status !== 'pending' || !step.skippable}
                onChange={() => {
                  if (jobId && step.skippable) {
                    registrationControl(jobId, step.enabled ? 'skip' : 'resume', step.id).catch(
                      console.error
                    );
                  }
                }}
                className="rounded border-slate-600 bg-slate-800 text-indigo-500"
              />
              <span className={`${STATUS_COLOR[step.status]} ${step.status === 'running' ? 'animate-pulse' : ''}`}>
                {STATUS_ICON[step.status]}
              </span>
              <span className={step.status === 'pending' && !step.enabled ? 'line-through text-slate-600' : 'text-slate-200'}>
                {step.label}
              </span>
            </label>
            {step.status === 'failed' && step.skippable && (
              <button
                onClick={() => sendCommand('skip', step.id)}
                className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 hover:bg-red-500/30"
              >
                skip
              </button>
            )}
            {step.status === 'failed' && step.retryOnFail && (
              <button
                onClick={() => sendCommand('retry', step.id)}
                className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 hover:bg-blue-500/30"
              >
                retry
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Live Controls */}
      {waitingStep && (
        <div className="border-t border-amber-500/20 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="warning" size="sm" withDot withPulse>
              {manualMode ? 'Manual Control' : 'Paused'}
            </Badge>
            <span className="text-xs text-slate-400">
              {waitingStepConfig?.label || waitingStep.stepId}
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              leftIcon={<Play className="w-3 h-3" />}
              onClick={() => sendCommand('resume', waitingStep.stepId)}
            >
              Resume
            </Button>

            {waitingStepConfig?.skippable && (
              <Button
                size="sm"
                variant="ghost"
                leftIcon={<SkipForward className="w-3 h-3" />}
                onClick={() => sendCommand('skip', waitingStep.stepId)}
              >
                Skip Step
              </Button>
            )}

            {waitingStepConfig?.allowManual && !manualMode && (
              <Button
                size="sm"
                variant="ghost"
                leftIcon={<Hand className="w-3 h-3" />}
                onClick={() => sendCommand('manual', waitingStep.stepId)}
              >
                Take Over
              </Button>
            )}

            {manualMode && (
              <Button
                size="sm"
                variant="primary"
                leftIcon={<Play className="w-3 h-3" />}
                onClick={() => sendCommand('resume', waitingStep.stepId)}
              >
                Done, Continue
              </Button>
            )}

            <Button
              size="sm"
              variant="danger"
              leftIcon={<X className="w-3 h-3" />}
              onClick={() => sendCommand('abort', waitingStep.stepId)}
            >
              Abort
            </Button>
          </div>
        </div>
      )}
    </GlassCard>
  );
}
