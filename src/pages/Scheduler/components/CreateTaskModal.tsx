import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { t } from '@/lib/i18n';

import { useSchedulerStore } from '../../../stores/scheduler';
import {
  SchedulerTaskForm,
  type SchedulerTaskFormState,
  validateTaskFormState,
  buildScheduleFromState,
  buildTaskTypeFromState,
  buildEffectiveConfig,
} from './SchedulerTaskForm';
import {
  SchedulerTaskCreationModeSection,
  type SchedulerTaskCreateMode,
} from './SchedulerTaskCreationModeSection';
import { Button, Modal } from '@/components/ui';

interface CreateTaskModalProps {
  onClose: () => void;
  initialMode?: 'manual' | 'template';
  initialTemplateId?: number | null;
}

const defaultFormState = (): SchedulerTaskFormState => ({
  name: '',
  taskType: 'scenario',
  scriptPath: 'python/run_scenario_replay.py',
  profileAlias: '',
  scenarioPath: '',
  composedFlowPath: '',
  composedFlowId: '',
  composedFlowJson: '',
  flowVariablesJson: '{}',
  emailSourceMode: 'none',
  emailSourcePolicy: 'fallback_to_pool',
  emailListRaw: '',
  emailSheetId: '',
  emailSheetColumn: '',
  schedule: {
    scheduleType: 'interval',
    intervalSeconds: '3600',
    hour: '9',
    minute: '0',
    onceDateTime: '',
  },
  reliability: {
    retryEnabled: false,
    retryMaxAttempts: '2',
    retryBackoffSeconds: '60',
    retryBackoffMultiplier: '2',
    retryMaxBackoffSeconds: '3600',
    quietEnabled: false,
    quietStartHour: '23',
    quietStartMinute: '0',
    quietEndHour: '6',
    quietEndMinute: '0',
  },
  configRaw: '{}',
});

export function CreateTaskModal({
  onClose,
  initialMode = 'manual',
  initialTemplateId = null,
}: CreateTaskModalProps) {
  const { createTask, templates, templatesLoading, fetchTemplates, createTaskFromTemplate } =
    useSchedulerStore();

  const [createMode, setCreateMode] = useState<SchedulerTaskCreateMode>(initialMode);
  const [templateId, setTemplateId] = useState<number | null>(initialTemplateId);
  const [templateNameOverride, setTemplateNameOverride] = useState('');

  const [formState, setFormState] = useState<SchedulerTaskFormState>(() => defaultFormState());

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (createMode !== 'template') return;
    if (templates.length > 0 || templatesLoading) return;
    void fetchTemplates();
  }, [createMode, fetchTemplates, templates.length, templatesLoading]);

  useEffect(() => {
    if (createMode !== 'template') return;
    if (templateId) return;
    if (initialTemplateId) {
      setTemplateId(initialTemplateId);
    }
  }, [createMode, initialTemplateId, templateId]);

  const formValidationError = useMemo(() => validateTaskFormState(formState), [formState]);

  const canCreateManual = formValidationError === null;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      if (createMode === 'template') {
        if (!templateId) {
          throw new Error('Template is required.');
        }
        await createTaskFromTemplate(templateId, templateNameOverride.trim() || null);
        onClose();
        return;
      }

      const validationError = validateTaskFormState(formState);
      if (validationError) {
        throw new Error(validationError);
      }

      const taskType = buildTaskTypeFromState(formState.taskType, formState.scriptPath);
      const schedule = buildScheduleFromState(formState.schedule);
      const finalConfig = JSON.stringify(buildEffectiveConfig(formState), null, 2);

      await createTask(formState.name.trim(), taskType, schedule, finalConfig);
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Failed to create task');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Create Scheduled Task"
      icon={<Plus className="text-vsc-blue" size={20} />}
      size="lg"
      isLoading={submitting}
      loadingMessage={t('common.creatingTask')}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={submitting || (createMode === 'template' ? !templateId : !canCreateManual)}
            onClick={() => {
              const form = document.getElementById('create-task-form');
              if (!(form instanceof HTMLFormElement)) return;
              form.requestSubmit();
            }}
          >
            {t('scheduler.createTask')}
          </Button>
        </div>
      }
    >
      <form id="create-task-form" onSubmit={handleSubmit} className="space-y-6">
        {submitError ? (
          <div className="rounded-md border border-vsc-red/30 bg-vsc-red/10 px-3 py-2 text-xs text-vsc-red">
            {submitError}
          </div>
        ) : null}

        <div className="space-y-4">
          <SchedulerTaskCreationModeSection
            mode={createMode}
            onModeChange={next => {
              setCreateMode(next);
              if (next === 'template' && !templateId && initialTemplateId) {
                setTemplateId(initialTemplateId);
              }
            }}
            templateId={templateId}
            onTemplateIdChange={setTemplateId}
            templateNameOverride={templateNameOverride}
            onTemplateNameOverrideChange={setTemplateNameOverride}
            templates={templates}
            templatesLoading={templatesLoading}
          />

          {createMode === 'manual' ? (
            <SchedulerTaskForm state={formState} onChange={setFormState} />
          ) : null}
        </div>
      </form>
    </Modal>
  );
}
