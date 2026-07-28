/**
 * Scheduler Module
 *
 * Handles all scheduler-related operations including:
 * - Task CRUD operations (create, read, update, delete)
 * - Task execution and scheduling
 * - Scheduler service control (start, stop, status)
 * - Task execution history
 */

import type { ScheduledTask, TaskType, Schedule, TaskExecution } from '../../../types/generated';
import { safeInvoke } from '../core';

export type SchedulerTemplate = {
  id: number;
  name: string;
  description: string | null;
  taskType: TaskType;
  schedule: Schedule;
  config: string;
  createdAt: number;
  updatedAt: number;
};

// ============================================
// Task CRUD Operations
// ============================================

/**
 * Get all scheduled tasks
 */
export async function getScheduledTasks(): Promise<ScheduledTask[]> {
  return safeInvoke<ScheduledTask[]>('get_scheduled_tasks');
}

// ============================================
// Task Execution
// ============================================

/**
 * Get execution history for a task
 */
export async function getTaskExecutions(params: {
  taskId: number;
  limit: number;
}): Promise<TaskExecution[]> {
  return safeInvoke<TaskExecution[]>('get_task_executions', {
    taskId: params.taskId,
    limit: params.limit,
  });
}

// ============================================
// Scheduler Service Control
// ============================================

/**
 * Start the scheduler service
 */
export async function startScheduler(): Promise<void> {
  return safeInvoke<void>('start_scheduler');
}

/**
 * Stop the scheduler service
 */
export async function stopScheduler(): Promise<void> {
  return safeInvoke<void>('stop_scheduler');
}

/**
 * Get scheduler service status
 */
export async function getSchedulerStatus(): Promise<boolean> {
  return safeInvoke<boolean>('get_scheduler_status');
}
