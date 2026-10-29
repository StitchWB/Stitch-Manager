/**
 * Logging Module
 *
 * Handles all logging-related operations including:
 * - Query logs with filtering
 * - Add log entries
 * - Clear logs
 * - Export logs
 * - Get log statistics
 */

import { safeInvoke } from '../core';

// ============================================
// Types
// ============================================

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'debug' | 'info' | 'success' | 'warn' | 'error';
  channel?: string;
  source: string;
  message: string;
  details?: Record<string, unknown>;
  correlationId?: string;
  sessionId?: string;
  context?: Record<string, unknown>;
}

export interface LogFilter {
  levels?: string[];
  sources?: string[];
  channels?: string[];
  search?: string;
  fromTime?: string;
  toTime?: string;
  limit?: number;
  offset?: number;
}

export interface LogQueryResult {
  logs: LogEntry[];
  total: number;
  hasMore: boolean;
}

export interface LogStats {
  total: number;
  byLevel: Record<string, number>;
  bySource: Record<string, number>;
  byChannel?: Record<string, number>;
}

// ============================================
// Log Query Operations
// ============================================

/**
 * Get logs with optional filtering
 */
export async function getLogs(filter?: LogFilter): Promise<LogQueryResult> {
  return safeInvoke<LogQueryResult>('get_logs', { filter });
}

/**
 * Get log statistics
 */
export async function getLogStats(): Promise<LogStats> {
  return safeInvoke<LogStats>('get_log_stats');
}

// ============================================
// Log Management
// ============================================

/**
 * Clear application logs
 */
export async function clearAppLogs(beforeDate?: string): Promise<number> {
  return safeInvoke<number>('clear_app_logs', { beforeDate });
}

/**
 * Export application logs
 */
export async function exportAppLogs(filter?: LogFilter, format: string = 'json'): Promise<string> {
  return safeInvoke<string>('export_app_logs', { filter, format });
}
