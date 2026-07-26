import { create } from 'zustand';
import { listen, UnlistenFn } from '@/lib/events';
import { getLogs, clearAppLogs, exportAppLogs, getLogStats } from '../lib/tauri/modules/logs';
import { TauriError } from '../lib/tauri/core/types';

// ============================================
// Types
// ============================================

export type LogLevel = 'debug' | 'info' | 'success' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  channel?: string;
  message: string;
  source: string;
  details?: Record<string, unknown>;
  correlationId?: string;
  sessionId?: string;
  context?: Record<string, unknown>;
}

export interface LogFilter {
  levels?: LogLevel[];
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
  totalLogs: number;
  byLevel: Record<LogLevel, number>;
  bySource: Record<string, number>;
  byChannel?: Record<string, number>;
  oldestLog?: string;
  newestLog?: string;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof TauriError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

// ============================================
// Default Filter
// ============================================

const DEFAULT_FILTER: LogFilter = {
  levels: [],
  sources: [],
  channels: [],
  search: undefined,
  fromTime: undefined,
  toTime: undefined,
  limit: 50,
  offset: 0,
};

// ============================================
// Store Interface
// ============================================

interface LogsState {
  // Data
  logs: LogEntry[];
  total: number;
  hasMore: boolean;
  stats: LogStats | null;

  // Filter state
  filter: LogFilter;

  // UI state
  isLoading: boolean;
  error: string | null;

  // Grouping state
  groupingEnabled: boolean;
  autoCollapseSuccess: boolean;
  collapsedGroups: Set<string>;

  // Real-time subscription
  unsubscribe: UnlistenFn | null;

  // Actions
  fetchLogs: (filter?: LogFilter) => Promise<void>;
  loadMore: () => Promise<void>;
  clearLogs: (beforeDate?: string) => Promise<number>;
  exportLogs: (format: 'json' | 'csv' | 'txt') => Promise<string>;
  fetchStats: () => Promise<void>;

  // Filter actions
  setFilter: (filter: Partial<LogFilter>) => void;
  resetFilter: () => void;

  // Grouping actions
  toggleGroup: (groupId: string) => void;
  setGroupingEnabled: (enabled: boolean) => void;
  setAutoCollapseSuccess: (enabled: boolean) => void;
  expandAllGroups: () => void;
  collapseAllGroups: () => void;

  // Real-time
  subscribeToLogs: () => Promise<void>;
  unsubscribeFromLogs: () => void;

  // Local actions (for optimistic updates)
  addLocalLog: (log: Omit<LogEntry, 'id' | 'timestamp'>) => void;

  // Legacy compatibility - alias for addLocalLog
  addLog: (log: Omit<LogEntry, 'id' | 'timestamp'>) => void;
}

// ============================================
// Store Implementation
// ============================================

export const useLogsStore = create<LogsState>((set, get) => ({
  // Initial state
  logs: [],
  total: 0,
  hasMore: false,
  stats: null,
  filter: DEFAULT_FILTER,
  isLoading: false,
  error: null,
  unsubscribe: null,

  // Grouping state
  groupingEnabled: true,
  autoCollapseSuccess: true,
  collapsedGroups: new Set(),

  // Fetch logs from backend
  fetchLogs: async (filter?: LogFilter) => {
    const currentFilter = filter ?? get().filter;
    set({ isLoading: true, error: null, filter: { ...currentFilter, offset: 0 } });

    try {
      const result = await getLogs({ ...currentFilter, offset: 0 });

      set({
        logs: result.logs,
        total: result.total,
        hasMore: result.hasMore,
        isLoading: false,
      });
    } catch (error) {
      set({
        error: normalizeErrorMessage(error),
        isLoading: false,
      });
    }
  },

  // Load more logs (pagination)
  loadMore: async () => {
    const { filter, logs, hasMore, isLoading } = get();
    if (!hasMore || isLoading) return;

    const newOffset = (filter.offset ?? 0) + (filter.limit ?? 50);
    set({ isLoading: true });

    try {
      const result = await getLogs({ ...filter, offset: newOffset });

      set({
        logs: [...logs, ...result.logs],
        hasMore: result.hasMore,
        filter: { ...filter, offset: newOffset },
        isLoading: false,
      });
    } catch (error) {
      set({
        error: normalizeErrorMessage(error),
        isLoading: false,
      });
    }
  },

  // Clear logs
  clearLogs: async (beforeDate?: string) => {
    try {
      const deleted = await clearAppLogs(beforeDate);
      // Refresh logs after clearing
      await get().fetchLogs();
      return deleted;
    } catch (error) {
      set({ error: normalizeErrorMessage(error) });
      throw error;
    }
  },

  // Export logs
  exportLogs: async (format: 'json' | 'csv' | 'txt') => {
    const { filter } = get();
    try {
      return await exportAppLogs(filter, format);
    } catch (error) {
      set({ error: normalizeErrorMessage(error) });
      throw error;
    }
  },

  // Fetch statistics
  fetchStats: async () => {
    try {
      const stats = await getLogStats();
      // Backend returns { total, byLevel, bySource } (camelCase)
      // Store expects legacy-compatible shape.
      set({
        stats: {
          totalLogs: stats.total,
          byLevel: stats.byLevel as Record<LogLevel, number>,
          bySource: stats.bySource,
          byChannel: stats.byChannel,
        },
      });
    } catch (error) {
      set({ error: normalizeErrorMessage(error) });
    }
  },

  // Filter actions
  setFilter: (newFilter: Partial<LogFilter>) => {
    const currentFilter = get().filter;
    const updatedFilter = { ...currentFilter, ...newFilter, offset: 0 };
    get().fetchLogs(updatedFilter);
  },

  resetFilter: () => {
    get().fetchLogs(DEFAULT_FILTER);
  },

  // Grouping actions
  toggleGroup: (groupId: string) => {
    const { collapsedGroups } = get();
    const newSet = new Set(collapsedGroups);
    if (newSet.has(groupId)) {
      newSet.delete(groupId);
    } else {
      newSet.add(groupId);
    }
    set({ collapsedGroups: newSet });
  },

  setGroupingEnabled: (enabled: boolean) => {
    set({ groupingEnabled: enabled });
  },

  setAutoCollapseSuccess: (enabled: boolean) => {
    set({ autoCollapseSuccess: enabled });
  },

  expandAllGroups: () => {
    set({ collapsedGroups: new Set() });
  },

  collapseAllGroups: () => {
    const { logs } = get();
    // Collapse all unique stages (detected from messages)
    const allGroups = new Set(
      logs.map(log => {
        const stageMatch = log.message.match(/\[([^\]]+)\]/);
        return stageMatch ? stageMatch[1] : log.source;
      })
    );
    set({ collapsedGroups: allGroups });
  },

  // Subscribe to real-time log events
  subscribeToLogs: async () => {
    const { unsubscribe: existingUnsub } = get();
    if (existingUnsub) return; // Already subscribed

    const dedupWindowMs = 1500;
    const recentBySignature = new Map<string, number>();

    const makeSignature = (log: LogEntry): string => {
      const bucket = Math.floor(new Date(log.timestamp).getTime() / 1000);
      return `${log.level}|${log.source}|${log.channel ?? 'app'}|${log.message}|${bucket}`;
    };

    const isDuplicate = (incoming: LogEntry, existing: LogEntry[]): boolean => {
      if (existing.some(l => l.id === incoming.id)) return true;

      const sig = makeSignature(incoming);
      const now = Date.now();
      const seenTs = recentBySignature.get(sig);
      if (typeof seenTs === 'number' && now - seenTs < dedupWindowMs) {
        return true;
      }

      // Additional guard against same-content duplicates with different IDs.
      const incomingTs = new Date(incoming.timestamp).getTime();
      const near = existing.some(l => {
        if (l.level !== incoming.level) return false;
        if ((l.channel ?? 'app') !== (incoming.channel ?? 'app')) return false;
        if (l.source !== incoming.source) return false;
        if (l.message !== incoming.message) return false;
        const dt = Math.abs(new Date(l.timestamp).getTime() - incomingTs);
        return dt < dedupWindowMs;
      });
      if (near) return true;

      recentBySignature.set(sig, now);
      // lightweight cleanup
      if (recentBySignature.size > 500) {
        const cutoff = now - 10_000;
        for (const [key, ts] of recentBySignature.entries()) {
          if (ts < cutoff) recentBySignature.delete(key);
        }
      }
      return false;
    };

    const unsub = await listen<LogEntry>('logs:new', event => {
      const { logs, filter, groupingEnabled, autoCollapseSuccess, collapsedGroups } = get();
      const newLog = event.payload;

      if (isDuplicate(newLog, logs)) {
        return;
      }

      // Check if log matches current filter
      const matchesFilter =
        (filter.levels?.length === 0 || filter.levels?.includes(newLog.level)) &&
        (filter.sources?.length === 0 || filter.sources?.includes(newLog.source)) &&
        (filter.channels?.length === 0 || filter.channels?.includes(newLog.channel ?? 'app')) &&
        (!filter.search || newLog.message.toLowerCase().includes(filter.search.toLowerCase()));

      if (matchesFilter) {
        const updatedLogs = [newLog, ...logs].slice(0, filter.limit ?? 50);

        // Auto-collapse logic
        if (groupingEnabled && autoCollapseSuccess) {
          // Detect stage from new log
          const stageMatches = newLog.message.match(/\[([^\]]+)\]/g);
          let stage = newLog.source;

          if (stageMatches && stageMatches.length > 0) {
            const lastMatch = stageMatches[stageMatches.length - 1];
            const extracted = lastMatch.slice(1, -1);

            // Filter out account IDs (contain /)
            if (!extracted.includes('/') && extracted.length > 0) {
              stage = extracted;
            } else if (stageMatches.length > 1) {
              // Try second-to-last if last was account ID
              const secondLast = stageMatches[stageMatches.length - 2];
              const extracted2 = secondLast.slice(1, -1);
              if (!extracted2.includes('/') && extracted2.length > 0) {
                stage = extracted2;
              }
            }
          }

          // Check if this is a success log
          if (
            newLog.level === 'success' ||
            newLog.message.includes('✅') ||
            newLog.message.includes('[OK]')
          ) {
            // Count logs in this stage
            const stageLogs = updatedLogs.filter(l => {
              const logStageMatches = l.message.match(/\[([^\]]+)\]/g);
              let logStage = l.source;

              if (logStageMatches && logStageMatches.length > 0) {
                const lastMatch = logStageMatches[logStageMatches.length - 1];
                const extracted = lastMatch.slice(1, -1);
                if (!extracted.includes('/') && extracted.length > 0) {
                  logStage = extracted;
                } else if (logStageMatches.length > 1) {
                  const secondLast = logStageMatches[logStageMatches.length - 2];
                  const extracted2 = secondLast.slice(1, -1);
                  if (!extracted2.includes('/') && extracted2.length > 0) {
                    logStage = extracted2;
                  }
                }
              }

              return logStage === stage;
            });

            // Auto-collapse if >5 entries
            if (stageLogs.length > 5) {
              const newCollapsedGroups = new Set(collapsedGroups);
              newCollapsedGroups.add(stage);

              set({
                logs: updatedLogs,
                total: get().total + 1,
                collapsedGroups: newCollapsedGroups,
              });
              return;
            }
          }
        }

        set({
          logs: updatedLogs,
          total: get().total + 1,
        });
      }
    });

    // Also listen for clear events
    const clearUnsub = await listen<number>('logs:cleared', () => {
      get().fetchLogs();
    });

    set({
      unsubscribe: () => {
        unsub();
        clearUnsub();
      },
    });
  },

  // Unsubscribe from real-time events
  unsubscribeFromLogs: () => {
    const { unsubscribe } = get();
    if (unsubscribe) {
      unsubscribe();
      set({ unsubscribe: null });
    }
  },

  // Add local log (for optimistic UI updates)
  addLocalLog: log => {
    const newLog: LogEntry = {
      ...log,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };

    const { logs, filter } = get();
    set({
      logs: [newLog, ...logs].slice(0, filter.limit ?? 50),
      total: get().total + 1,
    });
  },

  // Legacy compatibility - alias for addLocalLog
  addLog: log => {
    get().addLocalLog(log);
  },
}));

// ============================================
// Helper function to add logs from anywhere (non-React contexts)
// ============================================

export const appLog = (level: LogLevel, message: string, source: string = 'system') => {
  useLogsStore.getState().addLocalLog({ level, message, source });
};
