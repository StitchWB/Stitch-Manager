import { Button } from '@/components/ui';

type ComposerFooterProps = {
  runState: {
    status: 'idle' | 'running' | 'done' | 'error';
    jobId: string | null;
    error: string | null;
  };
  canRunFlow: boolean;
  segmentCount: number;
  selectedFlowId: string;
  saveLoading: boolean;
  onClose: () => void;
  onDelete: () => void;
  onSave: () => void;
  onCreateSchedulerTask: () => void;
  onRun: () => void;
};

export function ComposerFooter({
  runState,
  canRunFlow,
  segmentCount,
  selectedFlowId,
  saveLoading,
  onClose,
  onDelete,
  onSave,
  onCreateSchedulerTask,
  onRun,
}: ComposerFooterProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="text-xs text-slate-400">
        {runState.status === 'running'
          ? `Running job ${runState.jobId}`
          : runState.status === 'error'
            ? runState.error
            : !canRunFlow
              ? 'Fix validation errors to run'
              : `Segments: ${segmentCount}`}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
        <Button variant="danger" onClick={onDelete} disabled={!selectedFlowId}>
          Delete
        </Button>
        <Button variant="secondary" onClick={onSave} isLoading={saveLoading}>
          Save
        </Button>
        <Button variant="secondary" onClick={onCreateSchedulerTask}>
          Create Scheduler Task
        </Button>
        <Button onClick={onRun} disabled={runState.status === 'running' || !canRunFlow}>
          Run flow
        </Button>
      </div>
    </div>
  );
}
