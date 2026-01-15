import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

// ============================================
// Types
// ============================================

export type LogLevel = 'debug' | 'info' | 'success' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  message: string;
  source: string;
  details?: Record<string, unknown>;
}

export interface LogFilter {
  levels?: LogLevel[];
  sources?: string[];
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
  oldestLog?: string;
  newestLog?: string;
}

// ============================================
// Default Filter
// ============================================

const DEFAULT_FILTER: LogFilter = {
  levels: [],
  sources: [],
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

  // Fetch logs from backend
  fetchLogs: async (filter?: LogFilter) => {
    const currentFilter = filter ?? get().filter;
    set({ isLoading: true, error: null, filter: { ...currentFilter, offset: 0 } });
    
    try {
      const result = await invoke<LogQueryResult>('get_logs', { 
        filter: { ...currentFilter, offset: 0 } 
      });
      
      set({
        logs: result.logs,
        total: result.total,
        hasMore: result.hasMore,
        isLoading: false,
      });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : String(error),
        isLoading: false 
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
      const result = await invoke<LogQueryResult>('get_logs', {
        filter: { ...filter, offset: newOffset }
      });
      
      set({
        logs: [...logs, ...result.logs],
        hasMore: result.hasMore,
        filter: { ...filter, offset: newOffset },
        isLoading: false,
      });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : String(error),
        isLoading: false 
      });
    }
  },

  // Clear logs
  clearLogs: async (beforeDate?: string) => {
    try {
      const deleted = await invoke<number>('clear_logs', { beforeDate });
      // Refresh logs after clearing
      await get().fetchLogs();
      return deleted;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },

  // Export logs
  exportLogs: async (format: 'json' | 'csv' | 'txt') => {
    const { filter } = get();
    try {
      return await invoke<string>('export_logs', { filter, format });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },

  // Fetch statistics
  fetchStats: async () => {
    try {
      const stats = await invoke<LogStats>('get_log_stats');
      set({ stats });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
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

  // Subscribe to real-time log events
  subscribeToLogs: async () => {
    const { unsubscribe: existingUnsub } = get();
    if (existingUnsub) return; // Already subscribed
    
    const unsub = await listen<LogEntry>('logs:new', (event) => {
      const { logs, filter } = get();
      const newLog = event.payload;
      
      // Check if log matches current filter
      const matchesFilter = (
        (filter.levels?.length === 0 || filter.levels?.includes(newLog.level)) &&
        (filter.sources?.length === 0 || filter.sources?.includes(newLog.source)) &&
        (!filter.search || newLog.message.toLowerCase().includes(filter.search.toLowerCase()))
      );
      
      if (matchesFilter) {
        set({ 
          logs: [newLog, ...logs].slice(0, filter.limit ?? 50),
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
      }
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
  addLocalLog: (log) => {
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
  addLog: (log) => {
    get().addLocalLog(log);
  },
}));

// ============================================
// Helper function to add logs from anywhere (non-React contexts)
// ============================================

export const appLog = (
  level: LogLevel,
  message: string,
  source: string = 'system'
) => {
  useLogsStore.getState().addLocalLog({ level, message, source });
};
