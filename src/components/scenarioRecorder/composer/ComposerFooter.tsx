import { t } from "@/lib/i18n";import { Button } from '@/components/ui';

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
  onRun
}: ComposerFooterProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="text-xs text-slate-400">
        {runState.status === 'running' ?
        `Running job ${runState.jobId}` :
        runState.status === 'error' ?
        runState.error :
        !canRunFlow ?
        'Fix validation errors to run' :
        `Segments: ${segmentCount}`}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={onClose}>{t("recorder.composer_footer.close")}

        </Button>
        <Button variant="danger" onClick={onDelete} disabled={!selectedFlowId}>{t("recorder.composer_footer.delete")}

        </Button>
        <Button variant="secondary" onClick={onSave} isLoading={saveLoading}>{t("recorder.composer_footer.save")}

        </Button>
        <Button variant="secondary" onClick={onCreateSchedulerTask}>{t("recorder.composer_footer.create_scheduler_task")}

        </Button>
        <Button onClick={onRun} disabled={runState.status === 'running' || !canRunFlow}>{t("recorder.composer_footer.run_flow")}

        </Button>
      </div>
    </div>);

}