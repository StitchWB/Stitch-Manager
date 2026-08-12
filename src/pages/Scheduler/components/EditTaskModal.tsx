import { useEffect, useMemo, useState } from 'react';

import { t } from '@/lib/i18n';
import { useSchedulerStore } from '../../../stores/scheduler';
import type { ScheduledTask } from '../../../types/generated';
import {
  SchedulerTaskForm,
  type SchedulerTaskFormState,
  validateTaskFormState,
  buildScheduleFromState,
  buildTaskTypeFromState,
  buildEffectiveConfig,
} from './SchedulerTaskForm';
import { Button, Modal } from '@/components/ui';

interface EditTaskModalProps {
  taskId: number;
  onClose: () => void;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function toObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getNumberLike(value: unknown, fallback: number): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return String(n);
  }
  return String(fallback);
}

function toDateTimeLocal(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromTask(task: ScheduledTask): SchedulerTaskFormState {
  const parsed = parseJsonObject(task.config || '{}');

  const isScenario =
    'customScript' in task.taskType &&
    task.taskType.customScript.script_path === 'python/run_scenario_replay.py';
  const isComposedFlow =
    'customScript' in task.taskType &&
    task.taskType.customScript.script_path === 'python/run_composed_flow.py';

  const scheduleType =
    'interval' in task.schedule ? 'interval' : 'daily' in task.schedule ? 'daily' : 'once';

  const retry = toObject(parsed.retryPolicy);
  const quiet = toObject(parsed.quietHours);
  const emailSource = toObject(parsed.emailSource);

  const out: SchedulerTaskFormState = {
    name: task.name,
    enabled: task.enabled,
    taskType: isScenario ? 'scenario' : isComposedFlow ? 'composedFlow' : 'script',
    scriptPath:
      'customScript' in task.taskType
        ? task.taskType.customScript.script_path
        : 'python/run_scenario_replay.py',
    profileAlias: typeof parsed.alias === 'string' ? parsed.alias : '',
    scenarioPath: typeof parsed.scenarioPath === 'string' ? parsed.scenarioPath : '',
    composedFlowPath:
      typeof parsed.planPath === 'string'
        ? parsed.planPath
        : typeof parsed.flowPath === 'string'
          ? parsed.flowPath
          : '',
    composedFlowId: typeof parsed.flowId === 'string' ? parsed.flowId : '',
    composedFlowJson:
      parsed.flow && typeof parsed.flow === 'object' && !Array.isArray(parsed.flow)
        ? JSON.stringify(parsed.flow, null, 2)
        : typeof parsed.flow === 'string'
          ? parsed.flow
          : '',
    flowVariablesJson:
      parsed.flowInputValues &&
      typeof parsed.flowInputValues === 'object' &&
      !Array.isArray(parsed.flowInputValues)
        ? JSON.stringify(parsed.flowInputValues, null, 2)
        : '{}',
    emailSourceMode: emailSource && emailSource.mode === 'googleSheets' ? 'googleSheets' : 'none',
    emailSourcePolicy:
      emailSource &&
      (emailSource.policy === 'strict' ||
        emailSource.policy === 'fallback_to_pool' ||
        emailSource.policy === 'prefer_pool')
        ? (emailSource.policy as SchedulerTaskFormState['emailSourcePolicy'])
        : 'fallback_to_pool',
    emailListRaw: '',
    emailSheetId: emailSource && typeof emailSource.sheetId === 'string' ? emailSource.sheetId : '',
    emailSheetColumn:
      emailSource && typeof emailSource.column === 'string' ? emailSource.column : '',
    schedule: {
      scheduleType,
      intervalSeconds:
        'interval' in task.schedule ? String(task.schedule.interval.seconds) : '3600',
      hour: 'daily' in task.schedule ? String(task.schedule.daily.hour) : '9',
      minute: 'daily' in task.schedule ? String(task.schedule.daily.minute) : '0',
      onceDateTime: 'once' in task.schedule ? toDateTimeLocal(task.schedule.once.timestamp) : '',
    },
    reliability: {
      retryEnabled: Boolean(retry),
      retryMaxAttempts: getNumberLike(retry?.maxAttempts, 2),
      retryBackoffSeconds: getNumberLike(retry?.backoffSeconds, 60),
      retryBackoffMultiplier: getNumberLike(retry?.backoffMultiplier, 2),
      retryMaxBackoffSeconds: getNumberLike(retry?.maxBackoffSeconds, 3600),
      quietEnabled: Boolean(quiet?.enabled),
      quietStartHour: getNumberLike(quiet?.startHour, 23),
      quietStartMinute: getNumberLike(quiet?.startMinute, 0),
      quietEndHour: getNumberLike(quiet?.endHour, 6),
      quietEndMinute: getNumberLike(quiet?.endMinute, 0),
    },
    configRaw: '{}',
  };

  delete parsed.retryPolicy;
  delete parsed.quietHours;
  delete parsed.runtime;
  out.configRaw = JSON.stringify(parsed, null, 2);

  return out;
}

export function EditTaskModal({ taskId, onClose }: EditTaskModalProps) {
  const { tasks, updateTask } = useSchedulerStore();
  const task = tasks.find(t => t.id === taskId);

  const [formState, setFormState] = useState<SchedulerTaskFormState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
      if (!task) return;
      queueMicrotask(() => {
        setFormState(fromTask(task));
        setError(null);
      });
    }, [task]);

  const formValidationError = useMemo(() => {
    if (!task || !formState) return null;
    return validateTaskFormState(formState);
  }, [task, formState]);

  if (!task || !formState) {
    return null;
  }

  const canSave = formValidationError === null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const validationError = validateTaskFormState(formState);
      if (validationError) {
        throw new Error(validationError);
      }

      const updated: ScheduledTask = {
        ...task,
        name: formState.name.trim(),
        enabled: Boolean(formState.enabled),
        taskType: buildTaskTypeFromState(formState.taskType, formState.scriptPath),
        schedule: buildScheduleFromState(formState.schedule),
        config: JSON.stringify(buildEffectiveConfig(formState), null, 2),
      };

      await updateTask(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update task');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={t('scheduler.editTask')}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="edit-task-form"
            disabled={submitting || !canSave}
          >
            {submitting ? t('common.saving') : t('common.saveChanges')}
          </Button>
        </div>
      }
    >
      <form id="edit-task-form" onSubmit={handleSubmit} className="space-y-4">
        {error ? (
          <div className="rounded-md border border-vsc-red/30 bg-vsc-red/10 px-3 py-2 text-xs text-vsc-red">
            {error}
          </div>
        ) : null}

        <SchedulerTaskForm state={formState} onChange={setFormState} showEnabled />
      </form>
    </Modal>
  );
}
