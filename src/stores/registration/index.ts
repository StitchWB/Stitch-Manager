/**
 * Registration store facade - provides backward compatibility
 * Combines config, runtime, and persistence stores into a single interface
 */

import { useConfigStore } from './config.store';
import { useRuntimeStore } from './runtime.store';
import { usePersistenceStore } from './persistence.store';
import { createDebouncedSave, clearSaveTimeout } from './utils/debounce';
import type { ProviderName } from '../../types/ui';
import type { LogVerbosity } from '../../constants/logging';
import type {
  RegistrationConfig,
  IMAPConfig,
  ProxyConfig,
  AdvancedSettings,
  SaveStatus,
} from './types';
import type { RegistrationLog, RegistrationProgress, RegistrationStatus } from '../../types/ui';
import type {
  StageProgressData,
  RegistrationResult,
  RegistrationHistoryEntry,
} from './runtime.store';

// Re-export types for convenience
export type {
  MailStrategy,
  EmailStrategy,
  IMAPConfig,
  ProviderEmailStrategy,
  ProviderEmailStrategies,
  ProxyConfig,
  AutoRegCredentials,
  EmailPattern,
  NamePattern,
  PatternConfig,
  AdvancedSettings,
  RegistrationConfig,
  SaveStatus,
} from './types';

export type {
  StageProgressData,
  RegistrationResult,
  RegistrationHistoryEntry,
} from './runtime.store';

// Combined state interface for backward compatibility
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
  stageTimers: Map<string, number>;

  // Job tracking (survives page navigation)
  pipelineJobId: string | null;
  activeThreads: number;
  isStopping: boolean;

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

  // Actions - Job tracking (survive page navigation)
  setPipelineJobId: (jobId: string | null) => void;
  setActiveThreads: (threads: number) => void;
  setIsStopping: (stopping: boolean) => void;
}

/**
 * Combined registration store
 * Provides a unified interface to all registration stores
 *
 * This is a custom store that combines multiple Zustand stores.
 * It can be used with selectors like a normal Zustand store:
 *
 * @example
 * const config = useRegistrationStore(state => state.config);
 * const { loadSettings } = useRegistrationStore();
 */
export const useRegistrationStore = <T = RegistrationState>(
  selector?: (state: RegistrationState) => T
): T => {
  const configStore = useConfigStore();
  const runtimeStore = useRuntimeStore();
  const persistenceStore = usePersistenceStore();

  // Create debounced save function
  const debouncedSave = createDebouncedSave(async () => {
    // IMPORTANT: always read latest state at save time.
    // Using render-time snapshots here causes stale values to be persisted
    // (e.g. count/headless snapping back after reload).
    const latestConfigStore = useConfigStore.getState();
    const latestPersistenceStore = usePersistenceStore.getState();

    latestPersistenceStore.setSaveStatus('saving');
    await latestPersistenceStore.saveSettings(
      latestConfigStore.config,
      latestConfigStore.logVerbosity
    );
  });

  // Trigger save helper - always read latest from store, not from render closure
  const triggerSave = () => {
    const loaded = usePersistenceStore.getState().settingsLoaded;
    console.log(
      '[REGISTRATION_STORE] triggerSave called, settingsLoaded:',
      loaded
    );
    debouncedSave(loaded);
  };

  // Wrap config actions to trigger auto-save
  const setProvider = (provider: ProviderName) => {
    configStore.setProvider(provider);
    triggerSave();
  };

  const setIMAPConfig = (imap: Partial<IMAPConfig>) => {
    configStore.setIMAPConfig(imap);
    triggerSave();
  };

  const setProxyConfig = (proxy: Partial<ProxyConfig>) => {
    configStore.setProxyConfig(proxy);
    triggerSave();
  };

  const setAdvancedSettings = (settings: Partial<AdvancedSettings>) => {
    configStore.setAdvancedSettings(settings);
    triggerSave();
  };

  const setCount = (count: number) => {
    configStore.setCount(count);
    triggerSave();
  };

  const setUIScale = (scale: number) => {
    configStore.setUIScale(scale);
    triggerSave();
  };

  const setLogVerbosity = (level: LogVerbosity) => {
    configStore.setLogVerbosity(level);
    triggerSave();
  };

  // Load settings and update all stores
  const loadSettings = async () => {
    const config = await persistenceStore.loadSettings();
    if (config) {
      configStore.setConfig(config);
    }
  };

  // Save settings immediately
  const saveSettings = async () => {
    const latestConfigStore = useConfigStore.getState();
    const latestPersistenceStore = usePersistenceStore.getState();
    await latestPersistenceStore.saveSettings(
      latestConfigStore.config,
      latestConfigStore.logVerbosity
    );
  };

  // Immediate save for critical moments
  const saveImmediately = async () => {
    console.log(
      '[REGISTRATION_STORE] saveImmediately: called, settingsLoaded:',
      persistenceStore.settingsLoaded
    );
    if (!persistenceStore.settingsLoaded) {
      console.log('[REGISTRATION_STORE] saveImmediately: settings not loaded, skipping');
      return;
    }

    // Clear any pending debounced save
    clearSaveTimeout();

    // Save immediately without debounce
    console.log('[REGISTRATION_STORE] saveImmediately: calling saveSettings directly');
    await saveSettings();
  };

  const state: RegistrationState = {
    // Config state
    config: configStore.config,
    logVerbosity: configStore.logVerbosity,

    // Runtime state
    isRunning: runtimeStore.isRunning,
    status: runtimeStore.status,
    progress: runtimeStore.progress,
    logs: runtimeStore.logs,
    activeProvider: runtimeStore.activeProvider,
    results: runtimeStore.results,
    successCount: runtimeStore.successCount,
    failedCount: runtimeStore.failedCount,
    history: runtimeStore.history,
    wsConnected: runtimeStore.wsConnected,
    currentStage: runtimeStore.currentStage,
    stageProgress: runtimeStore.stageProgress,
    stageTimers: runtimeStore.stageTimers,
    pipelineJobId: runtimeStore.pipelineJobId,
    activeThreads: runtimeStore.activeThreads,
    isStopping: runtimeStore.isStopping,
    settingsLoaded: persistenceStore.settingsLoaded,
    saveStatus: persistenceStore.saveStatus,
    imapPasswordSet: persistenceStore.imapPasswordSet,
    gmailAppPasswordSet: persistenceStore.gmailAppPasswordSet,

    // Config actions (with auto-save)
    setProvider,
    setIMAPConfig,
    setProxyConfig,
    setAdvancedSettings,
    setCount,
    setUIScale,
    setLogVerbosity,

    // Persistence actions
    loadSettings,
    saveSettings,
    saveImmediately,

    // Runtime actions
    addLog: runtimeStore.addLog,
    clearLogs: runtimeStore.clearLogs,
    setActiveProvider: runtimeStore.setActiveProvider,
    setProgress: runtimeStore.setProgress,
    setCurrentStage: runtimeStore.setCurrentStage,
    updateStageProgress: runtimeStore.updateStageProgress,
    completeStage: runtimeStore.completeStage,
    clearStageProgress: runtimeStore.clearStageProgress,
    addResult: runtimeStore.addResult,
    addHistoryEntry: runtimeStore.addHistoryEntry,
    setWsConnected: runtimeStore.setWsConnected,

    // Job tracking actions (survive page navigation)
    setPipelineJobId: runtimeStore.setPipelineJobId,
    setActiveThreads: runtimeStore.setActiveThreads,
    setIsStopping: runtimeStore.setIsStopping,
  };

  // Apply selector if provided
  if (selector) {
    return selector(state);
  }

  return state as T;
};

// Add getState method for direct state access (used in some components)
useRegistrationStore.getState = (): RegistrationState => {
  const configStore = useConfigStore.getState();
  const runtimeStore = useRuntimeStore.getState();
  const persistenceStore = usePersistenceStore.getState();

  return {
    config: configStore.config,
    logVerbosity: configStore.logVerbosity,
    isRunning: runtimeStore.isRunning,
    status: runtimeStore.status,
    progress: runtimeStore.progress,
    logs: runtimeStore.logs,
    activeProvider: runtimeStore.activeProvider,
    results: runtimeStore.results,
    successCount: runtimeStore.successCount,
    failedCount: runtimeStore.failedCount,
    history: runtimeStore.history,
    wsConnected: runtimeStore.wsConnected,
    currentStage: runtimeStore.currentStage,
    stageProgress: runtimeStore.stageProgress,
    stageTimers: runtimeStore.stageTimers,
    pipelineJobId: runtimeStore.pipelineJobId,
    activeThreads: runtimeStore.activeThreads,
    isStopping: runtimeStore.isStopping,
    settingsLoaded: persistenceStore.settingsLoaded,
    saveStatus: persistenceStore.saveStatus,
    imapPasswordSet: persistenceStore.imapPasswordSet,
    gmailAppPasswordSet: persistenceStore.gmailAppPasswordSet,
    setProvider: (provider: ProviderName) => {
      configStore.setProvider(provider);
      const latestPersistenceStore = usePersistenceStore.getState();
      if (latestPersistenceStore.settingsLoaded) {
        persistenceStore.saveSettings(useConfigStore.getState().config, useConfigStore.getState().logVerbosity);
      }
    },
    setIMAPConfig: (imap: Partial<IMAPConfig>) => {
      configStore.setIMAPConfig(imap);
      const latestPersistenceStore = usePersistenceStore.getState();
      if (latestPersistenceStore.settingsLoaded) {
        persistenceStore.saveSettings(useConfigStore.getState().config, useConfigStore.getState().logVerbosity);
      }
    },
    setProxyConfig: (proxy: Partial<ProxyConfig>) => {
      configStore.setProxyConfig(proxy);
      const latestPersistenceStore = usePersistenceStore.getState();
      if (latestPersistenceStore.settingsLoaded) {
        persistenceStore.saveSettings(useConfigStore.getState().config, useConfigStore.getState().logVerbosity);
      }
    },
    setAdvancedSettings: (settings: Partial<AdvancedSettings>) => {
      configStore.setAdvancedSettings(settings);
      const latestPersistenceStore = usePersistenceStore.getState();
      if (latestPersistenceStore.settingsLoaded) {
        persistenceStore.saveSettings(useConfigStore.getState().config, useConfigStore.getState().logVerbosity);
      }
    },
    setCount: (count: number) => {
      configStore.setCount(count);
      const latestPersistenceStore = usePersistenceStore.getState();
      if (latestPersistenceStore.settingsLoaded) {
        persistenceStore.saveSettings(useConfigStore.getState().config, useConfigStore.getState().logVerbosity);
      }
    },
    setUIScale: (scale: number) => {
      configStore.setUIScale(scale);
      const latestPersistenceStore = usePersistenceStore.getState();
      if (latestPersistenceStore.settingsLoaded) {
        persistenceStore.saveSettings(useConfigStore.getState().config, useConfigStore.getState().logVerbosity);
      }
    },
    setLogVerbosity: (level: LogVerbosity) => {
      configStore.setLogVerbosity(level);
      const latestPersistenceStore = usePersistenceStore.getState();
      if (latestPersistenceStore.settingsLoaded) {
        persistenceStore.saveSettings(useConfigStore.getState().config, useConfigStore.getState().logVerbosity);
      }
    },
    loadSettings: async () => {
      const config = await persistenceStore.loadSettings();
      if (config) {
        configStore.setConfig(config);
      }
    },
    saveSettings: async () =>
      persistenceStore.saveSettings(configStore.config, configStore.logVerbosity),
    saveImmediately: async () =>
      persistenceStore.saveSettings(configStore.config, configStore.logVerbosity),
    addLog: runtimeStore.addLog,
    clearLogs: runtimeStore.clearLogs,
    setActiveProvider: runtimeStore.setActiveProvider,
    setProgress: runtimeStore.setProgress,
    setCurrentStage: runtimeStore.setCurrentStage,
    updateStageProgress: runtimeStore.updateStageProgress,
    completeStage: runtimeStore.completeStage,
    clearStageProgress: runtimeStore.clearStageProgress,
    addResult: runtimeStore.addResult,
    addHistoryEntry: runtimeStore.addHistoryEntry,
    setWsConnected: runtimeStore.setWsConnected,
    setPipelineJobId: runtimeStore.setPipelineJobId,
    setActiveThreads: runtimeStore.setActiveThreads,
    setIsStopping: runtimeStore.setIsStopping,
  };
};
