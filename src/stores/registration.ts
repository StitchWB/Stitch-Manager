import { create } from 'zustand';
import { startRegistration, stopRegistration } from '../lib/tauri';
import type { 
  ProviderName, 
  RegistrationLog, 
  RegistrationProgress,
  RegistrationStatus 
} from '../types';

// Email strategy types
export type EmailStrategy = 'single' | 'plus-alias' | 'catch-all' | 'pool';

// IMAP configuration
export interface IMAPConfig {
  server: string;
  port: number;
  email: string;
  password: string;
  useTLS: boolean;
}

// Proxy configuration
export interface ProxyConfig {
  enabled: boolean;
  url: string;
  username?: string;
  password?: string;
}

// Registration configuration
export interface RegistrationConfig {
  provider: ProviderName;
  emailStrategy: EmailStrategy;
  imap: IMAPConfig;
  proxy: ProxyConfig;
  count: number;
  headless: boolean;
  timeout: number;
  retryAttempts: number;
}

// Registration result for the results table
export interface RegistrationResult {
  id: string;
  email: string;
  status: 'success' | 'failed';
  token?: string;
  error?: string;
  createdAt: string;
}

interface RegistrationState {
  // Configuration
  config: RegistrationConfig;
  
  // Status
  isRunning: boolean;
  status: RegistrationStatus;
  
  // Progress
  progress: RegistrationProgress;
  
  // Logs
  logs: RegistrationLog[];
  
  // Results
  results: RegistrationResult[];
  successCount: number;
  failedCount: number;
  
  // WebSocket
  wsConnected: boolean;
  
  // Actions - Config
  setConfig: (config: Partial<RegistrationConfig>) => void;
  setProvider: (provider: ProviderName) => void;
  setEmailStrategy: (strategy: EmailStrategy) => void;
  setIMAPConfig: (imap: Partial<IMAPConfig>) => void;
  setProxyConfig: (proxy: Partial<ProxyConfig>) => void;
  setCount: (count: number) => void;
  setHeadless: (headless: boolean) => void;
  
  // Actions - Control
  start: () => Promise<void>;
  stop: () => Promise<void>;
  reset: () => void;
  
  // Actions - Logs
  addLog: (log: Omit<RegistrationLog, 'id' | 'timestamp'>) => void;
  clearLogs: () => void;
  
  // Actions - Progress
  setProgress: (progress: Partial<RegistrationProgress>) => void;
  
  // Actions - Results
  addResult: (result: Omit<RegistrationResult, 'id' | 'createdAt'>) => void;
  clearResults: () => void;
  
  // Actions - WebSocket
  setWsConnected: (connected: boolean) => void;
}

const DEFAULT_CONFIG: RegistrationConfig = {
  provider: 'kiro',
  emailStrategy: 'single',
  imap: {
    server: '',
    port: 993,
    email: '',
    password: '',
    useTLS: true,
  },
  proxy: {
    enabled: false,
    url: '',
  },
  count: 1,
  headless: true,
  timeout: 60000,
  retryAttempts: 3,
};

const DEFAULT_PROGRESS: RegistrationProgress = {
  current: 0,
  total: 0,
  percentage: 0,
};

export const useRegistrationStore = create<RegistrationState>((set, get) => ({
  // Initial state
  config: DEFAULT_CONFIG,
  isRunning: false,
  status: 'idle',
  progress: DEFAULT_PROGRESS,
  logs: [],
  results: [],
  successCount: 0,
  failedCount: 0,
  wsConnected: false,

  // Config actions
  setConfig: (config: Partial<RegistrationConfig>) => set((state) => ({
    config: { ...state.config, ...config }
  })),

  setProvider: (provider: ProviderName) => set((state) => ({
    config: { ...state.config, provider }
  })),

  setEmailStrategy: (emailStrategy: EmailStrategy) => set((state) => ({
    config: { ...state.config, emailStrategy }
  })),

  setIMAPConfig: (imap: Partial<IMAPConfig>) => set((state) => ({
    config: { 
      ...state.config, 
      imap: { ...state.config.imap, ...imap } 
    }
  })),

  setProxyConfig: (proxy: Partial<ProxyConfig>) => set((state) => ({
    config: { 
      ...state.config, 
      proxy: { ...state.config.proxy, ...proxy } 
    }
  })),

  setCount: (count: number) => set((state) => ({
    config: { ...state.config, count: Math.max(1, Math.min(100, count)) }
  })),

  setHeadless: (headless: boolean) => set((state) => ({
    config: { ...state.config, headless }
  })),

  // Control actions
  start: async () => {
    const { config, addLog } = get();
    set({ 
      isRunning: true, 
      status: 'initializing',
      progress: { current: 0, total: config.count, percentage: 0 },
      successCount: 0,
      failedCount: 0,
    });
    addLog({ level: 'info', message: `Starting registration for ${config.count} account(s)...` });
    addLog({ level: 'info', message: `Provider: ${config.provider}, Strategy: ${config.emailStrategy}` });
    
    // Call Tauri API to start registration
    try {
      await startRegistration({
        provider: config.provider,
        config: {
          provider: config.provider,
          count: config.count,
          useProxy: config.proxy.enabled,
          headless: config.headless,
        },
      });
      addLog({ level: 'success', message: 'Registration request sent to backend' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addLog({ level: 'error', message: `Failed to start registration: ${message}` });
      set({ isRunning: false, status: 'failed' });
    }
  },

  stop: async () => {
    const { addLog } = get();
    try {
      await stopRegistration();
      addLog({ level: 'warn', message: 'Registration stopped by user' });
    } catch (error) {
      addLog({ level: 'error', message: 'Failed to stop registration' });
    }
    set({ isRunning: false, status: 'cancelled' });
  },

  reset: () => set({
    isRunning: false,
    status: 'idle',
    progress: DEFAULT_PROGRESS,
    logs: [],
    results: [],
    successCount: 0,
    failedCount: 0,
  }),

  // Log actions
  addLog: (log: Omit<RegistrationLog, 'id' | 'timestamp'>) => set((state) => ({
    logs: [
      ...state.logs,
      {
        ...log,
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      }
    ]
  })),

  clearLogs: () => set({ logs: [] }),

  // Progress actions
  setProgress: (progress: Partial<RegistrationProgress>) => set((state) => ({
    progress: { ...state.progress, ...progress }
  })),

  // Result actions
  addResult: (result: Omit<RegistrationResult, 'id' | 'createdAt'>) => set((state) => {
    const newResult: RegistrationResult = {
      ...result,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    return {
      results: [...state.results, newResult],
      successCount: result.status === 'success' ? state.successCount + 1 : state.successCount,
      failedCount: result.status === 'failed' ? state.failedCount + 1 : state.failedCount,
    };
  }),

  clearResults: () => set({ results: [], successCount: 0, failedCount: 0 }),

  // WebSocket actions
  setWsConnected: (connected: boolean) => set({ wsConnected: connected }),
}));
