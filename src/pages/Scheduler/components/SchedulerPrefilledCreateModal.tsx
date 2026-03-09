import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Modal } from '../../../components/ui';
import { useSchedulerStore } from '../../../stores/scheduler';
import {
  SchedulerTaskForm,
  type SchedulerTaskFormState,
  validateTaskFormState,
  buildScheduleFromState,
  buildTaskTypeFromState,
  buildEffectiveConfig,
} from './SchedulerTaskForm';

interface SchedulerPrefilledCreateModalProps {
  isOpen: boolean;
  initialState: SchedulerTaskFormState;
  onClose: () => void;
}

export function SchedulerPrefilledCreateModal({
  isOpen,
  initialState,
  onClose,
}: SchedulerPrefilledCreateModalProps) {
  const { createTask } = useSchedulerStore();
  const [state, setState] = useState<SchedulerTaskFormState>(() => ({
    ...initialState,
    emailSourcePolicy: initialState.emailSourcePolicy ?? 'fallback_to_pool',
  }));
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const validationError = useMemo(() => validateTaskFormState(state), [state]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      const err = validateTaskFormState(state);
      if (err) {
        throw new Error(err);
      }
      const taskType = buildTaskTypeFromState(state.taskType, state.scriptPath);
      const schedule = buildScheduleFromState(state.schedule);
      const finalConfig = JSON.stringify(buildEffectiveConfig(state), null, 2);
      await createTask(state.name.trim(), taskType, schedule, finalConfig);
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Failed to create task');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Create Scheduled Task (Prefilled)"
      icon={<Plus className="text-vsc-blue" size={20} />}
      size="lg"
      isLoading={submitting}
      loadingMessage="Creating task..."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={submitting || validationError !== null}
            onClick={() => {
              const form = document.getElementById('create-task-prefilled-form');
              if (!(form instanceof HTMLFormElement)) return;
              form.requestSubmit();
            }}
          >
            Create Task
          </Button>
        </div>
      }
    >
      <form id="create-task-prefilled-form" onSubmit={handleSubmit} className="space-y-6">
        {submitError ? (
          <div className="rounded-md border border-vsc-red/30 bg-vsc-red/10 px-3 py-2 text-xs text-vsc-red">
            {submitError}
          </div>
        ) : null}

        <SchedulerTaskForm state={state} onChange={setState} />
      </form>
    </Modal>
  );
}
