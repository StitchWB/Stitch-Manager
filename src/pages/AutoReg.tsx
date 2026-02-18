import { useEffect, useCallback, useState, useMemo, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';

import { type IdentityConfig } from '../components/ui/IdentitySystemCard';
import { type NetworkConfig } from '../components/ui/NetworkCard';
import { StatusBar } from '../components/ui/KPICard';
import { MissionControlHUD } from '../components/ui/MissionControlHUD';
import {
  ProviderSelector,
  ConfigTabs,
  type ConfigTab,
  IdentityTab,
  EngineTab,
  NetworkTab,
  AutomationTab,
  LaunchPad,
} from '../components/registration';

import { useRegistrationStore } from '../stores/registration';
import { useAppStore } from '../stores/app';
import { useUIPreferencesStore } from '../stores/uiPreferences';
import {
  startWindsurfAutoreg,
  startPythonAutoreg,
  startTraeAutoreg,
  startGithubAutoreg,
  checkPythonAutoreg,
  testImapConnection,
  addAccount,
  stopRegistration,
  getNextCounter,
  listAccounts,
  testAddyioConnection,
  getAddyioAccount,
  getAddyioDomains,
  startRegistrationV2,
} from '../lib/tauri';
import { t } from '../lib/i18n';
import type {
  PythonAutoregResult,
  WindsurfAutoregResult,
  TraeAutoregResult,
  GithubAutoregResult,
} from '../types/generated';

import { DEFAULT_IMAP_PORT, RANDOM_NAMES } from '../constants/registration';

// Timeout for each registration attempt (5 minutes)
const REGISTRATION_TIMEOUT_MS = 5 * 60 * 1000;

export default function AutoRegNext() {
  const { addNotification } = useAppStore();
  const {
    config,
    logs,
    successCount,
    failedCount,
    imapPasswordSet,
    gmailAppPasswordSet,
    saveStatus,
    activeProvider,
    logVerbosity,
    setProvider,
    setIMAPConfig,
    setProxyConfig,
    setAdvancedSettings,
    setCount,
    setLogVerbosity,
    loadSettings,
    saveImmediately,
    addLog,
    clearLogs,
    addHistoryEntry,
    addResult,
    setActiveProvider,
  } = useRegistrationStore();

  // Use UI preferences for persistent state
  const { autoRegPage, setAutoRegTab, setAutoRegV2, setAutoRegRunning } = useUIPreferencesStore();

  const [pythonAvailable, setPythonAvailable] = useState<boolean | null>(null);
  const [activeThreads, setActiveThreads] = useState(0);
  const [isStopping, setIsStopping] = useState(false);

  // Use persisted preferences instead of local state
  const activeTab = autoRegPage.activeTab;
  const useRegistrationV2 = autoRegPage.useRegistrationV2;

  // Wrapper functions to update both local state and preferences
  const handleSetActiveTab = (tab: ConfigTab) => {
    setAutoRegTab(tab);
  };

  const handleSetUseRegistrationV2 = (enabled: boolean) => {
    setAutoRegV2(enabled);
  };

  // Sync activeThreads with isRunning preference
  const handleSetActiveThreads = (threads: number) => {
    setActiveThreads(threads);
    setAutoRegRunning(threads > 0);
  };

  // Restore running state on mount
  useEffect(() => {
    if (autoRegPage.isRunning) {
      setActiveThreads(1); // Restore running state
    }
  }, []);

  // Addy.io state
  const [addyioDomains, setAddyioDomains] = useState<string[]>([]);
  const [addyioAccountInfo, setAddyioAccountInfo] = useState<any>(null);
  const [isTestingAddyio, setIsTestingAddyio] = useState(false);
  const [addyioConnectionStatus, setAddyioConnectionStatus] = useState<
    'idle' | 'success' | 'error'
  >('idle');
  const [addyioConnectionMessage, setAddyioConnectionMessage] = useState('');

  // Ref to track if registration should be cancelled
  const cancelledRef = useRef(false);

  useEffect(() => {
    console.log('[AUTOREG] useEffect: initializing, calling loadSettings');
    loadSettings();
    checkPythonAutoreg()
      .then(setPythonAvailable)
      .catch(() => setPythonAvailable(false));

    // Save settings when user leaves the page or switches tabs
    const handleBeforeUnload = () => {
      console.log('[AUTOREG] beforeunload event fired');
      // Force immediate save when leaving page
      const settingsLoaded = useRegistrationStore.getState().settingsLoaded;
      console.log('[AUTOREG] beforeunload: settingsLoaded =', settingsLoaded);
      if (settingsLoaded) {
        console.log('[AUTOREG] beforeunload: calling saveImmediately');
        // Trigger immediate save
        saveImmediately();
      }
    };

    const handleVisibilityChange = () => {
      console.log(
        '[AUTOREG] visibilitychange event fired, document.visibilityState =',
        document.visibilityState
      );
      if (document.visibilityState === 'hidden') {
        console.log('[AUTOREG] tab became hidden, attempting to save');
        // Save when tab becomes hidden
        const settingsLoaded = useRegistrationStore.getState().settingsLoaded;
        console.log('[AUTOREG] visibilitychange: settingsLoaded =', settingsLoaded);
        if (settingsLoaded) {
          console.log('[AUTOREG] visibilitychange: calling saveImmediately');
          saveImmediately();
        }
      }
    };

    // Add event listeners
    console.log('[AUTOREG] adding event listeners for beforeunload and visibilitychange');
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup
    return () => {
      console.log('[AUTOREG] cleaning up event listeners');
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadSettings, saveImmediately]);

  useEffect(() => {
    const unlistenLog = listen<{ level: string; message: string }>('REGISTRATION_LOG', event => {
      let level = event.payload.level;
      let message = event.payload.message;

      // Try parsing nested JSON log
      if (typeof message === 'string' && message.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(message);
          if (parsed.type === 'log' && parsed.message) {
            message = parsed.message;
            if (parsed.level) level = parsed.level;
          }
        } catch (e) {
          // Not valid JSON, keep original message
        }
      }

      addLog({
        level: level as 'info' | 'error' | 'success' | 'warn' | 'debug',
        message: message,
      });
    });

    const unlistenComplete = listen<{ success: boolean }>('REGISTRATION_COMPLETE', event => {
      if (event.payload.success) {
        addLog({ level: 'success', message: 'Registration completed successfully!' });
      }
      // Reset active threads when registration completes
      handleSetActiveThreads(0);
    });

    const unlistenError = listen<{ error: string }>('REGISTRATION_ERROR', event => {
      addLog({ level: 'error', message: `Registration error: ${event.payload.error}` });
      // Reset active threads on error
      handleSetActiveThreads(0);
    });

    // Listen for Registration V2 progress events
    const unlistenProgress = listen<{ step: string; message: string }>(
      'REGISTRATION_PROGRESS',
      event => {
        addLog({
          level: 'info',
          message: `[V2] ${event.payload.step}: ${event.payload.message}`,
        });
      }
    );

    // Sync settings when they are updated elsewhere (e.g., Settings page)
    const unlistenSettings = listen<any>('SETTINGS_UPDATED', () => {
      console.log('[AUTOREG] Received SETTINGS_UPDATED event, reloading...');
      loadSettings();
    });

    // CRITICAL: Listen for ACCOUNT_ADDED events to update counters in real-time
    const unlistenAccountAdded = listen<{
      id: number;
      email: string;
      provider: string;
      has_token: boolean;
    }>('ACCOUNT_ADDED', event => {
      const { email, provider, has_token } = event.payload;
      addLog({ level: 'success', message: `✓ Account created: ${email} (${provider})` });
      addResult({
        email,
        status: 'success',
        token: has_token ? 'present' : undefined,
      });
    });

    // Also sync on window focus to handle external changes
    const handleFocus = () => {
      console.log('[AUTOREG] Window focused, reloading settings...');
      loadSettings();
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      unlistenLog.then(fn => fn());
      unlistenComplete.then(fn => fn());
      unlistenError.then(fn => fn());
      unlistenProgress.then(fn => fn());
      unlistenSettings.then(fn => fn());
      unlistenAccountAdded.then(fn => fn());
      window.removeEventListener('focus', handleFocus);
    };
  }, [addLog, addResult, loadSettings]);

  // Listen for stage tracking events
  useEffect(() => {
    const { setCurrentStage, updateStageProgress, completeStage } = useRegistrationStore.getState();

    const unlistenStageChanged = listen<{ stage: string; timestamp: string }>(
      'stage-changed',
      event => {
        setCurrentStage(event.payload.stage);
      }
    );

    const unlistenStageProgress = listen<{
      stage: string;
      current: number;
      total: number;
      message: string;
    }>('stage-progress', event => {
      updateStageProgress(
        event.payload.stage,
        event.payload.current,
        event.payload.total,
        event.payload.message
      );
    });

    const unlistenStageComplete = listen<{ stage: string; status: 'success' | 'error' }>(
      'stage-complete',
      event => {
        completeStage(event.payload.stage, event.payload.status);
      }
    );

    return () => {
      unlistenStageChanged.then(fn => fn());
      unlistenStageProgress.then(fn => fn());
      unlistenStageComplete.then(fn => fn());
    };
  }, []);

  // Check if mail configuration is ready
  const isMailReady = useMemo(() => {
    if (config.imap.strategy === 'gmail') {
      return !!(config.imap.gmailBase && (config.imap.gmailAppPassword || gmailAppPasswordSet));
    }
    return !!(config.imap.server && config.imap.email && (config.imap.password || imapPasswordSet));
  }, [config.imap, imapPasswordSet, gmailAppPasswordSet]);

  // AWS doesn't require IMAP configuration (can work without email verification in some cases)
  const canStart = config.provider === 'aws' ? true : isMailReady;

  // Identity config adapter for IdentitySystemCard
  const identityConfig: IdentityConfig = {
    strategy: config.imap.strategy,
    emailPattern: String(config.patterns.emailPattern),
    server: config.imap.server,
    port: config.imap.port,
    email: config.imap.email,
    password: config.imap.password,
    gmailBase: config.imap.gmailBase,
    gmailAlias: config.imap.gmailAlias,
    gmailAppPassword: config.imap.gmailAppPassword,
    addyioEnabled: config.imap.addyioEnabled,
    addyioApiToken: config.imap.addyioApiToken,
    addyioDomain: config.imap.addyioDomain,
    addyioAliasFormat: config.imap.addyioAliasFormat,
    addyioAutoDelete: config.imap.addyioAutoDelete,
    thirtyThreeMailEnabled: config.imap.thirtyThreeMailEnabled,
    thirtyThreeMailUsername: config.imap.thirtyThreeMailUsername,
    thirtyThreeMailDomain: config.imap.thirtyThreeMailDomain,
  };

  // Network config adapter for NetworkCard
  const networkConfig: NetworkConfig = {
    enabled: config.proxy.enabled,
    url: config.proxy.url,
    username: config.proxy.username,
    password: config.proxy.password,
  };

  // Get email domain for pattern generation
  const emailDomain = useMemo(() => {
    if (config.imap.strategy === 'gmail') {
      return 'gmail.com';
    }
    return config.imap.email?.split('@')[1] || 'example.com';
  }, [config.imap.strategy, config.imap.email]);

  // Test addy.io connection and fetch data
  const handleTestAddyioConnection = useCallback(async () => {
    console.log('[ADDYIO] handleTestAddyioConnection called');
    console.log('[ADDYIO] API token:', config.imap.addyioApiToken ? '***set***' : 'empty');

    if (!config.imap.addyioApiToken) {
      console.error('[ADDYIO] No API token configured');
      setAddyioConnectionStatus('error');
      setAddyioConnectionMessage(t('autoReg.addyio.connectionError'));
      return;
    }

    setIsTestingAddyio(true);
    setAddyioConnectionStatus('idle');
    setAddyioConnectionMessage('');

    try {
      console.log('[ADDYIO] Testing token validity...');
      // Test token validity
      const tokenDetails = await testAddyioConnection(config.imap.addyioApiToken);
      console.log('[ADDYIO] Token valid:', tokenDetails.name);

      console.log('[ADDYIO] Fetching account, domains, recipients...');
      // Fetch account info and domains
      const [account, domains] = await Promise.all([
        getAddyioAccount(config.imap.addyioApiToken),
        getAddyioDomains(config.imap.addyioApiToken),
      ]);

      console.log('[ADDYIO] ===== RAW API RESPONSE =====');
      console.log('[ADDYIO] Received domains object:', domains);
      console.log('[ADDYIO] domains.data:', domains.data);
      console.log('[ADDYIO] domains.data type:', typeof domains.data);
      console.log('[ADDYIO] domains.data is array:', Array.isArray(domains.data));
      console.log('[ADDYIO] domains.data length:', domains.data?.length);
      console.log('[ADDYIO] domains.sharedDomains:', domains.sharedDomains);
      console.log('[ADDYIO] domains.defaultAliasDomain:', domains.defaultAliasDomain);
      console.log('[ADDYIO] ===========================');

      console.log('[ADDYIO] Setting state...');

      setAddyioAccountInfo(account);

      const domainsToSet = domains.data || [];
      console.log('[ADDYIO] About to call setAddyioDomains with:', domainsToSet);
      console.log('[ADDYIO] domainsToSet is array:', Array.isArray(domainsToSet));
      console.log('[ADDYIO] domainsToSet length:', domainsToSet.length);

      setAddyioDomains(domainsToSet);

      console.log('[ADDYIO] setAddyioDomains called (state update is async)');

      // Update config with defaults if not set
      const updates: any = {};
      if (!config.imap.addyioDomain && domains.defaultAliasDomain) {
        updates.addyioDomain = domains.defaultAliasDomain;
      }
      if (!config.imap.addyioDefaultRecipientId && account.defaultRecipientId) {
        updates.addyioDefaultRecipientId = account.defaultRecipientId;
      }
      if (Object.keys(updates).length > 0) {
        setIMAPConfig(updates);
      }

      setAddyioConnectionStatus('success');
      setAddyioConnectionMessage(
        t('autoReg.addyio.connectionSuccess').replace('{tokenName}', tokenDetails.name)
      );

      addLog({ level: 'success', message: 'Addy.io connection test successful' });
    } catch (error) {
      setAddyioConnectionStatus('error');
      setAddyioConnectionMessage(error instanceof Error ? error.message : 'Connection failed');
      addLog({
        level: 'error',
        message: `Addy.io connection test failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } finally {
      setIsTestingAddyio(false);
    }
  }, [
    config.imap.addyioApiToken,
    config.imap.addyioDomain,
    config.imap.addyioDefaultRecipientId,
    setIMAPConfig,
    addLog,
    t,
  ]);

  // Monitor addyioDomains state changes for debugging
  useEffect(() => {
    console.log('[ADDYIO] addyioDomains state changed:', addyioDomains);
    console.log('[ADDYIO] addyioDomains.length:', addyioDomains.length);
    console.log('[ADDYIO] Is array:', Array.isArray(addyioDomains));
  }, [addyioDomains]);

  // Registration handler - uses direct Python commands with proper timeout handling
  const handleStart = useCallback(async () => {
    if (!canStart) {
      addNotification({
        type: 'error',
        title: 'Configuration Required',
        message: 'Please configure IMAP settings',
      });
      return;
    }

    // Additional validation for alias services
    if (config.imap.addyioEnabled && !config.imap.addyioApiToken) {
      addNotification({
        type: 'error',
        title: 'Addy.io Token Required',
        message: 'Please enter your Addy.io API token in the Identity tab',
      });
      return;
    }

    if (config.imap.thirtyThreeMailEnabled && !config.imap.thirtyThreeMailUsername) {
      addNotification({
        type: 'error',
        title: '33mail Username Required',
        message: 'Please enter your 33mail username in the Identity tab',
      });
      return;
    }

    // Reset cancellation flag
    cancelledRef.current = false;

    const totalCount = config.count || 1;
    handleSetActiveThreads(1);
    addLog({
      level: 'info',
      message: `Starting ${config.provider} registration (${totalCount} account${totalCount > 1 ? 's' : ''})...`,
    });

    // Determine IMAP credentials based on strategy (once, outside loop)
    const imapServer = config.imap.strategy === 'gmail' ? 'imap.gmail.com' : config.imap.server;
    // For Gmail, ensure gmailBase has @gmail.com suffix
    let imapUser = config.imap.strategy === 'gmail' ? config.imap.gmailBase : config.imap.email;
    if (config.imap.strategy === 'gmail' && imapUser && !imapUser.includes('@')) {
      imapUser = `${imapUser}@gmail.com`;
    }
    const imapPassword =
      config.imap.strategy === 'gmail'
        ? config.imap.gmailAppPassword
        : config.imap.password || '********';

    // Debug log IMAP config (without password)
    addLog({
      level: 'debug',
      message: `IMAP config: server=${imapServer}, user=${imapUser}, password=${imapPassword ? '***set***' : '***empty***'}`,
    });

    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;

    // Helper function to wrap registration call with timeout
    const withTimeout = <T,>(
      promise: Promise<T>,
      timeoutMs: number,
      errorMessage: string
    ): Promise<T> => {
      return Promise.race([
        promise,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(errorMessage)), timeoutMs)),
      ]);
    };

    try {
      // Loop for multiple account registration
      for (let i = 0; i < totalCount; i++) {
        // Check if cancelled
        if (cancelledRef.current) {
          addLog({
            level: 'warn',
            message: `Registration cancelled by user at account ${i + 1}/${totalCount}`,
          });
          break;
        }

        try {
          // Use Registration V2 for AWS/Kiro if enabled
          if (useRegistrationV2 && config.provider === 'aws') {
            addLog({
              level: 'info',
              message: `[${i + 1}/${totalCount}] Using Registration V2 (Rust-based flow)...`,
            });

            try {
              const result = await withTimeout(
                startRegistrationV2({
                  email: null,
                  name: null,
                  password: null,
                }),
                REGISTRATION_TIMEOUT_MS,
                `Registration timed out after ${REGISTRATION_TIMEOUT_MS / 60000} minutes`
              );

              if (result.success && result.email) {
                successCount++;
                addLog({
                  level: 'success',
                  message: `[${i + 1}/${totalCount}] Account created: ${result.email}`,
                });
                addHistoryEntry({
                  provider: config.provider,
                  email: result.email,
                  status: 'completed',
                });
              } else {
                failCount++;
                addLog({
                  level: 'error',
                  message: `[${i + 1}/${totalCount}] Registration failed: ${result.error || 'Unknown error'}`,
                });
              }
            } catch (error) {
              failCount++;
              const errorMsg = String(error);
              addLog({
                level: 'error',
                message: `[${i + 1}/${totalCount}] V2 Registration error: ${errorMsg}`,
              });
            }

            // Delay between registrations
            if (i < totalCount - 1) {
              await new Promise(resolve =>
                setTimeout(resolve, config.advanced.delayBetweenAccounts * 1000)
              );
            }
            continue; // Skip to next iteration
          }

          // Original flow (V1) - continue with existing logic
          const timestamp = Date.now();
          let email: string | null;

          // If addy.io or 33mail is enabled, let Python generate the email
          if (config.imap.addyioEnabled || config.imap.thirtyThreeMailEnabled) {
            email = null; // Signal to Python to generate email using EmailManager
            const service = config.imap.addyioEnabled ? 'addy.io' : '33mail';
            addLog({
              level: 'info',
              message: `[${i + 1}/${totalCount}] Using ${service} for email generation...`,
            });
          } else {
            // Generate email based on strategy (existing logic)
            if (config.imap.strategy === 'gmail') {
              const base = config.imap.gmailBase.replace('@gmail.com', '');
              // For Gmail, use gmailAlias directly (it may contain shortcodes)
              let alias = config.imap.gmailAlias || 'alias';

              // Replace {counter} first if present
              if (alias.includes('{counter}')) {
                const counter = await getNextCounter({
                  provider: config.provider,
                  strategy: 'gmail',
                });
                alias = alias.replace(/\{counter\}/gi, counter.toString());
              }

              alias = alias.replace(/\{rnd\}/gi, Math.random().toString(36).substring(2, 6));
              alias = alias.replace(/\{time\}/gi, timestamp.toString().slice(-6));
              alias = alias.replace(
                /\{name\}/gi,
                RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)]
              );
              email = `${base}+${alias}@gmail.com`;
            } else {
              let pattern = String(config.patterns.emailPattern);

              // Replace {counter} first if present
              if (pattern.includes('{counter}')) {
                const counter = await getNextCounter({
                  provider: config.provider,
                  strategy: 'custom',
                });
                pattern = pattern.replace(/\{counter\}/gi, counter.toString());
              }

              pattern = pattern.replace(/\{rnd\}/gi, Math.random().toString(36).substring(2, 6));
              pattern = pattern.replace(/\{time\}/gi, timestamp.toString().slice(-6));
              pattern = pattern.replace(
                /\{name\}/gi,
                RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)]
              );
              email = `${pattern}@${emailDomain}`;
            }
          }

          // Check if account already exists in local DB BEFORE starting registration
          // Skip this check if email is null (will be generated by Python)
          if (email) {
            const existingAccounts = await listAccounts({ provider: config.provider });
            const accountExists = existingAccounts.some(
              acc => acc.email.toLowerCase() === email.toLowerCase()
            );

            if (accountExists) {
              skipCount++;
              addLog({
                level: 'warn',
                message: `[${i + 1}/${totalCount}] Account ${email} already exists in database, skipping`,
              });
              continue;
            }
          }

          addLog({
            level: 'info',
            message: `[${i + 1}/${totalCount}] Registering ${email || '(email will be generated)'}...`,
          });

          let result:
            | PythonAutoregResult
            | WindsurfAutoregResult
            | TraeAutoregResult
            | GithubAutoregResult;

          if (config.provider === 'windsurf') {
            // Windsurf uses Firebase auth - wrap with timeout
            result = await withTimeout(
              startWindsurfAutoreg({
                email,
                password: null,
                name: null,
                headless: false,
                loginOnly: false,
                proxyUrl: config.proxy.enabled ? config.proxy.url : null,
                imapServer: imapServer,
                imapPort: config.imap.port || DEFAULT_IMAP_PORT,
                imapUser: imapUser,
                imapPassword: imapPassword,
                emailPattern: config.patterns.emailPattern,
                namePattern: config.patterns.namePattern,
                nameCustomFirst: config.patterns.nameCustomFirst,
                nameCustomLast: config.patterns.nameCustomLast,
                // Addy.io configuration
                addyioEnabled: config.imap.addyioEnabled ?? null,
                addyioApiToken: config.imap.addyioApiToken ?? null,
                addyioDomain: config.imap.addyioDomain ?? null,
                addyioAliasFormat: config.imap.addyioAliasFormat ?? null,
                addyioAutoDelete: config.imap.addyioAutoDelete ?? null,
                // 33mail configuration
                thirtyThreeMailEnabled: config.imap.thirtyThreeMailEnabled ?? null,
                thirtyThreeMailUsername: config.imap.thirtyThreeMailUsername ?? null,
                thirtyThreeMailDomain: config.imap.thirtyThreeMailDomain ?? null,
              }),
              REGISTRATION_TIMEOUT_MS,
              `Registration timed out after ${REGISTRATION_TIMEOUT_MS / 60000} minutes`
            );
          } else if (config.provider === 'trae') {
            // Trae uses email + verification code - wrap with timeout
            result = await withTimeout(
              startTraeAutoreg({
                email,
                password: null,
                name: null,
                headless: config.advanced.headless,
                proxyUrl: config.proxy.enabled ? config.proxy.url : null,
                imapServer: imapServer,
                imapPort: config.imap.port || DEFAULT_IMAP_PORT,
                imapUser: imapUser,
                imapPassword: imapPassword,
                // Addy.io configuration
                addyioEnabled: config.imap.addyioEnabled ?? null,
                addyioApiToken: config.imap.addyioApiToken ?? null,
                addyioDomain: config.imap.addyioDomain ?? null,
                addyioAliasFormat: config.imap.addyioAliasFormat ?? null,
                addyioAutoDelete: config.imap.addyioAutoDelete ?? null,
                // 33mail configuration
                thirtyThreeMailEnabled: config.imap.thirtyThreeMailEnabled ?? null,
                thirtyThreeMailUsername: config.imap.thirtyThreeMailUsername ?? null,
                thirtyThreeMailDomain: config.imap.thirtyThreeMailDomain ?? null,
              }),
              REGISTRATION_TIMEOUT_MS,
              `Registration timed out after ${REGISTRATION_TIMEOUT_MS / 60000} minutes`
            );
          } else if (config.provider === 'github') {
            // GitHub uses email + password + verification code - wrap with timeout
            // Generate a strong password that meets GitHub requirements
            const githubPassword = `Gh${Math.random().toString(36).substring(2, 10)}!1`;
            result = await withTimeout(
              startGithubAutoreg({
                email,
                password: githubPassword,
                username: null, // Let provider generate from email
                verificationCode: null,
                headless: config.advanced.headless,
                imapServer: imapServer,
                imapUser: imapUser,
                imapPassword: imapPassword,
              }),
              REGISTRATION_TIMEOUT_MS,
              `Registration timed out after ${REGISTRATION_TIMEOUT_MS / 60000} minutes`
            );
          } else {
            // Kiro uses AWS Cognito / Builder ID - wrap with timeout
            result = await withTimeout(
              startPythonAutoreg({
                email: email,
                name: null,
                password: null,
                headless: config.advanced.headless,
                deviceFlow: false,
                autoGenerate: false,
                imapServer: imapServer,
                imapPort: config.imap.port || DEFAULT_IMAP_PORT,
                imapUser: imapUser,
                imapPassword: imapPassword,
                emailStrategy: null,
                proxyUrl: config.proxy.enabled ? config.proxy.url : null,
                // Advanced settings passed as additional config
                speedMultiplier: config.advanced.speedMultiplier,
                verificationCodeTimeout: config.advanced.verificationCodeTimeout,
                oauthCallbackTimeout: config.advanced.oauthCallbackTimeout,
                allowAccessWait: config.advanced.allowAccessWait,
                pageLoadTimeout: config.advanced.pageLoadTimeout,
                elementWaitTimeout: config.advanced.elementWaitTimeout,
                imapPollInterval: config.advanced.imapPollInterval,
                passwordLength: config.advanced.passwordLength,
                realisticTyping: config.advanced.realisticTyping,
                humanDelays: config.advanced.humanDelays,
                screenshotsOnError: config.advanced.screenshotsOnError,
                // Addy.io configuration
                addyioEnabled: config.imap.addyioEnabled ?? null,
                addyioApiToken: config.imap.addyioApiToken ?? null,
                addyioDomain: config.imap.addyioDomain ?? null,
                addyioAliasFormat: config.imap.addyioAliasFormat ?? null,
                addyioAutoDelete: config.imap.addyioAutoDelete ?? null,
                // 33mail configuration
                thirtyThreeMailEnabled: config.imap.thirtyThreeMailEnabled ?? null,
                thirtyThreeMailUsername: config.imap.thirtyThreeMailUsername ?? null,
                thirtyThreeMailDomain: config.imap.thirtyThreeMailDomain ?? null,
              }),
              REGISTRATION_TIMEOUT_MS,
              `Registration timed out after ${REGISTRATION_TIMEOUT_MS / 60000} minutes`
            );
          }

          // Check if registration succeeded based on provider-specific criteria
          const isWindsurf = config.provider === 'windsurf';
          const windsurfApiKey = isWindsurf
            ? ((result as any).apiKey ?? (result as any).api_key)
            : null;
          const hasRequiredData = isWindsurf
            ? result.success && result.email
            : result.success && result.email && result.password;

          if (hasRequiredData) {
            try {
              await addAccount({
                provider: config.provider,
                email: result.email!,
                password: result.password || '',
                token: 'token' in result && result.token ? result.token : undefined,
                refreshToken:
                  'refreshToken' in result && result.refreshToken ? result.refreshToken : undefined,
                // Pass name in metadata for Windsurf account switching
                metadata: 'name' in result && result.name ? { name: result.name } : undefined,
              });
              successCount++;
              addLog({
                level: 'success',
                message: `[${i + 1}/${totalCount}] Account created: ${result.email}`,
              });
              addHistoryEntry({
                provider: config.provider,
                email: result.email!,
                status: 'completed',
              });
            } catch (err) {
              const errMsg = String(err);
              if (errMsg.includes('already exists') || errMsg.includes('Duplicate')) {
                // Account exists but registration succeeded - count as success (credentials updated)
                successCount++;
                addLog({
                  level: 'success',
                  message: `[${i + 1}/${totalCount}] Account ${result.email} updated (was already in database)`,
                });
                addHistoryEntry({
                  provider: config.provider,
                  email: result.email!,
                  status: 'completed',
                });
              } else {
                failCount++;
                addLog({
                  level: 'error',
                  message: `[${i + 1}/${totalCount}] Failed to save account: ${errMsg}`,
                });
              }
            }
          } else {
            failCount++;
            const keys =
              result && typeof result === 'object' ? Object.keys(result as any).sort() : [];
            const json = (() => {
              try {
                return JSON.stringify(result);
              } catch {
                return null;
              }
            })();
            const jsonShort = json && json.length > 900 ? `${json.slice(0, 900)}...` : json;
            addLog({
              level: 'error',
              message: `[${i + 1}/${totalCount}] Registration failed: ${result.error || 'Unknown error'}`,
            });
            addLog({
              level: 'error',
              message: `[${i + 1}/${totalCount}] Debug: provider=${config.provider}, success=${String(
                (result as any)?.success
              )}, email=${String((result as any)?.email)}, error=${String(
                (result as any)?.error
              )}, apiKey=${windsurfApiKey ? 'present' : 'missing'}, keys=${keys.join(',')}`,
            });
            if (jsonShort) {
              addLog({
                level: 'error',
                message: `[${i + 1}/${totalCount}] Debug JSON: ${jsonShort}`,
              });
            }
          }

          // Configurable delay between registrations to avoid rate limiting
          if (i < totalCount - 1) {
            await new Promise(resolve =>
              setTimeout(resolve, config.advanced.delayBetweenAccounts * 1000)
            );
          }
        } catch (error) {
          failCount++;
          const errorMsg = String(error);
          if (errorMsg.includes('timed out')) {
            addLog({
              level: 'error',
              message: `[${i + 1}/${totalCount}] ${errorMsg} - attempting to stop process and continue...`,
            });
            // Try to stop the hung process
            try {
              await stopRegistration();
            } catch {
              // Ignore stop errors
            }
          } else {
            addLog({ level: 'error', message: `[${i + 1}/${totalCount}] Error: ${errorMsg}` });
          }
        }
      }

      // Summary notification
      const summary = `✓ ${successCount} created, ⊘ ${skipCount} skipped, ✗ ${failCount} failed`;
      addLog({ level: 'info', message: `Registration complete: ${summary}` });
      addNotification({
        type: successCount > 0 ? 'success' : failCount > 0 ? 'error' : 'info',
        title: 'Registration Complete',
        message: summary,
      });
    } catch (error) {
      addLog({ level: 'error', message: `Fatal error: ${String(error)}` });
      addNotification({ type: 'error', title: 'Error', message: String(error) });
    } finally {
      handleSetActiveThreads(0);
    }
  }, [config, emailDomain, canStart, addLog, addNotification, addHistoryEntry]);

  const handleTestImap = useCallback(async (): Promise<boolean> => {
    addLog({ level: 'info', message: 'Testing IMAP connection...' });
    try {
      // Determine credentials based on strategy
      const server = config.imap.strategy === 'gmail' ? 'imap.gmail.com' : config.imap.server;
      let user = config.imap.strategy === 'gmail' ? config.imap.gmailBase : config.imap.email;
      // For Gmail, ensure user has @gmail.com suffix
      if (config.imap.strategy === 'gmail' && user && !user.includes('@')) {
        user = `${user}@gmail.com`;
      }
      const password =
        config.imap.strategy === 'gmail'
          ? config.imap.gmailAppPassword
          : config.imap.password || '********';

      addLog({ level: 'debug', message: `Testing: server=${server}, user=${user}` });

      const result = await testImapConnection({
        imapServer: server,
        imapUser: user,
        imapPassword: password,
      });
      addLog({ level: 'success', message: `IMAP: ${result}` });
      addNotification({ type: 'success', title: 'IMAP OK', message: 'Connection successful' });
      return true;
    } catch (e) {
      addLog({ level: 'error', message: `IMAP error: ${e}` });
      return false;
    }
  }, [config.imap, addLog, addNotification]);

  const handleStop = useCallback(async () => {
    if (isStopping) return;

    setIsStopping(true);
    addLog({ level: 'warn', message: 'Stop requested - killing active processes...' });

    // Set cancellation flag to stop the JS loop
    cancelledRef.current = true;

    try {
      await stopRegistration();
      addLog({ level: 'info', message: 'All registration processes terminated' });
      addNotification({ type: 'info', title: 'Stopped', message: 'Registration process stopped' });
    } catch (e) {
      addLog({ level: 'error', message: `Failed to stop processes: ${e}` });
    } finally {
      handleSetActiveThreads(0);
      setIsStopping(false);
    }
  }, [addLog, addNotification, isStopping]);

  return (
    <div className="h-full flex flex-col md:flex-row" style={{ background: '#050508' }}>
      {/* Left Panel - Command Center */}
      <div className="w-full md:w-[360px] lg:w-[400px] shrink-0 flex flex-col h-full border-b md:border-b-0 md:border-r border-white/5">
        {/* Provider Selector */}
        <ProviderSelector
          activeProvider={config.provider}
          onProviderChange={setProvider}
          disabled={activeThreads > 0}
        />

        {/* Tab Bar */}
        <ConfigTabs activeTab={activeTab} onTabChange={handleSetActiveTab} disabled={false} />

        {/* Tabbed Content */}
        <div className="flex-1 overflow-y-auto px-4 py-2">
          {activeTab === 'identity' && (
            <IdentityTab
              provider={config.provider}
              identityConfig={identityConfig}
              onConfigChange={updates => {
                if ('emailPattern' in updates) {
                  setIMAPConfig({ ...updates });
                } else {
                  setIMAPConfig(updates);
                }
              }}
              onTest={handleTestImap}
              disabled={activeThreads > 0}
              saveStatus={saveStatus}
              passwordSet={imapPasswordSet}
              gmailAppPasswordSet={gmailAppPasswordSet}
              onTestAddyio={handleTestAddyioConnection}
              isTestingAddyio={isTestingAddyio}
              addyioConnectionStatus={addyioConnectionStatus}
              addyioConnectionMessage={addyioConnectionMessage}
              addyioAccountInfo={addyioAccountInfo}
              addyioDomains={addyioDomains}
            />
          )}

          {activeTab === 'engine' && (
            <EngineTab
              provider={config.provider}
              useRegistrationV2={useRegistrationV2}
              onUseRegistrationV2Change={handleSetUseRegistrationV2}
              headless={config.advanced.headless}
              onHeadlessChange={headless => setAdvancedSettings({ headless })}
              speedMultiplier={config.advanced.speedMultiplier}
              onSpeedMultiplierChange={speedMultiplier => setAdvancedSettings({ speedMultiplier })}
              delayBetweenAccounts={config.advanced.delayBetweenAccounts}
              onDelayBetweenAccountsChange={delayBetweenAccounts =>
                setAdvancedSettings({ delayBetweenAccounts })
              }
              logVerbosity={logVerbosity}
              onLogVerbosityChange={setLogVerbosity}
              verificationCodeTimeout={config.advanced.verificationCodeTimeout}
              onVerificationCodeTimeoutChange={verificationCodeTimeout =>
                setAdvancedSettings({ verificationCodeTimeout })
              }
              oauthCallbackTimeout={config.advanced.oauthCallbackTimeout}
              onOauthCallbackTimeoutChange={oauthCallbackTimeout =>
                setAdvancedSettings({ oauthCallbackTimeout })
              }
              allowAccessWait={config.advanced.allowAccessWait}
              onAllowAccessWaitChange={allowAccessWait => setAdvancedSettings({ allowAccessWait })}
              pageLoadTimeout={config.advanced.pageLoadTimeout}
              onPageLoadTimeoutChange={pageLoadTimeout => setAdvancedSettings({ pageLoadTimeout })}
              elementWaitTimeout={config.advanced.elementWaitTimeout}
              onElementWaitTimeoutChange={elementWaitTimeout =>
                setAdvancedSettings({ elementWaitTimeout })
              }
              imapPollInterval={config.advanced.imapPollInterval}
              onImapPollIntervalChange={imapPollInterval =>
                setAdvancedSettings({ imapPollInterval })
              }
              passwordLength={config.advanced.passwordLength}
              onPasswordLengthChange={passwordLength => setAdvancedSettings({ passwordLength })}
              realisticTyping={config.advanced.realisticTyping}
              onRealisticTypingChange={realisticTyping => setAdvancedSettings({ realisticTyping })}
              humanDelays={config.advanced.humanDelays}
              onHumanDelaysChange={humanDelays => setAdvancedSettings({ humanDelays })}
              screenshotsOnError={config.advanced.screenshotsOnError}
              onScreenshotsOnErrorChange={screenshotsOnError =>
                setAdvancedSettings({ screenshotsOnError })
              }
              disabled={activeThreads > 0}
            />
          )}

          {activeTab === 'network' && (
            <NetworkTab
              config={networkConfig}
              onChange={updates => setProxyConfig(updates)}
              disabled={false}
            />
          )}

          {activeTab === 'automation' && <AutomationTab disabled={activeThreads > 0} />}
        </div>

        {/* Launch Pad */}

        <LaunchPad
          count={config.count}
          onCountChange={setCount}
          isRunning={activeThreads > 0 || isStopping}
          canStart={canStart && !isStopping}
          pythonAvailable={pythonAvailable}
          onStart={handleStart}
          onStop={handleStop}
        />
      </div>

      {/* Right Panel - Console */}
      <div className="flex-1 flex flex-col min-w-0 p-4" style={{ background: '#050508' }}>
        <div className="card h-full flex flex-col border border-white/5 overflow-hidden">
          {/* Header */}
          <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-white/5">
            <div>
              <h3 className="text-sm font-semibold text-white">{t('autoReg.consoleOutput')}</h3>
              <p className="text-2xs text-slate-500 mt-0.5">{t('autoReg.liveRegistrationLogs')}</p>
            </div>
            <div className="flex items-center gap-3">
              <StatusBar success={successCount} failed={failedCount} active={activeThreads} />
              <button onClick={clearLogs} className="btn-ghost text-xs py-1.5 px-3">
                {t('common.clear')}
              </button>
            </div>
          </div>

          {/* Mission Control HUD */}
          <div className="flex-1 min-h-0">
            <MissionControlHUD
              logs={logs}
              isRunning={activeThreads > 0}
              canStart={canStart}
              onStart={handleStart}
              onClear={clearLogs}
              className="h-full"
              activeProvider={activeProvider || undefined}
              onProviderChange={provider => setActiveProvider(provider || '')}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
