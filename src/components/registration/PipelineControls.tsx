import { useState, useEffect, useCallback } from 'react';
import { registrationControl, type PipelineControlAction } from '../../lib/tauri';
import { Button, Badge } from '@/components/ui';
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
      unlistenPromises.push(
        listen('registration:pipeline_config', (event: any) => {
          const data = event.payload?.data;
          if (data?.steps) {
            setSteps(data.steps);
          }
        })
      );

      unlistenPromises.push(
        listen('registration:step_started', (event: any) => {
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
          const data = event.payload?.data;
          if (data) {
            setWaitingStep(data as PipelineStepWaitingEvent);
          }
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
    <div className="border-b border-white/5">
      {/* Horizontal step progress */}
      <div className="px-4 py-2 flex items-center gap-1 overflow-x-auto">
        {steps.map((step, i) => (
          <div key={step.id} className="flex items-center gap-1 shrink-0">
            {i > 0 && <span className="text-slate-700 text-[10px] mx-0.5">→</span>}
            <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/[0.03]">
              <span className={`${STATUS_COLOR[step.status]} text-xs ${step.status === 'running' ? 'animate-pulse' : ''}`}>
                {STATUS_ICON[step.status]}
              </span>
              <span className={`text-xs whitespace-nowrap ${
                step.status === 'pending' && !step.enabled ? 'line-through text-slate-600' :
                step.status === 'completed' ? 'text-slate-300' :
                step.status === 'running' ? 'text-white font-medium' :
                'text-slate-400'
              }`}>
                {step.label}
              </span>
              {step.status === 'failed' && step.skippable && (
                <button
                  onClick={() => sendCommand('skip', step.id)}
                  className="text-[10px] px-1 py-0.5 rounded bg-red-500/20 text-red-300 hover:bg-red-500/30"
                >
                  skip
                </button>
              )}
              {step.status === 'failed' && step.retryOnFail && (
                <button
                  onClick={() => sendCommand('retry', step.id)}
                  className="text-[10px] px-1 py-0.5 rounded bg-blue-500/20 text-blue-300 hover:bg-blue-500/30"
                >
                  retry
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Waiting controls — inline, only when paused */}
      {waitingStep && (
        <div className="px-4 py-2 flex items-center gap-2 bg-amber-500/[0.04] border-t border-amber-500/10">
          <Badge variant="warning" size="sm" withDot withPulse>
            {manualMode ? 'Manual' : 'Paused'}
          </Badge>
          <span className="text-xs text-slate-400">
            {waitingStepConfig?.label || waitingStep.stepId}
          </span>
          <div className="flex items-center gap-1.5 ml-auto">
            <Button
              size="xs"
              variant="primary"
              leftIcon={<Play className="w-3 h-3" />}
              onClick={() => sendCommand('resume', waitingStep.stepId)}
              className="animate-pulse"
            >
              Resume
            </Button>

            {waitingStepConfig?.skippable && (
              <Button
                size="xs"
                variant="ghost"
                leftIcon={<SkipForward className="w-3 h-3" />}
                onClick={() => sendCommand('skip', waitingStep.stepId)}
              >
                Skip
              </Button>
            )}

            {waitingStepConfig?.allowManual && !manualMode && (
              <Button
                size="xs"
                variant="ghost"
                leftIcon={<Hand className="w-3 h-3" />}
                onClick={() => sendCommand('manual', waitingStep.stepId)}
              >
                Take Over
              </Button>
            )}

            {manualMode && (
              <Button
                size="xs"
                variant="primary"
                leftIcon={<Play className="w-3 h-3" />}
                onClick={() => sendCommand('resume', waitingStep.stepId)}
              >
                Done
              </Button>
            )}

            <Button
              size="xs"
              variant="danger"
              leftIcon={<X className="w-3 h-3" />}
              onClick={() => sendCommand('abort', waitingStep.stepId)}
            >
              Abort
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
