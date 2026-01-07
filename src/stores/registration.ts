import { create } from 'zustand';
import { startRegistration, stopRegistration, getSettings, updateSettings } from '../lib/tauri';
import type { 
  ProviderName, 
  RegistrationLog, 
  RegistrationProgress,
  RegistrationStatus 
} from '../types';

// Email strategy types
export type EmailStrategy = 'single' | 'plus-alias' | 'catch-all' | 'pool';

// Registration mode types
export type RegistrationMode = 'webview' | 'automated' | 'auto';

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
  registrationMode: RegistrationMode;
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

// Save status for UI feedback
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

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
  
  // Settings state
  settingsLoaded: boolean;
  saveStatus: SaveStatus;
  imapPasswordSet: boolean;
  
  // Actions - Config (all trigger auto-save)
  setProvider: (provider: ProviderName) => void;
  setRegistrationMode: (mode: RegistrationMode) => void;
  setEmailStrategy: (strategy: EmailStrategy) => void;
  setIMAPConfig: (imap: Partial<IMAPConfig>) => void;
  setProxyConfig: (proxy: Partial<ProxyConfig>) => void;
  setCount: (count: number) => void;
  setHeadless: (headless: boolean) => void;
  
  // Actions - Settings persistence
  loadSettings: () => Promise<void>;
  saveSettings: () => Promise<void>;
  
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
  registrationMode: 'webview',
  emailStrategy: 'catch-all',
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
    username: '',
    password: '',
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

// Debounce timer for auto-save
let saveTimeout: ReturnType<typeof setTimeout> | null = null;

export const useRegistrationStore = create<RegistrationState>((set, get) => {
  // Helper to trigger debounced save
  const triggerSave = () => {
    const store = get();
    if (!store.settingsLoaded) return;
    
    if (saveTimeout) clearTimeout(saveTimeout);
    set({ saveStatus: 'saving' });
    
    saveTimeout = setTimeout(async () => {
      await store.saveSettings();
    }, 800);
  };

  return {
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
    settingsLoaded: false,
    saveStatus: 'idle',
    imapPasswordSet: false,

    // Config actions - all trigger auto-save
    setProvider: (provider: ProviderName) => {
      set((state) => ({ config: { ...state.config, provider } }));
      triggerSave();
    },

    setRegistrationMode: (registrationMode: RegistrationMode) => {
      set((state) => ({ config: { ...state.config, registrationMode } }));
      triggerSave();
    },

    setEmailStrategy: (emailStrategy: EmailStrategy) => {
      set((state) => ({ config: { ...state.config, emailStrategy } }));
      triggerSave();
    },

    setIMAPConfig: (imap: Partial<IMAPConfig>) => {
      set((state) => ({
        config: { 
          ...state.config, 
          imap: { ...state.config.imap, ...imap } 
        }
      }));
      triggerSave();
    },

    setProxyConfig: (proxy: Partial<ProxyConfig>) => {
      set((state) => ({
        config: { 
          ...state.config, 
          proxy: { ...state.config.proxy, ...proxy } 
        }
      }));
      triggerSave();
    },

    setCount: (count: number) => {
      set((state) => ({
        config: { ...state.config, count: Math.max(1, Math.min(100, count)) }
      }));
      triggerSave();
    },

    setHeadless: (headless: boolean) => {
      set((state) => ({ config: { ...state.config, headless } }));
      triggerSave();
    },

    // Settings persistence
    loadSettings: async () => {
      try {
        const settings = await getSettings();
        set((state) => {
          return {
            config: {
              ...state.config,
              provider: (settings.provider as ProviderName) || 'kiro',
              registrationMode: (settings.registration_mode as RegistrationMode) || 'webview',
              emailStrategy: (settings.email_strategy as EmailStrategy) || 'catch-all',
              imap: {
                ...state.config.imap,
                server: settings.imap_server || '',
                port: settings.imap_port || 993,
                email: settings.imap_email || '',
                password: settings.imap_password || '',
              },
              proxy: {
                ...state.config.proxy,
                enabled: settings.proxy_enabled || false,
                url: settings.proxy_url || '',
                username: settings.proxy_username || '',
                password: settings.proxy_password || '',
              },
              count: settings.count || 1,
              headless: settings.headless ?? true,
            },
            settingsLoaded: true,
            imapPasswordSet: !!settings.imap_password,
          };
        });
      } catch (error) {
        console.error('Failed to load settings:', error);
        set({ settingsLoaded: true });
      }
    },

    saveSettings: async () => {
      const { config } = get();
      try {
        // Only send password if it's not empty (don't overwrite with empty)
        const updateData: Record<string, unknown> = {
          provider: config.provider,
          registration_mode: config.registrationMode,
          email_strategy: config.emailStrategy,
          imap_server: config.imap.server,
          imap_port: config.imap.port,
          imap_email: config.imap.email,
          proxy_enabled: config.proxy.enabled,
          proxy_url: config.proxy.url,
          proxy_username: config.proxy.username,
          count: config.count,
          headless: config.headless,
        };
        
        // Only include passwords if they have actual values
        if (config.imap.password) {
          updateData.imap_password = config.imap.password;
        }
        if (config.proxy.password) {
          updateData.proxy_password = config.proxy.password;
        }
        
        await updateSettings(updateData);
        set({ saveStatus: 'saved' });
        // Reset to idle after 2 seconds
        setTimeout(() => set({ saveStatus: 'idle' }), 2000);
      } catch (error) {
        console.error('Failed to save settings:', error);
        set({ saveStatus: 'error' });
        setTimeout(() => set({ saveStatus: 'idle' }), 3000);
      }
    },

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
  };
});
