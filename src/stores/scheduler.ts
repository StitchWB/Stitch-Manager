import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import type { ScheduledTask, TaskType, Schedule, TaskExecution } from '../types/generated';
import type { SchedulerTemplate } from '../lib/tauri/modules/scheduler';

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
      const tasks = await invoke<ScheduledTask[]>('get_scheduled_tasks');
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
      const templates = await invoke<SchedulerTemplate[]>('get_scheduler_templates');
      set({ templates, templatesLoading: false });
    } catch (error) {
      console.error('[Scheduler] Failed to fetch templates:', error);
      toast.error('Failed to load scheduler templates');
      set({ templatesLoading: false, templates: [] });
    }
  },

  createTask: async (name, taskType, schedule, config) => {
    try {
      await invoke('create_scheduled_task', { name, taskType, schedule, config });
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
      await invoke('create_scheduled_task_from_template', {
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
      await invoke('update_scheduled_task', { task });
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
      await invoke('delete_scheduled_task', { taskId });
      toast.success('Task deleted successfully');
      await get().fetchTasks();
    } catch (error) {
      console.error('[Scheduler] Failed to delete task:', error);
      toast.error('Failed to delete task');
    }
  },

  toggleTask: async (taskId, enabled) => {
    try {
      await invoke('toggle_scheduled_task', { taskId, enabled });
      toast.success(enabled ? 'Task enabled' : 'Task disabled');
      await get().fetchTasks();
    } catch (error) {
      console.error('[Scheduler] Failed to toggle task:', error);
      toast.error('Failed to toggle task');
    }
  },

  executeNow: async taskId => {
    try {
      const result = await invoke<string>('execute_task_now', { taskId });
      toast.success('Task executed successfully');
      console.log('[Scheduler] Execution result:', result);
      await get().fetchTasks();
    } catch (error) {
      console.error('[Scheduler] Failed to execute task:', error);
      toast.error('Failed to execute task');
    }
  },

  getExecutions: async (taskId, limit) => {
    try {
      return await invoke<TaskExecution[]>('get_task_executions', { taskId, limit });
    } catch (error) {
      console.error('[Scheduler] Failed to get executions:', error);
      toast.error('Failed to load execution history');
      return [];
    }
  },

  startScheduler: async () => {
    try {
      await invoke('start_scheduler');
      set({ isRunning: true });
      toast.success('Scheduler started');
    } catch (error) {
      console.error('[Scheduler] Failed to start scheduler:', error);
      toast.error('Failed to start scheduler');
    }
  },

  stopScheduler: async () => {
    try {
      await invoke('stop_scheduler');
      set({ isRunning: false });
      toast.success('Scheduler stopped');
    } catch (error) {
      console.error('[Scheduler] Failed to stop scheduler:', error);
      toast.error('Failed to stop scheduler');
    }
  },

  getSchedulerStatus: async () => {
    try {
      const isRunning = await invoke<boolean>('get_scheduler_status');
      set({ isRunning });
    } catch (error) {
      console.error('[Scheduler] Failed to get scheduler status:', error);
    }
  },

  createTemplate: async params => {
    try {
      await invoke('create_scheduler_template', {
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
      await invoke('update_scheduler_template', { template });
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
      await invoke('delete_scheduler_template', { templateId });
      toast.success('Template deleted successfully');
      await get().fetchTemplates();
    } catch (error) {
      console.error('[Scheduler] Failed to delete template:', error);
      toast.error('Failed to delete template');
    }
  },
}));
