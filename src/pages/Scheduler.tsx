import { useMemo, useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Plus,
  Play,
  Pause,
  Trash2,
  Edit,
  Clock,
  Calendar,
  Zap,
  TrendingUp,
  CopyPlus,
  Pencil,
} from 'lucide-react';
import {
  Button,
  IconButton,
  Toggle,
  EmptyState,
  GlassCard,
  StatCard,
  StatusBadge,
  ProgressBar,
  Modal,
  ConfirmDialog,
} from '../components/ui';
import { useSchedulerStore } from '../stores/scheduler';
import { TaskType, Schedule } from '../types/generated';
import { CreateTaskModal } from './Scheduler/components/CreateTaskModal';
import { EditTaskModal } from './Scheduler/components/EditTaskModal';
import { SchedulerPrefilledCreateModal } from './Scheduler/components/SchedulerPrefilledCreateModal';
import { TaskExecutionHistory } from './Scheduler/components/TaskExecutionHistory';
import {
  SchedulerTaskForm,
  type SchedulerTaskFormState,
  buildEffectiveConfig,
  buildScheduleFromState,
  buildTaskTypeFromState,
  validateTaskFormState,
} from './Scheduler/components/SchedulerTaskForm';
import { formatDistanceToNow } from 'date-fns';
import type { SchedulerTemplate } from '../lib/tauri/modules/scheduler';

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

function defaultTemplateFormState(): SchedulerTaskFormState {
  return {
    name: '',
    description: '',
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
  };
}

const SCHEDULER_FLOW_CACHE_KEY = 'scheduler:currentComposedFlow';

function defaultCreateFormState(): SchedulerTaskFormState {
  return {
    name: 'Composed flow task',
    taskType: 'composedFlow',
    scriptPath: 'python/run_composed_flow.py',
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
  };
}

function getPrefilledStateFromCache(): SchedulerTaskFormState | null {
  try {
    const raw = localStorage.getItem(SCHEDULER_FLOW_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      alias?: unknown;
      flowId?: unknown;
      flowJson?: unknown;
      flowName?: unknown;
    };
    if (!parsed || typeof parsed !== 'object') return null;
    const alias = typeof parsed.alias === 'string' ? parsed.alias : '';
    const flowId = typeof parsed.flowId === 'string' ? parsed.flowId : '';
    const flowJson = typeof parsed.flowJson === 'string' ? parsed.flowJson : '';
    const flowName = typeof parsed.flowName === 'string' ? parsed.flowName : 'Composed flow task';
    if (!alias || !flowJson) return null;

    return {
      ...defaultCreateFormState(),
      name: `${flowName} • scheduled`,
      profileAlias: alias,
      composedFlowId: flowId,
      composedFlowJson: flowJson,
    };
  } catch {
    return null;
  }
}

export default function Scheduler() {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    tasks,
    templates,
    templatesLoading,
    isRunning,
    loading,
    fetchTasks,
    fetchTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    toggleTask,
    deleteTask,
    executeNow,
    startScheduler,
    stopScheduler,
    getSchedulerStatus,
  } = useSchedulerStore();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createTaskMode, setCreateTaskMode] = useState<'manual' | 'template'>('manual');
  const [createTaskTemplateId, setCreateTaskTemplateId] = useState<number | null>(null);

  const [editingTask, setEditingTask] = useState<number | null>(null);
  const [viewingHistory, setViewingHistory] = useState<number | null>(null);

  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateEditing, setTemplateEditing] = useState<SchedulerTemplate | null>(null);
  const [templateFormState, setTemplateFormState] =
    useState<SchedulerTaskFormState>(defaultTemplateFormState);
  const [templateError, setTemplateError] = useState<string | null>(null);

  const [templateDeleteOpen, setTemplateDeleteOpen] = useState(false);
  const [templateDeleteLoading, setTemplateDeleteLoading] = useState(false);
  const [templateDeleteTarget, setTemplateDeleteTarget] = useState<SchedulerTemplate | null>(null);

  const prefilledState = useMemo(
    () => (searchParams.get('prefill') === 'composed' ? getPrefilledStateFromCache() : null),
    [searchParams]
  );

  const closePrefilledModal = () => {
    const params = new URLSearchParams(searchParams);
    params.delete('prefill');
    setSearchParams(params, { replace: true });
  };

  useEffect(() => {
    fetchTasks();
    fetchTemplates();
    getSchedulerStatus();

    // Poll status every 10 seconds
    const interval = setInterval(() => {
      getSchedulerStatus();
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  const handleToggleScheduler = async () => {
    if (isRunning) {
      await stopScheduler();
    } else {
      await startScheduler();
    }
  };

  const handleToggleTask = async (taskId: number, enabled: boolean) => {
    await toggleTask(taskId, enabled);
  };

  const handleDeleteTask = async (taskId: number) => {
    if (confirm('Are you sure you want to delete this task?')) {
      await deleteTask(taskId);
    }
  };

  const handleExecuteNow = async (taskId: number) => {
    await executeNow(taskId);
  };

  const getTaskTypeLabel = (taskType: TaskType): string => {
    if ('registerProvider' in taskType) {
      return `Register ${taskType.registerProvider.provider}`;
    }
    if ('loginAccount' in taskType) {
      return `Login Account #${taskType.loginAccount.account_id}`;
    }
    if ('refreshToken' in taskType) {
      return `Refresh Token #${taskType.refreshToken.account_id}`;
    }
    if ('customScript' in taskType) {
      return `Script: ${taskType.customScript.script_path}`;
    }
    return 'Unknown';
  };

  const getScheduleLabel = (schedule: Schedule): string => {
    if ('once' in schedule) {
      return `Once at ${new Date(schedule.once.timestamp * 1000).toLocaleString()}`;
    }
    if ('interval' in schedule) {
      const hours = Math.floor(schedule.interval.seconds / 3600);
      const minutes = Math.floor((schedule.interval.seconds % 3600) / 60);
      if (hours > 0) {
        return `Every ${hours}h ${minutes}m`;
      }
      return `Every ${minutes}m`;
    }
    if ('daily' in schedule) {
      return `Daily at ${schedule.daily.hour.toString().padStart(2, '0')}:${schedule.daily.minute.toString().padStart(2, '0')}`;
    }
    if ('afterTask' in schedule) {
      return `After task #${schedule.afterTask.task_id} + ${schedule.afterTask.delay_seconds}s`;
    }
    return 'Unknown';
  };

  const getNextRunLabel = (timestamp: number): string => {
    const date = new Date(timestamp * 1000);
    const now = new Date();

    if (date < now) {
      return 'Pending';
    }

    return formatDistanceToNow(date, { addSuffix: true });
  };

  const openCreateTaskModal = (
    mode: 'manual' | 'template' = 'manual',
    templateId: number | null = null
  ) => {
    setCreateTaskMode(mode);
    setCreateTaskTemplateId(templateId);
    setShowCreateModal(true);
  };

  const openCreateTemplate = () => {
    setTemplateEditing(null);
    setTemplateFormState(defaultTemplateFormState());
    setTemplateError(null);
    setTemplateModalOpen(true);
  };

  const openEditTemplate = (tpl: SchedulerTemplate) => {
    setTemplateEditing(tpl);

    const parsed = parseJsonObject(tpl.config || '{}');

    const retry = toObject(parsed.retryPolicy);
    const quiet = toObject(parsed.quietHours);
    const emailSource = toObject(parsed.emailSource);

    const isScenario =
      'customScript' in tpl.taskType
        ? tpl.taskType.customScript.script_path === 'python/run_scenario_replay.py'
        : true;
    const isComposedFlow =
      'customScript' in tpl.taskType
        ? tpl.taskType.customScript.script_path === 'python/run_composed_flow.py'
        : false;

    delete parsed.retryPolicy;
    delete parsed.quietHours;
    delete parsed.runtime;

    setTemplateFormState({
      name: tpl.name,
      description: tpl.description ?? '',
      taskType: isScenario ? 'scenario' : isComposedFlow ? 'composedFlow' : 'script',
      scriptPath:
        'customScript' in tpl.taskType
          ? tpl.taskType.customScript.script_path
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
      emailSourceMode: emailSource?.mode === 'googleSheets' ? 'googleSheets' : 'none',
      emailSourcePolicy:
        emailSource &&
        (emailSource.policy === 'strict' ||
          emailSource.policy === 'fallback_to_pool' ||
          emailSource.policy === 'prefer_pool')
          ? (emailSource.policy as SchedulerTaskFormState['emailSourcePolicy'])
          : 'fallback_to_pool',
      emailListRaw:
        parsed.flow &&
        typeof parsed.flow === 'object' &&
        !Array.isArray(parsed.flow) &&
        Array.isArray((parsed.flow as { dataLists?: unknown }).dataLists)
          ? ((
              (
                parsed.flow as { dataLists: Array<{ id?: string; values?: unknown }> }
              ).dataLists.find(item => item.id === 'emails_pool')?.values as unknown[] | undefined
            )
              ?.map(v => String(v))
              .join('\n') ?? '')
          : '',
      emailSheetId:
        emailSource && typeof emailSource.sheetId === 'string' ? emailSource.sheetId : '',
      emailSheetColumn:
        emailSource && typeof emailSource.column === 'string' ? emailSource.column : '',
      schedule: {
        scheduleType:
          'interval' in tpl.schedule ? 'interval' : 'daily' in tpl.schedule ? 'daily' : 'once',
        intervalSeconds:
          'interval' in tpl.schedule ? String(tpl.schedule.interval.seconds) : '3600',
        hour: 'daily' in tpl.schedule ? String(tpl.schedule.daily.hour) : '9',
        minute: 'daily' in tpl.schedule ? String(tpl.schedule.daily.minute) : '0',
        onceDateTime: 'once' in tpl.schedule ? toDateTimeLocal(tpl.schedule.once.timestamp) : '',
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
      configRaw: JSON.stringify(parsed, null, 2),
    });

    setTemplateError(null);
    setTemplateModalOpen(true);
  };

  const templateValidationError = validateTaskFormState(templateFormState);
  const templateFormValid = templateValidationError === null;

  const saveTemplate = async () => {
    if (!templateFormState.name.trim()) return;
    setTemplateSaving(true);
    setTemplateError(null);
    try {
      if (!templateFormValid) {
        throw new Error(templateValidationError ?? 'Template form is invalid.');
      }

      if (templateEditing) {
        await updateTemplate({
          ...templateEditing,
          name: templateFormState.name.trim(),
          description: (templateFormState.description ?? '').trim() || null,
          taskType: buildTaskTypeFromState(
            templateFormState.taskType,
            templateFormState.scriptPath
          ),
          schedule: buildScheduleFromState(templateFormState.schedule),
          config: JSON.stringify(buildEffectiveConfig(templateFormState), null, 2),
        });
      } else {
        await createTemplate({
          name: templateFormState.name.trim(),
          description: (templateFormState.description ?? '').trim() || null,
          taskType: buildTaskTypeFromState(
            templateFormState.taskType,
            templateFormState.scriptPath
          ),
          schedule: buildScheduleFromState(templateFormState.schedule),
          config: JSON.stringify(buildEffectiveConfig(templateFormState), null, 2),
        });
      }
      setTemplateModalOpen(false);
      setTemplateEditing(null);
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : 'Failed to save template');
    } finally {
      setTemplateSaving(false);
    }
  };

  const openDeleteTemplate = (tpl: SchedulerTemplate) => {
    setTemplateDeleteTarget(tpl);
    setTemplateDeleteOpen(true);
  };

  const confirmDeleteTemplate = async () => {
    if (!templateDeleteTarget) return;
    setTemplateDeleteLoading(true);
    try {
      await deleteTemplate(templateDeleteTarget.id);
      setTemplateDeleteOpen(false);
      setTemplateDeleteTarget(null);
    } finally {
      setTemplateDeleteLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-vsc-bg">
      {/* Header with Stats */}
      <div className="p-6 border-b border-vsc-border">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-vsc-text flex items-center gap-2">
              <Clock className="text-vsc-blue" size={28} />
              Scheduler & Automation
            </h1>
            <p className="text-sm text-vsc-text-muted mt-1">
              Automate registration, logins, and token refreshes
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button variant={isRunning ? 'danger' : 'primary'} onClick={handleToggleScheduler}>
              {isRunning ? (
                <>
                  <Pause size={16} />
                  Stop Scheduler
                </>
              ) : (
                <>
                  <Play size={16} />
                  Start Scheduler
                </>
              )}
            </Button>

            <Button variant="primary" onClick={() => openCreateTaskModal('manual', null)}>
              <Plus size={16} />
              New Task
            </Button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard
            icon={<Calendar size={20} />}
            label="Total Tasks"
            value={tasks.length.toString()}
          />
          <StatCard
            icon={<Zap size={20} />}
            label="Scheduler Status"
            value={isRunning ? 'Running' : 'Stopped'}
          />
          <StatCard
            icon={<TrendingUp size={20} />}
            label="Success Rate"
            value={
              tasks.length > 0
                ? `${Math.round(
                    (tasks.reduce((sum: number, t: any) => sum + t.successCount, 0) /
                      Math.max(
                        tasks.reduce((sum: number, t: any) => sum + t.runCount, 0),
                        1
                      )) *
                      100
                  )}%`
                : '0%'
            }
          />
          <StatCard
            icon={<Clock size={20} />}
            label="Next Run"
            value={
              tasks.filter((t: any) => t.enabled).length > 0
                ? getNextRunLabel(
                    Math.min(...tasks.filter((t: any) => t.enabled).map((t: any) => t.nextRun))
                  )
                : 'None'
            }
          />
        </div>
      </div>

      {/* Tasks List */}
      <div className="flex-1 overflow-auto p-6">
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-sm font-semibold text-vsc-text">Scenario templates</div>
              <div className="text-xs text-vsc-text-muted">
                Create tasks from reusable templates (schedule + config).
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={openCreateTemplate}>
                <Plus size={16} />
                New template
              </Button>
              <Button variant="secondary" onClick={() => openCreateTaskModal('template', null)}>
                <Plus size={16} />
                New from template
              </Button>
            </div>
          </div>

          <div className="rounded-xl border border-vsc-border bg-vsc-sidebar/40 p-4">
            {templatesLoading ? (
              <div className="text-vsc-text-muted text-sm">Loading templates…</div>
            ) : templates.length === 0 ? (
              <div className="text-vsc-text-muted text-sm">No templates yet.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {templates.map(tpl => (
                  <GlassCard key={tpl.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm text-vsc-text font-medium truncate">{tpl.name}</div>
                        {tpl.description ? (
                          <div className="text-xs text-vsc-text-muted mt-1 line-clamp-2">
                            {tpl.description}
                          </div>
                        ) : null}
                        <div className="text-xs text-vsc-text-muted mt-2">
                          {getScheduleLabel(tpl.schedule)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <IconButton
                          title="Create task from template"
                          onClick={() => openCreateTaskModal('template', tpl.id)}
                        >
                          <CopyPlus size={16} />
                        </IconButton>
                        <IconButton title="Edit template" onClick={() => openEditTemplate(tpl)}>
                          <Pencil size={16} />
                        </IconButton>
                        <IconButton
                          title="Delete template"
                          variant="danger"
                          onClick={() => openDeleteTemplate(tpl)}
                        >
                          <Trash2 size={16} />
                        </IconButton>
                      </div>
                    </div>
                  </GlassCard>
                ))}
              </div>
            )}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-vsc-text-muted">Loading tasks...</div>
          </div>
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="No scheduled tasks"
            description="Create your first automated task to get started"
          />
        ) : (
          <div className="space-y-4">
            {tasks.map((task: any) => {
              const successRate = task.runCount > 0 ? (task.successCount / task.runCount) * 100 : 0;

              return (
                <GlassCard key={task.id} className="p-5 hover:border-vsc-blue/30 transition-all">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-3">
                        <Toggle
                          label=""
                          checked={task.enabled}
                          onChange={enabled => handleToggleTask(task.id, enabled)}
                        />
                        <h3 className="text-lg font-medium text-vsc-text">{task.name}</h3>
                        <StatusBadge status={task.enabled ? 'active' : 'inactive'} withDot />
                        {task.lastError && <StatusBadge status="error" withDot />}
                      </div>

                      <div className="grid grid-cols-3 gap-4 text-sm mb-3">
                        <div>
                          <span className="text-vsc-text-muted">Type:</span>
                          <span className="ml-2 text-vsc-text font-medium">
                            {getTaskTypeLabel(task.taskType)}
                          </span>
                        </div>
                        <div>
                          <span className="text-vsc-text-muted">Schedule:</span>
                          <span className="ml-2 text-vsc-text font-medium">
                            {getScheduleLabel(task.schedule)}
                          </span>
                        </div>
                        <div>
                          <span className="text-vsc-text-muted">Next Run:</span>
                          <span className="ml-2 text-vsc-blue font-medium">
                            {getNextRunLabel(task.nextRun)}
                          </span>
                        </div>
                      </div>

                      {/* Progress Bar for Success Rate */}
                      {task.runCount > 0 && (
                        <div className="mb-3">
                          <ProgressBar
                            value={successRate}
                            variant={
                              successRate > 80 ? 'success' : successRate > 50 ? 'warning' : 'danger'
                            }
                            showLabel
                            label="Success Rate"
                          />
                        </div>
                      )}

                      {/* Stats */}
                      <div className="flex items-center gap-4 text-sm">
                        <div className="flex items-center gap-1">
                          <span className="text-vsc-green">✓ {task.successCount}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-vsc-red">✗ {task.errorCount}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-vsc-text-muted">Total: {task.runCount}</span>
                        </div>
                        {task.lastRun && (
                          <div className="flex items-center gap-1">
                            <span className="text-vsc-text-muted">
                              Last:{' '}
                              {formatDistanceToNow(new Date(task.lastRun * 1000), {
                                addSuffix: true,
                              })}
                            </span>
                          </div>
                        )}
                      </div>

                      {task.lastError && (
                        <div className="mt-3 p-2 bg-vsc-red/10 border border-vsc-red/20 rounded text-xs text-vsc-red">
                          {task.lastError}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 ml-4">
                      <IconButton onClick={() => handleExecuteNow(task.id)} title="Run now">
                        <Play size={16} />
                      </IconButton>
                      <IconButton onClick={() => setViewingHistory(task.id)} title="View history">
                        <Clock size={16} />
                      </IconButton>
                      <IconButton onClick={() => setEditingTask(task.id)} title="Edit">
                        <Edit size={16} />
                      </IconButton>
                      <IconButton
                        onClick={() => handleDeleteTask(task.id)}
                        title="Delete"
                        variant="danger"
                      >
                        <Trash2 size={16} />
                      </IconButton>
                    </div>
                  </div>
                </GlassCard>
              );
            })}
          </div>
        )}
      </div>

      {/* Modals */}
      {showCreateModal && (
        <CreateTaskModal
          onClose={() => setShowCreateModal(false)}
          initialMode={createTaskMode}
          initialTemplateId={createTaskTemplateId}
        />
      )}

      {prefilledState ? (
        <SchedulerPrefilledCreateModal
          isOpen={Boolean(prefilledState)}
          initialState={prefilledState}
          onClose={closePrefilledModal}
        />
      ) : null}

      {editingTask !== null && (
        <EditTaskModal taskId={editingTask} onClose={() => setEditingTask(null)} />
      )}

      {viewingHistory !== null && (
        <TaskExecutionHistory taskId={viewingHistory} onClose={() => setViewingHistory(null)} />
      )}

      <Modal
        isOpen={templateModalOpen}
        onClose={() => setTemplateModalOpen(false)}
        title={templateEditing ? 'Edit template' : 'New template'}
        size="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTemplateModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void saveTemplate()}
              isLoading={templateSaving}
              disabled={!templateFormState.name.trim() || !templateFormValid}
            >
              {templateEditing ? 'Save' : 'Create'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {templateError ? (
            <div className="rounded-md border border-vsc-red/30 bg-vsc-red/10 px-3 py-2 text-xs text-vsc-red">
              {templateError}
            </div>
          ) : null}

          <SchedulerTaskForm
            state={templateFormState}
            onChange={setTemplateFormState}
            showDescription
          />
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={templateDeleteOpen}
        onClose={() => {
          setTemplateDeleteOpen(false);
          setTemplateDeleteTarget(null);
        }}
        onConfirm={() => void confirmDeleteTemplate()}
        title="Delete template"
        message={templateDeleteTarget ? `Delete template "${templateDeleteTarget.name}"?` : ''}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        isLoading={templateDeleteLoading}
      />
    </div>
  );
}
