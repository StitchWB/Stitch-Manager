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
import type { LogVerbosity } from '../constants/logging';

// Mail strategy type
export type MailStrategy = 'custom' | 'gmail';

// Email strategy type
export type EmailStrategy = 'static' | 'counter' | 'addyio' | 'addyio_counter';

// IMAP configuration (kept for future email verification)
export interface IMAPConfig {
  strategy: MailStrategy;
  // Email generation strategy
  emailStrategy?: EmailStrategy;
  // Custom domain fields (GLOBAL - shared across providers)
  server: string;
  port: number;
  email: string;
  password: string;
  useTLS: boolean;
  // Gmail alias fields (GLOBAL - shared across providers)
  gmailBase: string;
  gmailAlias: string;
  gmailAppPassword: string;
  // Addy.io fields (GLOBAL - shared across providers)
  addyioEnabled?: boolean;
  addyioApiToken?: string;
  addyioDomain?: string;
  addyioAliasFormat?: string;
  addyioAutoDelete?: boolean;
  addyioDefaultRecipientId?: string;
  addyioDescriptionTemplate?: string;
  addyioFromName?: string;
  // 33mail fields (GLOBAL - shared across providers)
  thirtyThreeMailEnabled?: boolean;
  thirtyThreeMailUsername?: string;
  thirtyThreeMailDomain?: string;
}

// Provider-specific email strategy settings (NOT including IMAP credentials)
export interface ProviderEmailStrategy {
  strategy: MailStrategy; // custom/gmail/33mail/addyio
  // For custom domain - which domain to use
  customDomain?: string;
  // For 33mail - which domain to use
  thirtyThreeMailDomain?: string;
  // For addyio - which domain to use
  addyioDomain?: string;
}

// Provider-specific configurations (email strategy only, IMAP is global)
export interface ProviderEmailStrategies {
  kiro: ProviderEmailStrategy;
  windsurf: ProviderEmailStrategy;
  trae: ProviderEmailStrategy;
  github: ProviderEmailStrategy;
  aws: ProviderEmailStrategy;
  copilot: ProviderEmailStrategy;
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
  imap: IMAPConfig; // Global IMAP config (shared across all providers)
  providerEmailStrategies: ProviderEmailStrategies; // Provider-specific email strategies
  proxy: ProxyConfig;
  patterns: PatternConfig;
  advanced: AdvancedSettings;
  count: number;
  timeout: number;
  retryAttempts: number;
  uiScale: number;
}

// Stage progress data
export interface StageProgressData {
  stage: string;
  icon?: string;
  status: 'pending' | 'active' | 'success' | 'error';
  progress?: { current: number; total: number };
  startTime: number;
  message?: string;
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
  logVerbosity: LogVerbosity;

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

  // Stage progress tracking
  currentStage: string | null;
  stageProgress: Map<string, StageProgressData>;
  stageTimers: Map<string, number>; // start timestamps

  // Actions - Config (all trigger auto-save)
  setProvider: (provider: ProviderName) => void;
  setIMAPConfig: (imap: Partial<IMAPConfig>) => void;
  setProxyConfig: (proxy: Partial<ProxyConfig>) => void;
  setAdvancedSettings: (settings: Partial<AdvancedSettings>) => void;
  setCount: (count: number) => void;
  setUIScale: (scale: number) => void;
  setLogVerbosity: (level: LogVerbosity) => void;

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

  // Actions - Stage progress
  setCurrentStage: (stage: string | null) => void;
  updateStageProgress: (stage: string, current: number, total: number, message?: string) => void;
  completeStage: (stage: string, status: 'success' | 'error') => void;
  clearStageProgress: () => void;

  // Actions - Results
  addResult: (result: Omit<RegistrationResult, 'id' | 'createdAt'>) => void;

  // Actions - History
  addHistoryEntry: (entry: Omit<RegistrationHistoryEntry, 'id' | 'createdAt'>) => void;

  // Actions - WebSocket
  setWsConnected: (connected: boolean) => void;
}

const DEFAULT_IMAP_CONFIG: IMAPConfig = {
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
};

const DEFAULT_EMAIL_STRATEGY: ProviderEmailStrategy = {
  strategy: 'custom',
  customDomain: '',
  thirtyThreeMailDomain: '33mail.com',
  addyioDomain: '',
};

const DEFAULT_CONFIG: RegistrationConfig = {
  provider: 'kiro',
  credentials: {
    email: '',
    password: '',
  },
  imap: { ...DEFAULT_IMAP_CONFIG },
  providerEmailStrategies: {
    kiro: { ...DEFAULT_EMAIL_STRATEGY },
    windsurf: { ...DEFAULT_EMAIL_STRATEGY },
    trae: { ...DEFAULT_EMAIL_STRATEGY },
    github: { ...DEFAULT_EMAIL_STRATEGY },
    aws: { ...DEFAULT_EMAIL_STRATEGY },
    copilot: { ...DEFAULT_EMAIL_STRATEGY },
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
    logVerbosity: 'normal',
    results: [],
    successCount: 0,
    failedCount: 0,
    history: [],
    wsConnected: false,
    settingsLoaded: false,
    saveStatus: 'idle',
    imapPasswordSet: false,
    gmailAppPasswordSet: false,

    // Stage progress tracking
    currentStage: null,
    stageProgress: new Map(),
    stageTimers: new Map(),

    // Config actions - all trigger auto-save
    setProvider: (provider: ProviderName) => {
      console.log('[REGISTRATION_STORE] setProvider called:', provider);
      set(state => {
        // Save current email strategy to current provider's slot
        const currentStrategy: ProviderEmailStrategy = {
          strategy: state.config.imap.strategy,
          customDomain: state.config.imap.server
            ? `${state.config.imap.email.split('@')[1] || ''}`
            : '',
          thirtyThreeMailDomain: state.config.imap.thirtyThreeMailDomain,
          addyioDomain: state.config.imap.addyioDomain,
        };

        const updatedStrategies = {
          ...state.config.providerEmailStrategies,
          [state.config.provider]: currentStrategy,
        };

        // Load email strategy for new provider
        const newStrategy = updatedStrategies[provider] || { ...DEFAULT_EMAIL_STRATEGY };

        // Update IMAP config with new provider's strategy (but keep IMAP credentials)
        const newImap: IMAPConfig = {
          ...state.config.imap, // Keep all IMAP credentials
          strategy: newStrategy.strategy, // Update strategy
          // Update domain-specific fields based on strategy
          thirtyThreeMailDomain: newStrategy.thirtyThreeMailDomain,
          addyioDomain: newStrategy.addyioDomain,
        };

        return {
          config: {
            ...state.config,
            provider,
            imap: newImap,
            providerEmailStrategies: updatedStrategies,
          },
        };
      });
      console.log('[REGISTRATION_STORE] setProvider: triggering save');
      triggerSave();
    },
    setIMAPConfig: (imap: Partial<IMAPConfig>) => {
      console.log('[REGISTRATION_STORE] setIMAPConfig called with:', imap);
      set(state => {
        const newImap = { ...state.config.imap, ...imap };
        console.log('[REGISTRATION_STORE] New IMAP config state:', newImap);

        // If strategy changed, update provider-specific strategy
        let updatedStrategies = state.config.providerEmailStrategies;
        if ('strategy' in imap || 'addyioDomain' in imap || 'thirtyThreeMailDomain' in imap) {
          const currentStrategy: ProviderEmailStrategy = {
            strategy: newImap.strategy,
            customDomain: newImap.server ? `${newImap.email.split('@')[1] || ''}` : '',
            thirtyThreeMailDomain: newImap.thirtyThreeMailDomain,
            addyioDomain: newImap.addyioDomain,
          };
          updatedStrategies = {
            ...updatedStrategies,
            [state.config.provider]: currentStrategy,
          };
        }

        const updates: Partial<RegistrationConfig> = {
          imap: newImap,
          providerEmailStrategies: updatedStrategies,
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

    setLogVerbosity: (level: LogVerbosity) => {
      console.log('[REGISTRATION_STORE] setLogVerbosity called:', level);
      set({ logVerbosity: level });
      triggerSave();
    },

    // Actions - Settings persistence

    loadSettings: async () => {
      console.log('[REGISTRATION_STORE] loadSettings: starting');
      try {
        const settings: SettingsData = await getSettings();
        console.log('[REGISTRATION_STORE] loadSettings: got settings from DB:', settings);

        // Try to load provider-specific email strategies from localStorage
        let providerEmailStrategies: ProviderEmailStrategies | null = null;
        try {
          const stored = localStorage.getItem('providerEmailStrategies');
          if (stored) {
            providerEmailStrategies = JSON.parse(stored);
            console.log(
              '[REGISTRATION_STORE] loadSettings: loaded provider strategies from localStorage'
            );
          } else {
            // Migration: Check for old providerImapConfigs format
            const oldStored = localStorage.getItem('providerImapConfigs');
            if (oldStored) {
              console.log(
                '[REGISTRATION_STORE] loadSettings: found old providerImapConfigs, migrating...'
              );
              try {
                const oldConfigs = JSON.parse(oldStored);
                // Convert old format to new format (extract only strategy and domain info)
                providerEmailStrategies = {} as ProviderEmailStrategies;
                for (const [provider, oldConfig] of Object.entries(oldConfigs)) {
                  const old = oldConfig as IMAPConfig;
                  providerEmailStrategies[provider as ProviderName] = {
                    strategy: old.strategy || 'custom',
                    customDomain: old.server ? `${old.email?.split('@')[1] || ''}` : '',
                    thirtyThreeMailDomain: old.thirtyThreeMailDomain || '33mail.com',
                    addyioDomain: old.addyioDomain || '',
                  };
                }
                // Save migrated data in new format
                localStorage.setItem(
                  'providerEmailStrategies',
                  JSON.stringify(providerEmailStrategies)
                );
                // Remove old format
                localStorage.removeItem('providerImapConfigs');
                console.log(
                  '[REGISTRATION_STORE] loadSettings: migration completed, old data removed'
                );
              } catch (migrationError) {
                console.error(
                  '[REGISTRATION_STORE] loadSettings: migration failed:',
                  migrationError
                );
              }
            }
          }
        } catch (e) {
          console.warn(
            '[REGISTRATION_STORE] loadSettings: failed to load provider strategies from localStorage:',
            e
          );
        }

        set(state => {
          // Check if passwords are masked (meaning they exist in DB)
          const imapPasswordMasked = settings.imapPassword === '********';
          const gmailAppPasswordMasked = settings.gmailAppPassword === '********';
          const proxyPasswordMasked = settings.proxyPassword === '********';

          // Build global IMAP config (shared across all providers)
          const globalImap: IMAPConfig = {
            ...state.config.imap,
            strategy: (settings.mailStrategy as MailStrategy) || 'custom',
            server: settings.imapServer || '',
            port: settings.imapPort || 993,
            email: settings.imapEmail || '',
            password: imapPasswordMasked ? state.config.imap.password : settings.imapPassword || '',
            gmailBase: settings.gmailBase || '',
            gmailAlias: settings.gmailAlias || '',
            gmailAppPassword: gmailAppPasswordMasked
              ? state.config.imap.gmailAppPassword
              : settings.gmailAppPassword || '',
            // Load addy.io settings (global)
            addyioEnabled: settings.addyioEnabled || false,
            addyioApiToken: settings.addyioApiToken || '',
            addyioDomain: settings.addyioDomain || '',
            addyioAliasFormat: settings.addyioAliasFormat || 'uuid',
            addyioAutoDelete: settings.addyioAutoDelete || false,
            addyioDefaultRecipientId: settings.addyioDefaultRecipientId || '',
            addyioDescriptionTemplate: settings.addyioDescriptionTemplate || '',
            addyioFromName: settings.addyioFromName || '',
            // Load 33mail settings (global)
            thirtyThreeMailEnabled: settings.thirtyThreeMailEnabled || false,
            thirtyThreeMailUsername: settings.thirtyThreeMailUsername || '',
            thirtyThreeMailDomain: settings.thirtyThreeMailDomain || '33mail.com',
          };

          const currentProvider = (settings.provider as ProviderName) || 'kiro';

          // Initialize provider strategies with defaults, then override with stored values
          const finalProviderStrategies: ProviderEmailStrategies = providerEmailStrategies || {
            kiro: { ...DEFAULT_EMAIL_STRATEGY },
            windsurf: { ...DEFAULT_EMAIL_STRATEGY },
            trae: { ...DEFAULT_EMAIL_STRATEGY },
            github: { ...DEFAULT_EMAIL_STRATEGY },
            aws: { ...DEFAULT_EMAIL_STRATEGY },
            copilot: { ...DEFAULT_EMAIL_STRATEGY },
          };

          // Set current provider's strategy from DB
          finalProviderStrategies[currentProvider] = {
            strategy: globalImap.strategy,
            customDomain: globalImap.server ? `${globalImap.email.split('@')[1] || ''}` : '',
            thirtyThreeMailDomain: globalImap.thirtyThreeMailDomain,
            addyioDomain: globalImap.addyioDomain,
          };

          const newConfig = {
            config: {
              ...state.config,
              provider: currentProvider,
              imap: globalImap,
              providerEmailStrategies: finalProviderStrategies,
              proxy: {
                ...state.config.proxy,
                enabled: settings.proxyEnabled || false,
                url: settings.proxyUrl || '',
                username: settings.proxyUsername || '',
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
                headless: settings.headless === true,
              },
              count: settings.count || 1,
              uiScale: settings.uiScale || 1.0,
            },
            logVerbosity: (settings.logVerbosity as LogVerbosity) || 'normal',
            settingsLoaded: true,
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
      const { config, logVerbosity } = get();
      console.log('[REGISTRATION_STORE] saveSettings: starting with config:', config);

      // Save provider-specific email strategies to localStorage
      try {
        localStorage.setItem(
          'providerEmailStrategies',
          JSON.stringify(config.providerEmailStrategies)
        );
        console.log('[REGISTRATION_STORE] saveSettings: saved provider strategies to localStorage');
      } catch (e) {
        console.warn(
          '[REGISTRATION_STORE] saveSettings: failed to save provider strategies to localStorage:',
          e
        );
      }

      // Basic validation
      if (
        config.imap.strategy === 'custom' &&
        config.imap.email &&
        !config.imap.email.includes('@')
      ) {
        console.warn('[REGISTRATION_STORE] saveSettings: invalid email format, skipping save');
        set({ saveStatus: 'error' });
        setTimeout(() => set({ saveStatus: 'idle' }), 3000);
        return;
      }
      if (
        config.imap.strategy === 'custom' &&
        (isNaN(config.imap.port) || config.imap.port < 1 || config.imap.port > 65535)
      ) {
        console.warn('[REGISTRATION_STORE] saveSettings: invalid IMAP port, skipping save');
        set({ saveStatus: 'error' });
        setTimeout(() => set({ saveStatus: 'idle' }), 3000);
        return;
      }

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
          imapUser: config.imap.email,
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
          logVerbosity: logVerbosity,
          // Save addy.io settings (global)
          addyioEnabled: config.imap.addyioEnabled || false,
          addyioApiToken: config.imap.addyioApiToken || '',
          addyioDomain: config.imap.addyioDomain || '',
          addyioAliasFormat: config.imap.addyioAliasFormat || 'uuid',
          addyioAutoDelete: config.imap.addyioAutoDelete || false,
          addyioDefaultRecipientId: config.imap.addyioDefaultRecipientId || '',
          addyioDescriptionTemplate: config.imap.addyioDescriptionTemplate || '',
          addyioFromName: config.imap.addyioFromName || '',
          // Save 33mail settings (global)
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

    // Stage progress actions
    setCurrentStage: (stage: string | null) => {
      const { stageProgress, stageTimers } = get();
      const now = Date.now();

      // Update previous stage to success if exists
      if (get().currentStage) {
        const prevStage = get().currentStage!;
        const prevData = stageProgress.get(prevStage);
        if (prevData) {
          stageProgress.set(prevStage, { ...prevData, status: 'success' });
        }
      }

      // Start new stage
      if (stage) {
        stageProgress.set(stage, {
          stage,
          status: 'active',
          startTime: now,
        });
        stageTimers.set(stage, now);
      }

      set({
        currentStage: stage,
        stageProgress: new Map(stageProgress),
        stageTimers: new Map(stageTimers),
      });
    },

    updateStageProgress: (stage: string, current: number, total: number, message?: string) => {
      const { stageProgress } = get();
      const data = stageProgress.get(stage);

      if (data) {
        stageProgress.set(stage, {
          ...data,
          progress: { current, total },
          message,
        });
        set({ stageProgress: new Map(stageProgress) });
      }
    },

    completeStage: (stage: string, status: 'success' | 'error') => {
      const { stageProgress, stageTimers } = get();
      const data = stageProgress.get(stage);

      if (data) {
        stageProgress.set(stage, { ...data, status });
        stageTimers.delete(stage);
        set({
          stageProgress: new Map(stageProgress),
          stageTimers: new Map(stageTimers),
          currentStage: null,
        });
      }
    },

    clearStageProgress: () => {
      set({
        currentStage: null,
        stageProgress: new Map(),
        stageTimers: new Map(),
      });
    },

    // WebSocket actions
    setWsConnected: (connected: boolean) => set({ wsConnected: connected }),
  };
});
