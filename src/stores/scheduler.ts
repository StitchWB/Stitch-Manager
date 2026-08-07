import { create } from 'zustand';
import { safeInvoke } from '../lib/backend/core';
import { listen, type UnlistenFn } from '../lib/events';
import { toast } from 'sonner';
import type { ScheduledTask, TaskType, Schedule, TaskExecution } from '../types/generated';
import type { SchedulerTemplate } from '../lib/backend/modules/scheduler';

interface SchedulerState {
  tasks: ScheduledTask[];
  templates: SchedulerTemplate[];
  isRunning: boolean;
  loading: boolean;
  templatesLoading: boolean;

  // Actions
  fetchTasks: () => Promise<void>;
  fetchTemplates: () => Promise<void>;
  createTask: (
    name: string,
    taskType: TaskType,
    schedule: Schedule,
    config: string
  ) => Promise<void>;
  createTaskFromTemplate: (templateId: number, nameOverride?: string | null) => Promise<void>;
  updateTask: (task: ScheduledTask) => Promise<void>;
  deleteTask: (taskId: number) => Promise<void>;
  toggleTask: (taskId: number, enabled: boolean) => Promise<void>;
  executeNow: (taskId: number) => Promise<void>;
  getExecutions: (taskId: number, limit: number) => Promise<TaskExecution[]>;
  startScheduler: () => Promise<void>;
  stopScheduler: () => Promise<void>;
  getSchedulerStatus: () => Promise<void>;

  createTemplate: (params: {
    name: string;
    description?: string | null;
    taskType: TaskType;
    schedule: Schedule;
    config: string;
  }) => Promise<void>;
  updateTemplate: (template: SchedulerTemplate) => Promise<void>;
  deleteTemplate: (templateId: number) => Promise<void>;
}

export const useSchedulerStore = create<SchedulerState>((set, get) => ({
  tasks: [],
  templates: [],
  isRunning: false,
  loading: false,
  templatesLoading: false,

  fetchTasks: async () => {
    set({ loading: true });
    try {
      const tasks = await safeInvoke<ScheduledTask[]>('get_scheduled_tasks');
      set({ tasks, loading: false });
    } catch (error) {
      console.error('[Scheduler] Failed to fetch tasks:', error);
      toast.error('Failed to load scheduled tasks');
      set({ loading: false });
    }
  },

  fetchTemplates: async () => {
    set({ templatesLoading: true });
    try {
      const templates = await safeInvoke<SchedulerTemplate[]>('get_scheduler_templates');
      set({ templates, templatesLoading: false });
    } catch (error) {
      console.error('[Scheduler] Failed to fetch templates:', error);
      toast.error('Failed to load scheduler templates');
      set({ templatesLoading: false, templates: [] });
    }
  },

  createTask: async (name, taskType, schedule, config) => {
    try {
      await safeInvoke('create_scheduled_task', { name, taskType, schedule, config });
      toast.success('Task created successfully');
      await get().fetchTasks();
    } catch (error) {
      console.error('[Scheduler] Failed to create task:', error);
      toast.error('Failed to create task');
      throw error;
    }
  },

  createTaskFromTemplate: async (templateId, nameOverride) => {
    try {
      await safeInvoke('create_scheduled_task_from_template', {
        templateId,
        nameOverride: nameOverride ?? null,
      });
      toast.success('Task created successfully');
      await get().fetchTasks();
    } catch (error) {
      console.error('[Scheduler] Failed to create task from template:', error);
      toast.error('Failed to create task from template');
      throw error;
    }
  },

  updateTask: async task => {
    try {
      await safeInvoke('update_scheduled_task', { task });
      toast.success('Task updated successfully');
      await get().fetchTasks();
    } catch (error) {
      console.error('[Scheduler] Failed to update task:', error);
      toast.error('Failed to update task');
      throw error;
    }
  },

  deleteTask: async taskId => {
    try {
      await safeInvoke('delete_scheduled_task', { taskId });
      toast.success('Task deleted successfully');
      await get().fetchTasks();
    } catch (error) {
      console.error('[Scheduler] Failed to delete task:', error);
      toast.error('Failed to delete task');
    }
  },

  toggleTask: async (taskId, enabled) => {
    try {
      await safeInvoke('toggle_scheduled_task', { taskId, enabled });
      toast.success(enabled ? 'Task enabled' : 'Task disabled');
      await get().fetchTasks();
    } catch (error) {
      console.error('[Scheduler] Failed to toggle task:', error);
      toast.error('Failed to toggle task');
    }
  },

  executeNow: async taskId => {
    try {
      const result = await safeInvoke<string>('execute_task_now', { taskId });
      toast.success('Task executed successfully');
      if (import.meta.env.DEV) console.debug('[Scheduler] Execution result:', result);
      await get().fetchTasks();
    } catch (error) {
      console.error('[Scheduler] Failed to execute task:', error);
      toast.error('Failed to execute task');
    }
  },

  getExecutions: async (taskId, limit) => {
    try {
      return await safeInvoke<TaskExecution[]>('get_task_executions', { taskId, limit });
    } catch (error) {
      console.error('[Scheduler] Failed to get executions:', error);
      toast.error('Failed to load execution history');
      return [];
    }
  },

  startScheduler: async () => {
    try {
      await safeInvoke('start_scheduler');
      set({ isRunning: true });
      toast.success('Scheduler started');
    } catch (error) {
      console.error('[Scheduler] Failed to start scheduler:', error);
      toast.error('Failed to start scheduler');
    }
  },

  stopScheduler: async () => {
    try {
      await safeInvoke('stop_scheduler');
      set({ isRunning: false });
      toast.success('Scheduler stopped');
    } catch (error) {
      console.error('[Scheduler] Failed to stop scheduler:', error);
      toast.error('Failed to stop scheduler');
    }
  },

  getSchedulerStatus: async () => {
    try {
      const isRunning = await safeInvoke<boolean>('get_scheduler_status');
      set({ isRunning });
    } catch (error) {
      console.error('[Scheduler] Failed to get scheduler status:', error);
    }
  },

  createTemplate: async params => {
    try {
      await safeInvoke('create_scheduler_template', {
        name: params.name,
        description: params.description ?? null,
        taskType: params.taskType,
        schedule: params.schedule,
        config: params.config,
      });
      toast.success('Template created successfully');
      await get().fetchTemplates();
    } catch (error) {
      console.error('[Scheduler] Failed to create template:', error);
      toast.error('Failed to create template');
      throw error;
    }
  },

  updateTemplate: async template => {
    try {
      await safeInvoke('update_scheduler_template', { template });
      toast.success('Template updated successfully');
      await get().fetchTemplates();
    } catch (error) {
      console.error('[Scheduler] Failed to update template:', error);
      toast.error('Failed to update template');
      throw error;
    }
  },

  deleteTemplate: async templateId => {
    try {
      await safeInvoke('delete_scheduler_template', { templateId });
      toast.success('Template deleted successfully');
      await get().fetchTemplates();
    } catch (error) {
      console.error('[Scheduler] Failed to delete template:', error);
      toast.error('Failed to delete template');
    }
  },
}));

// ─── Task Polling ─────────────────────────────────────────────────────────────
// Single ref-counted polling instance shared by all components, so multiple
// Dashboard widgets don't each fire their own get_scheduled_tasks request.
// Mirrors the startProxyStatusPolling/stopProxyStatusPolling pattern in aiProxy.

let taskPollingInterval: ReturnType<typeof setInterval> | null = null;
let taskPollingSubscribers = 0;
const TASK_POLL_INTERVAL_MS = 10_000;

/** Start polling scheduled tasks. Call on mount of components that need it. */
export function startTaskPolling() {
  taskPollingSubscribers++;
  if (taskPollingSubscribers === 1) {
    void useSchedulerStore.getState().fetchTasks();
    taskPollingInterval = setInterval(
      () => void useSchedulerStore.getState().fetchTasks(),
      TASK_POLL_INTERVAL_MS
    );
  }
}

/** Stop polling scheduled tasks. Call on unmount. */
export function stopTaskPolling() {
  taskPollingSubscribers = Math.max(0, taskPollingSubscribers - 1);
  if (taskPollingSubscribers === 0 && taskPollingInterval) {
    clearInterval(taskPollingInterval);
    taskPollingInterval = null;
  }
}

// ─── Scheduler Status: WS-driven + heartbeat ───────────────────────────────
// Single instance shared by all components.
// WS event 'scheduler.status_changed' is the primary update path; the 60s
// heartbeat is a safety net (paused when the window is hidden).

let statusSubscribers = 0;
let statusHeartbeat: ReturnType<typeof setInterval> | null = null;
let statusUnlistenPromise: Promise<UnlistenFn> | null = null;
const STATUS_HEARTBEAT_INTERVAL_MS = 60_000;

async function fetchSchedulerStatus() {
  try {
    await useSchedulerStore.getState().getSchedulerStatus();
  } catch (err) {
    console.warn('[scheduler store] status fetch failed:', err);
  }
}

function startStatusHeartbeat() {
  if (statusHeartbeat) return;
  statusHeartbeat = setInterval(fetchSchedulerStatus, STATUS_HEARTBEAT_INTERVAL_MS);
}

function stopStatusHeartbeat() {
  if (statusHeartbeat) {
    clearInterval(statusHeartbeat);
    statusHeartbeat = null;
  }
}

// Pause/resume heartbeat on visibility change (registered once, module-level)
let statusVisibilityRegistered = false;
function ensureStatusVisibilityListener() {
  if (statusVisibilityRegistered) return;
  statusVisibilityRegistered = true;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopStatusHeartbeat();
    } else if (statusSubscribers > 0) {
      void fetchSchedulerStatus();
      startStatusHeartbeat();
    }
  });
}

/** Start scheduler status updates. Call on mount of components that need it. */
export function startSchedulerStatusPolling() {
  statusSubscribers++;
  if (statusSubscribers === 1) {
    ensureStatusVisibilityListener();
    void fetchSchedulerStatus();
    statusUnlistenPromise = listen<{ running: boolean }>(
      'scheduler.status_changed',
      (event) => {
        useSchedulerStore.setState({ isRunning: event.payload.running });
      },
    );
    startStatusHeartbeat();
  }
}

/** Stop scheduler status updates. Call on unmount. */
export function stopSchedulerStatusPolling() {
  statusSubscribers = Math.max(0, statusSubscribers - 1);
  if (statusSubscribers === 0) {
    stopStatusHeartbeat();
    if (statusUnlistenPromise) {
      statusUnlistenPromise.then((fn) => fn());
      statusUnlistenPromise = null;
    }
  }
}
