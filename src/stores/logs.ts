import { create } from 'zustand';

export interface AppLogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug' | 'success';
  message: string;
  source?: string;
}

interface LogsState {
  logs: AppLogEntry[];
  maxLogs: number;
  
  // Actions
  addLog: (log: Omit<AppLogEntry, 'id' | 'timestamp'>) => void;
  clearLogs: () => void;
  setMaxLogs: (max: number) => void;
}

export const useLogsStore = create<LogsState>((set) => ({
  logs: [],
  maxLogs: 1000,

  addLog: (log) => set((state) => {
    const newLog: AppLogEntry = {
      ...log,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };
    
    const logs = [newLog, ...state.logs].slice(0, state.maxLogs);
    return { logs };
  }),

  clearLogs: () => set({ logs: [] }),
  
  setMaxLogs: (max) => set({ maxLogs: max }),
}));
