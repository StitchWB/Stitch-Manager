import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { getSettings, updateSettings } from '../lib/tauri';
import type {
  ProviderName,
  RegistrationLog,
  RegistrationProgress,
  RegistrationStatus,
} from '../types';
import type { SettingsData } from '../types/generated';

// Mail strategy type
export type MailStrategy = 'custom' | 'gmail';

// Email strategy type
export type EmailStrategy = 'static' | 'counter' | 'addyio' | 'addyio_counter';

// IMAP configuration (kept for future email verification)
export interface IMAPConfig {
  strategy: MailStrategy;
  // Email generation strategy
  emailStrategy?: EmailStrategy;
  // Custom domain fields
  server: string;
  port: number;
  email: string;
  password: string;
  useTLS: boolean;
  // Gmail alias fields
  gmailBase: string;
  gmailAlias: string;
  gmailAppPassword: string;
  // Addy.io fields
  addyioEnabled?: boolean;
  addyioApiToken?: string;
  addyioDomain?: string;
  addyioAliasFormat?: string;
  addyioAutoDelete?: boolean;
  addyioDefaultRecipientId?: string;
  addyioDescriptionTemplate?: string;
  addyioFromName?: string;
  // 33mail fields
  thirtyThreeMailEnabled?: boolean;
  thirtyThreeMailUsername?: string;
  thirtyThreeMailDomain?: string;
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
export type EmailPattern =
  | 'random'
  | 'name_random'
  | 'provider_timestamp'
  | 'custom_prefix'
  | 'name_counter';

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

// Advanced settings configuration
export interface AdvancedSettings {
  // Main settings (always visible)
  headless: boolean;
  speedMultiplier: number; // 0.5 to 2.0
  delayBetweenAccounts: number; // 1-10 seconds

  // Advanced settings (collapsible)
  verificationCodeTimeout: number; // 60-180s
  oauthCallbackTimeout: number; // 30-180s
  allowAccessWait: number; // 60-300s
  pageLoadTimeout: number; // 2-15s
  elementWaitTimeout: number; // 1-10s
  imapPollInterval: number; // 0.5-5s
  passwordLength: number; // 12-24
  realisticTyping: boolean;
  humanDelays: boolean;
  screenshotsOnError: boolean;
}

// Registration configuration (simplified)
export interface RegistrationConfig {
  provider: ProviderName;
  credentials: AutoRegCredentials;
  imap: IMAPConfig;
  proxy: ProxyConfig;
  patterns: PatternConfig;
  advanced: AdvancedSettings;
  count: number;
  timeout: number;
  retryAttempts: number;
  uiScale: number;
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
  activeProvider: string;

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
  gmailAppPasswordSet: boolean;

  // Actions - Config (all trigger auto-save)
  setProvider: (provider: ProviderName) => void;
  setIMAPConfig: (imap: Partial<IMAPConfig>) => void;
  setProxyConfig: (proxy: Partial<ProxyConfig>) => void;
  setAdvancedSettings: (settings: Partial<AdvancedSettings>) => void;
  setCount: (count: number) => void;
  setUIScale: (scale: number) => void;

  // Actions - Settings persistence

  loadSettings: () => Promise<void>;
  saveSettings: () => Promise<void>;
  saveImmediately: () => Promise<void>;

  // Actions - Logs
  addLog: (log: Omit<RegistrationLog, 'id' | 'timestamp'>) => void;
  clearLogs: () => void;
  setActiveProvider: (provider: string) => void;

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
    strategy: 'custom',
    server: '',
    port: 993,
    email: '',
    password: '',
    useTLS: true,
    gmailBase: '',
    gmailAlias: '',
    gmailAppPassword: '',
    // Addy.io defaults
    addyioEnabled: false,
    addyioApiToken: '',
    addyioDomain: '',
    addyioAliasFormat: 'uuid',
    addyioAutoDelete: false,
    addyioDefaultRecipientId: '',
    addyioDescriptionTemplate: '',
    addyioFromName: '',
    // 33mail defaults
    thirtyThreeMailEnabled: false,
    thirtyThreeMailUsername: '',
    thirtyThreeMailDomain: '33mail.com',
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
  advanced: {
    // Main settings
    headless: false,
    speedMultiplier: 1.0,
    delayBetweenAccounts: 2,
    // Advanced settings
    verificationCodeTimeout: 120,
    oauthCallbackTimeout: 90,
    allowAccessWait: 120,
    pageLoadTimeout: 5,
    elementWaitTimeout: 2,
    imapPollInterval: 1,
    passwordLength: 16,
    realisticTyping: true,
    humanDelays: true,
    screenshotsOnError: true,
  },
  count: 1,
  timeout: 60000,
  retryAttempts: 3,
  uiScale: 1.0,
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
    console.log('[REGISTRATION_STORE] triggerSave called, settingsLoaded:', store.settingsLoaded);
    if (!store.settingsLoaded) {
      console.log('[REGISTRATION_STORE] triggerSave: settings not loaded yet, skipping');
      return;
    }

    if (saveTimeout) {
      console.log('[REGISTRATION_STORE] triggerSave: clearing existing timeout');
      clearTimeout(saveTimeout);
    }

    console.log('[REGISTRATION_STORE] triggerSave: setting status to saving');
    set({ saveStatus: 'saving' });

    console.log('[REGISTRATION_STORE] triggerSave: setting timeout for 500ms');
    saveTimeout = setTimeout(async () => {
      console.log('[REGISTRATION_STORE] triggerSave: timeout fired, calling saveSettings');
      await store.saveSettings();
    }, 500); // Reduced from 800ms to 500ms for faster saving
  };

  return {
    // Initial state
    config: DEFAULT_CONFIG,
    isRunning: false,
    status: 'pending', // Changed from 'idle' to 'pending' to match new RegistrationStatus type
    progress: DEFAULT_PROGRESS,
    logs: [],
    activeProvider: 'all',
    results: [],
    successCount: 0,
    failedCount: 0,
    history: [],
    wsConnected: false,
    settingsLoaded: false,
    saveStatus: 'idle',
    imapPasswordSet: false,
    gmailAppPasswordSet: false,

    // Config actions - all trigger auto-save
    setProvider: (provider: ProviderName) => {
      console.log('[REGISTRATION_STORE] setProvider called:', provider);
      set(state => ({ config: { ...state.config, provider } }));
      console.log('[REGISTRATION_STORE] setProvider: triggering save');
      triggerSave();
    },

    setIMAPConfig: (imap: Partial<IMAPConfig>) => {
      console.log('[REGISTRATION_STORE] setIMAPConfig called with:', imap);
      set(state => {
        const newImap = { ...state.config.imap, ...imap };
        console.log('[REGISTRATION_STORE] New IMAP config state:', newImap);

        const updates: Partial<RegistrationConfig> = {
          imap: newImap,
        };

        // If emailPattern is being updated, also update patterns
        if ('emailPattern' in imap) {
          const imapWithPattern = imap as Partial<IMAPConfig> & { emailPattern: EmailPattern };
          updates.patterns = {
            ...state.config.patterns,
            emailPattern: imapWithPattern.emailPattern,
          };
          // Remove emailPattern from imap updates
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { emailPattern, ...imapWithoutPattern } = imapWithPattern;
          updates.imap = { ...state.config.imap, ...imapWithoutPattern };
        }

        console.log('[REGISTRATION_STORE] setIMAPConfig: new config updates:', updates);
        return { config: { ...state.config, ...updates } };
      });
      console.log('[REGISTRATION_STORE] setIMAPConfig: triggering save');
      triggerSave();
    },

    setProxyConfig: (proxy: Partial<ProxyConfig>) => {
      console.log('[REGISTRATION_STORE] setProxyConfig called:', proxy);
      set(state => ({
        config: {
          ...state.config,
          proxy: { ...state.config.proxy, ...proxy },
        },
      }));
      console.log('[REGISTRATION_STORE] setProxyConfig: triggering save');
      triggerSave();
    },

    setAdvancedSettings: (settings: Partial<AdvancedSettings>) => {
      console.log('[REGISTRATION_STORE] setAdvancedSettings called:', settings);
      set(state => ({
        config: {
          ...state.config,
          advanced: { ...state.config.advanced, ...settings },
        },
      }));
      console.log('[REGISTRATION_STORE] setAdvancedSettings: triggering save');
      triggerSave();
    },

    setCount: (count: number) => {
      console.log('[REGISTRATION_STORE] setCount called:', count);
      set(state => ({
        config: { ...state.config, count: Math.max(1, Math.min(100, count)) },
      }));
      console.log('[REGISTRATION_STORE] setCount: triggering save');
      triggerSave();
    },

    setUIScale: (uiScale: number) => {
      console.log('[REGISTRATION_STORE] setUIScale called:', uiScale);
      set(state => ({
        config: { ...state.config, uiScale: Math.max(0.5, Math.min(1.5, uiScale)) },
      }));
      triggerSave();
    },

    // Actions - Settings persistence

    loadSettings: async () => {
      console.log('[REGISTRATION_STORE] loadSettings: starting');
      try {
        const settings: SettingsData = await getSettings();
        console.log('[REGISTRATION_STORE] loadSettings: got settings from DB:', settings);

        set(state => {
          // Check if passwords are masked (meaning they exist in DB)
          const imapPasswordMasked = settings.imapPassword === '********';
          const gmailAppPasswordMasked = settings.gmailAppPassword === '********';
          const proxyPasswordMasked = settings.proxyPassword === '********';

          const newConfig = {
            config: {
              ...state.config,
              provider: (settings.provider as ProviderName) || 'kiro',
              imap: {
                ...state.config.imap,
                strategy: (settings.mailStrategy as MailStrategy) || 'custom',
                server: settings.imapServer || '',
                port: settings.imapPort || 993,
                email: settings.imapEmail || '',
                // Don't overwrite password with masked value - keep existing or empty
                password: imapPasswordMasked
                  ? state.config.imap.password
                  : settings.imapPassword || '',
                gmailBase: settings.gmailBase || '',
                gmailAlias: settings.gmailAlias || '',
                gmailAppPassword: gmailAppPasswordMasked
                  ? state.config.imap.gmailAppPassword
                  : settings.gmailAppPassword || '',
                // Load addy.io settings
                addyioEnabled: settings.addyioEnabled || false,
                addyioApiToken: settings.addyioApiToken || '',
                addyioDomain: settings.addyioDomain || '',
                addyioAliasFormat: settings.addyioAliasFormat || 'uuid',
                addyioAutoDelete: settings.addyioAutoDelete || false,
                addyioDefaultRecipientId: settings.addyioDefaultRecipientId || '',
                addyioDescriptionTemplate: settings.addyioDescriptionTemplate || '',
                addyioFromName: settings.addyioFromName || '',
                // Load 33mail settings
                thirtyThreeMailEnabled: settings.thirtyThreeMailEnabled || false,
                thirtyThreeMailUsername: settings.thirtyThreeMailUsername || '',
                thirtyThreeMailDomain: settings.thirtyThreeMailDomain || '33mail.com',
              },
              proxy: {
                ...state.config.proxy,
                enabled: settings.proxyEnabled || false,
                url: settings.proxyUrl || '',
                username: settings.proxyUsername || '',
                // Don't overwrite password with masked value - keep existing or empty
                password: proxyPasswordMasked
                  ? state.config.proxy.password
                  : settings.proxyPassword || '',
              },
              patterns: {
                ...state.config.patterns,
                emailPattern: (settings.emailPattern as EmailPattern) || 'provider_timestamp',
                emailCustomPrefix: settings.emailCustomPrefix || '',
                namePattern: (settings.namePattern as NamePattern) || 'random',
                nameCustomFirst: settings.nameCustomFirst || '',
                nameCustomLast: settings.nameCustomLast || '',
              },
              advanced: {
                ...state.config.advanced,
                // CRITICAL FIX: Load headless setting from database
                headless: settings.headless === true,
              },
              count: settings.count || 1,
              uiScale: settings.uiScale || 1.0,
            },
            settingsLoaded: true,

            // Track that password exists in DB even if we don't have the actual value
            imapPasswordSet: imapPasswordMasked || !!settings.imapPassword,
            gmailAppPasswordSet: gmailAppPasswordMasked || !!settings.gmailAppPassword,
          };

          console.log('[REGISTRATION_STORE] loadSettings: setting new config:', newConfig.config);
          return newConfig;
        });
        console.log('[REGISTRATION_STORE] loadSettings: completed successfully');
      } catch (error) {
        console.error('[REGISTRATION_STORE] loadSettings: failed:', error);
        set({ settingsLoaded: true });
      }
    },

    saveSettings: async () => {
      const { config } = get();
      console.log('[REGISTRATION_STORE] saveSettings: starting with config:', config);
      console.log('[REGISTRATION_STORE] saveSettings: addy.io config:', {
        addyioEnabled: config.imap.addyioEnabled,
        addyioApiToken: config.imap.addyioApiToken ? '***' : 'empty',
        addyioDomain: config.imap.addyioDomain,
        addyioAliasFormat: config.imap.addyioAliasFormat,
        addyioAutoDelete: config.imap.addyioAutoDelete,
        addyioDefaultRecipientId: config.imap.addyioDefaultRecipientId,
        addyioDescriptionTemplate: config.imap.addyioDescriptionTemplate,
        addyioFromName: config.imap.addyioFromName,
      });

      // Basic validation
      if (config.imap.email && !config.imap.email.includes('@')) {
        console.warn('[REGISTRATION_STORE] saveSettings: invalid email format, skipping save');
        set({ saveStatus: 'error' });
        setTimeout(() => set({ saveStatus: 'idle' }), 3000);
        return;
      }
      if (isNaN(config.imap.port) || config.imap.port < 1 || config.imap.port > 65535) {
        console.warn('[REGISTRATION_STORE] saveSettings: invalid IMAP port, skipping save');
        set({ saveStatus: 'error' });
        setTimeout(() => set({ saveStatus: 'idle' }), 3000);
        return;
      }

      try {
        const updateData: Record<string, unknown> = {
          provider: config.provider,
          mailStrategy: config.imap.strategy,
          imapServer: config.imap.server,
          imapPort: config.imap.port,
          imapEmail: config.imap.email,
          imapUser: config.imap.email, // Copy email to user field for Python IMAP login
          gmailBase: config.imap.gmailBase,
          gmailAlias: config.imap.gmailAlias,
          proxyEnabled: config.proxy.enabled,
          proxyUrl: config.proxy.url,
          proxyUsername: config.proxy.username,
          emailPattern: config.patterns.emailPattern,
          emailCustomPrefix: config.patterns.emailCustomPrefix,
          namePattern: config.patterns.namePattern,
          nameCustomFirst: config.patterns.nameCustomFirst,
          nameCustomLast: config.patterns.nameCustomLast,
          count: config.count,
          headless: config.advanced.headless,
          uiScale: config.uiScale,
          // Save addy.io settings

          addyioEnabled: config.imap.addyioEnabled || false,
          addyioApiToken: config.imap.addyioApiToken || '',
          addyioDomain: config.imap.addyioDomain || '',
          addyioAliasFormat: config.imap.addyioAliasFormat || 'uuid',
          addyioAutoDelete: config.imap.addyioAutoDelete || false,
          addyioDefaultRecipientId: config.imap.addyioDefaultRecipientId || '',
          addyioDescriptionTemplate: config.imap.addyioDescriptionTemplate || '',
          addyioFromName: config.imap.addyioFromName || '',
          // Save 33mail settings
          thirtyThreeMailEnabled: config.imap.thirtyThreeMailEnabled || false,
          thirtyThreeMailUsername: config.imap.thirtyThreeMailUsername || '',
          thirtyThreeMailDomain: config.imap.thirtyThreeMailDomain || '33mail.com',
        };

        // Only include passwords if they have actual values
        if (config.imap.password) {
          updateData.imapPassword = config.imap.password;
        }
        if (config.imap.gmailAppPassword) {
          updateData.gmailAppPassword = config.imap.gmailAppPassword;
        }
        if (config.proxy.password) {
          updateData.proxyPassword = config.proxy.password;
        }

        console.log(
          '[REGISTRATION_STORE] saveSettings: calling updateSettings with data:',
          updateData
        );
        await updateSettings(updateData);
        console.log('[REGISTRATION_STORE] saveSettings: updateSettings completed successfully');

        set({ saveStatus: 'saved' });
        setTimeout(() => set({ saveStatus: 'idle' }), 2000);
        console.log('[REGISTRATION_STORE] saveSettings: status set to saved');
      } catch (error) {
        console.error('[REGISTRATION_STORE] saveSettings: failed:', error);
        set({ saveStatus: 'error' });
        setTimeout(() => set({ saveStatus: 'idle' }), 3000);
      }
    },

    // Immediate save function for critical moments (page unload, tab switch)
    saveImmediately: async () => {
      const state = get();
      console.log(
        '[REGISTRATION_STORE] saveImmediately: called, settingsLoaded:',
        state.settingsLoaded
      );
      if (!state.settingsLoaded) {
        console.log('[REGISTRATION_STORE] saveImmediately: settings not loaded, skipping');
        return;
      }

      // Clear any pending debounced save
      if (saveTimeout) {
        console.log('[REGISTRATION_STORE] saveImmediately: clearing pending timeout');
        clearTimeout(saveTimeout);
        saveTimeout = null;
      }

      // Save immediately without debounce
      console.log('[REGISTRATION_STORE] saveImmediately: calling saveSettings directly');
      await state.saveSettings();
    },

    // Log actions
    addLog: (log: Omit<RegistrationLog, 'id' | 'timestamp'>) => {
      const state = get();
      const lastLog = state.logs[state.logs.length - 1];

      // Deduplicate identical messages sent consecutively
      if (lastLog && lastLog.message === log.message) {
        return;
      }

      const newLog = {
        ...log,
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      };

      // Add to local registration logs
      set(state => ({
        logs: [...state.logs, newLog],
      }));

      // Also save to global logging system for persistence
      invoke('add_log', {
        level: log.level,
        source: 'registration',
        message: log.message,
        details: null,
      }).catch((err: unknown) => {
        console.error('Failed to save log to database:', err);
      });
    },

    clearLogs: () => set({ logs: [] }),

    setActiveProvider: (provider: string) => set({ activeProvider: provider }),

    // Progress actions
    setProgress: (progress: Partial<RegistrationProgress>) =>
      set(state => ({
        progress: { ...state.progress, ...progress },
      })),

    // Result actions
    addResult: (result: Omit<RegistrationResult, 'id' | 'createdAt'>) =>
      set(state => {
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
    addHistoryEntry: (entry: Omit<RegistrationHistoryEntry, 'id' | 'createdAt'>) =>
      set(state => ({
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
