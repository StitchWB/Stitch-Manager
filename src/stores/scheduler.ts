import { create } from 'zustand';
import { safeInvoke } from '../lib/backend/core';
import { listen, type UnlistenFn } from '../lib/events';
import { toast } from 'sonner';
import type { ScheduledTask, TaskType, Schedule, TaskExecution } from '../types/generated';
import type { SchedulerTemplate } from '../lib/backend/modules/scheduler';
import { createLogger } from '../lib/observability/logger';
const log = createLogger('Scheduler');

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

/** Shallow-compare two task lists by content (order-sensitive). */
function sameTasks(a: ScheduledTask[], b: ScheduledTask[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return JSON.stringify(a) === JSON.stringify(b);
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
      set(state => ({
        // Keep the existing array reference when nothing changed, so periodic
        // heartbeat refreshes don't retrigger downstream effects (e.g. the
        // UnifiedActivityFeed getTaskExecutions cascade) on every poll.
        tasks: sameTasks(state.tasks, tasks) ? state.tasks : tasks,
        loading: false,
      }));
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
      log.debug('Execution result:', result);
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

// ─── Task List: WS-driven + heartbeat ───────────────────────────────────────
// Single ref-counted instance shared by all components, so multiple Dashboard
// widgets don't each fire their own get_scheduled_tasks request.
// WS event 'scheduler.tasks_changed' is the primary update path; the 60s
// heartbeat is a safety net (paused when the window is hidden).

let taskSubscribers = 0;
let taskHeartbeat: ReturnType<typeof setInterval> | null = null;
let taskUnlistenPromise: Promise<UnlistenFn> | null = null;
let tasksFetchInFlight = false;
const TASK_HEARTBEAT_INTERVAL_MS = 60_000;

async function fetchTasksSafe() {
  if (tasksFetchInFlight) return;
  tasksFetchInFlight = true;
  try {
    await useSchedulerStore.getState().fetchTasks();
  } catch (err) {
    console.warn('[scheduler store] tasks fetch failed:', err);
  } finally {
    tasksFetchInFlight = false;
  }
}

function startTaskHeartbeat() {
  if (taskHeartbeat) return;
  taskHeartbeat = setInterval(fetchTasksSafe, TASK_HEARTBEAT_INTERVAL_MS);
}

function stopTaskHeartbeat() {
  if (taskHeartbeat) {
    clearInterval(taskHeartbeat);
    taskHeartbeat = null;
  }
}

/** Start task list updates. Call on mount of components that need it. */
export function startTaskPolling() {
  taskSubscribers++;
  if (taskSubscribers === 1) {
    ensureVisibilityListener();
    void fetchTasksSafe();
    taskUnlistenPromise = listen('scheduler.tasks_changed', () => {
      void fetchTasksSafe();
    });
    startTaskHeartbeat();
  }
}

/** Stop task list updates. Call on unmount. */
export function stopTaskPolling() {
  taskSubscribers = Math.max(0, taskSubscribers - 1);
  if (taskSubscribers === 0) {
    stopTaskHeartbeat();
    if (taskUnlistenPromise) {
      taskUnlistenPromise.then((fn) => fn());
      taskUnlistenPromise = null;
    }
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

// Pause/resume heartbeats on visibility change (registered once, module-level)
let visibilityRegistered = false;
function ensureVisibilityListener() {
  if (visibilityRegistered) return;
  visibilityRegistered = true;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopStatusHeartbeat();
      stopTaskHeartbeat();
    } else {
      if (statusSubscribers > 0) {
        void fetchSchedulerStatus();
        startStatusHeartbeat();
      }
      if (taskSubscribers > 0) {
        void fetchTasksSafe();
        startTaskHeartbeat();
      }
    }
  });
}

/** Start scheduler status updates. Call on mount of components that need it. */
export function startSchedulerStatusPolling() {
  statusSubscribers++;
  if (statusSubscribers === 1) {
    ensureVisibilityListener();
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