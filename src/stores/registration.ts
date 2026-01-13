import { create } from 'zustand';
import { getSettings, updateSettings } from '../lib/tauri';
import type { 
  ProviderName, 
  RegistrationLog, 
  RegistrationProgress,
  RegistrationStatus 
} from '../types';

// IMAP configuration (kept for future email verification)
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

// Auto-registration credentials
export interface AutoRegCredentials {
  email: string;
  password: string;
}

// Email pattern types
export type EmailPattern = 'random' | 'name_random' | 'provider_timestamp' | 'custom_prefix' | 'name_counter';

// Name pattern types  
export type NamePattern = 'random' | 'from_email' | 'custom';

// Pattern configuration
export interface PatternConfig {
  emailPattern: EmailPattern;
  emailCustomPrefix: string;
  namePattern: NamePattern;
  nameCustomFirst: string;
  nameCustomLast: string;
}

// Registration configuration (simplified)
export interface RegistrationConfig {
  provider: ProviderName;
  credentials: AutoRegCredentials;
  imap: IMAPConfig;
  proxy: ProxyConfig;
  patterns: PatternConfig;
  count: number;
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

// Registration history entry
export interface RegistrationHistoryEntry {
  id: string;
  provider: ProviderName;
  email: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
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
  
  // History
  history: RegistrationHistoryEntry[];
  
  // WebSocket
  wsConnected: boolean;
  
  // Settings state
  settingsLoaded: boolean;
  saveStatus: SaveStatus;
  imapPasswordSet: boolean;
  
  // Actions - Config (all trigger auto-save)
  setProvider: (provider: ProviderName) => void;
  setIMAPConfig: (imap: Partial<IMAPConfig>) => void;
  setProxyConfig: (proxy: Partial<ProxyConfig>) => void;
  setCount: (count: number) => void;
  
  // Actions - Settings persistence
  loadSettings: () => Promise<void>;
  saveSettings: () => Promise<void>;
  
  // Actions - Logs
  addLog: (log: Omit<RegistrationLog, 'id' | 'timestamp'>) => void;
  clearLogs: () => void;
  
  // Actions - Progress
  setProgress: (progress: Partial<RegistrationProgress>) => void;
  
  // Actions - Results
  addResult: (result: Omit<RegistrationResult, 'id' | 'createdAt'>) => void;
  
  // Actions - History
  addHistoryEntry: (entry: Omit<RegistrationHistoryEntry, 'id' | 'createdAt'>) => void;
  
  // Actions - WebSocket
  setWsConnected: (connected: boolean) => void;
}

const DEFAULT_CONFIG: RegistrationConfig = {
  provider: 'kiro',
  credentials: {
    email: '',
    password: '',
  },
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
  patterns: {
    emailPattern: 'provider_timestamp',
    emailCustomPrefix: '',
    namePattern: 'random',
    nameCustomFirst: '',
    nameCustomLast: '',
  },
  count: 1,
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
    history: [],
    wsConnected: false,
    settingsLoaded: false,
    saveStatus: 'idle',
    imapPasswordSet: false,

    // Config actions - all trigger auto-save
    setProvider: (provider: ProviderName) => {
      set((state) => ({ config: { ...state.config, provider } }));
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

    // Settings persistence
    loadSettings: async () => {
      try {
        const settings = await getSettings();
        set((state) => {
          // Check if passwords are masked (meaning they exist in DB)
          const imapPasswordMasked = settings.imap_password === '********';
          const proxyPasswordMasked = settings.proxy_password === '********';
          
          return {
            config: {
              ...state.config,
              provider: (settings.provider as ProviderName) || 'kiro',
              imap: {
                ...state.config.imap,
                server: settings.imap_server || '',
                port: settings.imap_port || 993,
                email: settings.imap_email || '',
                // Don't overwrite password with masked value - keep existing or empty
                password: imapPasswordMasked ? state.config.imap.password : (settings.imap_password || ''),
              },
              proxy: {
                ...state.config.proxy,
                enabled: settings.proxy_enabled || false,
                url: settings.proxy_url || '',
                username: settings.proxy_username || '',
                // Don't overwrite password with masked value - keep existing or empty
                password: proxyPasswordMasked ? state.config.proxy.password : (settings.proxy_password || ''),
              },
              patterns: {
                ...state.config.patterns,
                emailPattern: (settings.email_pattern as EmailPattern) || 'provider_timestamp',
                emailCustomPrefix: settings.email_custom_prefix || '',
                namePattern: (settings.name_pattern as NamePattern) || 'random',
                nameCustomFirst: settings.name_custom_first || '',
                nameCustomLast: settings.name_custom_last || '',
              },
              count: settings.count || 1,
            },
            settingsLoaded: true,
            // Track that password exists in DB even if we don't have the actual value
            imapPasswordSet: imapPasswordMasked || !!settings.imap_password,
          };
        });
      } catch (error) {
        console.error('Failed to load settings:', error);
        set({ settingsLoaded: true });
      }
    },

    saveSettings: async () => {
      const { config } = get();

      // Basic validation
      if (config.imap.email && !config.imap.email.includes('@')) {
        console.warn('Invalid email format, skipping save');
        set({ saveStatus: 'error' });
        setTimeout(() => set({ saveStatus: 'idle' }), 3000);
        return;
      }
      if (isNaN(config.imap.port) || config.imap.port < 1 || config.imap.port > 65535) {
        console.warn('Invalid IMAP port, skipping save');
        set({ saveStatus: 'error' });
        setTimeout(() => set({ saveStatus: 'idle' }), 3000);
        return;
      }

      try {
        const updateData: Record<string, unknown> = {
          provider: config.provider,
          imap_server: config.imap.server,
          imap_port: config.imap.port,
          imap_email: config.imap.email,
          proxy_enabled: config.proxy.enabled,
          proxy_url: config.proxy.url,
          proxy_username: config.proxy.username,
          email_pattern: config.patterns.emailPattern,
          email_custom_prefix: config.patterns.emailCustomPrefix,
          name_pattern: config.patterns.namePattern,
          name_custom_first: config.patterns.nameCustomFirst,
          name_custom_last: config.patterns.nameCustomLast,
          count: config.count,
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
        setTimeout(() => set({ saveStatus: 'idle' }), 2000);
      } catch (error) {
        console.error('Failed to save settings:', error);
        set({ saveStatus: 'error' });
        setTimeout(() => set({ saveStatus: 'idle' }), 3000);
      }
    },

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

    // History actions
    addHistoryEntry: (entry: Omit<RegistrationHistoryEntry, 'id' | 'createdAt'>) => set((state) => ({
      history: [
        {
          ...entry,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        },
        ...state.history,
      ].slice(0, 50), // Keep only last 50 entries
    })),

    // WebSocket actions
    setWsConnected: (connected: boolean) => set({ wsConnected: connected }),
  };
});
