import { useEffect, useCallback, useState, useMemo, useRef } from 'react';
import {
  Play,
  Square,
  User,
  Settings2,
  Wifi,
  Eye,
  EyeOff,
  Keyboard,
  Timer,
  Minus,
  Plus,
} from 'lucide-react';
import { listen } from '@tauri-apps/api/event';

import { cn } from '../lib/utils';
import { StatusBar } from '../components/ui/KPICard';
import { MissionControlHUD } from '../components/ui/MissionControlHUD';
import { IdentitySystemCard, type IdentityConfig } from '../components/ui/IdentitySystemCard';
import { NetworkCard, type NetworkConfig } from '../components/ui/NetworkCard';
import { Tooltip } from '../components/Tooltip';

import { useRegistrationStore } from '../stores/registration';
import { useAppStore } from '../stores/app';
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
} from '../lib/tauri';
import { t } from '../lib/i18n';
import type {
  PythonAutoregResult,
  WindsurfAutoregResult,
  TraeAutoregResult,
  GithubAutoregResult,
} from '../types/generated';

import { PROVIDERS, DEFAULT_IMAP_PORT, RANDOM_NAMES } from '../constants/registration';

// Timeout for each registration attempt (5 minutes)
const REGISTRATION_TIMEOUT_MS = 5 * 60 * 1000;

// Tab types for the command center
type ConfigTab = 'identity' | 'engine' | 'network';

// Compact number input component for timeouts
function TimeoutInput({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit = 's',
  disabled,
  tooltip,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  tooltip?: string;
}) {
  const decrement = () => onChange(Math.max(min, value - step));
  const increment = () => onChange(Math.min(max, value + step));

  const content = (
    <div
      className="rounded-lg p-2"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
    >
      <div className="text-[10px] text-slate-500 mb-1.5">{label}</div>
      <div className="flex items-center gap-1">
        <button
          onClick={decrement}
          disabled={disabled || value <= min}
          className="w-5 h-5 rounded flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <Minus className="w-3 h-3" />
        </button>
        <span className="flex-1 text-center text-xs font-mono text-indigo-400">
          {value}
          {unit}
        </span>
        <button
          onClick={increment}
          disabled={disabled || value >= max}
          className="w-5 h-5 rounded flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
    </div>
  );

  return tooltip ? <Tooltip text={tooltip}>{content}</Tooltip> : content;
}

// Compact toggle switch component
function ToggleSwitch({
  label,
  checked,
  onChange,
  disabled,
  tooltip,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  tooltip?: string;
}) {
  const content = (
    <label
      className={cn(
        'flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors',
        checked ? 'bg-indigo-500/10' : 'bg-white/[0.02]',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      <span className="text-[10px] text-slate-400 flex-1">{label}</span>
      <div
        className={cn(
          'w-7 h-4 rounded-full transition-colors relative',
          checked ? 'bg-indigo-500' : 'bg-white/10'
        )}
      >
        <div
          className={cn(
            'absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform',
            checked ? 'translate-x-3.5' : 'translate-x-0.5'
          )}
        />
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        disabled={disabled}
        className="sr-only"
      />
    </label>
  );

  return tooltip ? <Tooltip text={tooltip}>{content}</Tooltip> : content;
}

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
    setProvider,
    setIMAPConfig,
    setProxyConfig,
    setAdvancedSettings,
    setCount,
    loadSettings,
    saveImmediately,
    addLog,
    clearLogs,
    addHistoryEntry,
    addResult,
  } = useRegistrationStore();

  const [pythonAvailable, setPythonAvailable] = useState<boolean | null>(null);
  const [activeThreads, setActiveThreads] = useState(0);
  const [activeTab, setActiveTab] = useState<ConfigTab>('identity');

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
      addLog({
        level: event.payload.level as 'info' | 'error' | 'success' | 'warn' | 'debug',
        message: event.payload.message,
      });
    });

    const unlistenComplete = listen<{ success: boolean }>('REGISTRATION_COMPLETE', event => {
      if (event.payload.success) {
        addLog({ level: 'success', message: 'Registration completed successfully!' });
      }
    });

    const unlistenError = listen<{ error: string }>('REGISTRATION_ERROR', event => {
      addLog({ level: 'error', message: `Registration error: ${event.payload.error}` });
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

    return () => {
      unlistenLog.then(fn => fn());
      unlistenComplete.then(fn => fn());
      unlistenError.then(fn => fn());
      unlistenAccountAdded.then(fn => fn());
    };
  }, [addLog, addResult]);

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

    // Reset cancellation flag
    cancelledRef.current = false;

    const totalCount = config.count || 1;
    setActiveThreads(1);
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

          if (result.success && result.email && result.password) {
            try {
              await addAccount({
                provider: config.provider,
                email: result.email,
                password: result.password,
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
                email: result.email,
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
                  email: result.email,
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
            addLog({
              level: 'error',
              message: `[${i + 1}/${totalCount}] Registration failed: ${result.error || 'Unknown error'}`,
            });
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
      setActiveThreads(0);
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
    addLog({ level: 'warn', message: 'Stop requested - stopping registration process...' });

    // Set cancellation flag to stop the loop
    cancelledRef.current = true;

    try {
      await stopRegistration();
      addLog({ level: 'info', message: 'Registration stopped' });
      addNotification({ type: 'info', title: 'Stopped', message: 'Registration process stopped' });
    } catch (e) {
      addLog({ level: 'error', message: `Failed to stop: ${e}` });
    }
    setActiveThreads(0);
  }, [addLog, addNotification]);

  // Tab configuration
  const tabs: { id: ConfigTab; label: string; icon: React.ReactNode }[] = [
    { id: 'identity', label: 'Identity', icon: <User className="w-3.5 h-3.5" /> },
    { id: 'engine', label: 'Engine', icon: <Settings2 className="w-3.5 h-3.5" /> },
    { id: 'network', label: 'Network', icon: <Wifi className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="h-full flex" style={{ background: '#050508' }}>
      {/* Left Panel - Command Center */}
      <div className="w-[360px] shrink-0 flex flex-col h-full border-r border-white/5">
        {/* Zone A: Provider Selector (Fixed Top) */}
        <div className="shrink-0 px-4 pt-4 pb-3">
          <div
            className="flex gap-1 p-1 rounded-lg"
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.05)',
            }}
          >
            {PROVIDERS.map(provider => (
              <button
                key={provider.id}
                onClick={() => !provider.disabled && setProvider(provider.id)}
                disabled={activeThreads > 0 || provider.disabled}
                className={cn(
                  'flex-1 py-2 text-xs font-medium rounded-md transition-all duration-200',
                  config.provider === provider.id
                    ? 'text-white bg-white/10'
                    : 'text-slate-500 hover:text-slate-300 hover:bg-white/5',
                  provider.disabled && 'opacity-30 cursor-not-allowed'
                )}
              >
                {provider.name}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Bar */}
        <div className="shrink-0 px-4 pb-3">
          <div
            className="flex gap-1 p-1 rounded-lg"
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.05)',
            }}
          >
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                disabled={false} // Allow tab switching during registration
                className={cn(
                  'flex-1 py-2 px-2 text-xs font-medium rounded-md transition-all duration-200 flex items-center justify-center gap-1.5',
                  activeTab === tab.id
                    ? 'text-white bg-indigo-500/20 shadow-[0_0_10px_rgba(99,102,241,0.3)]'
                    : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                )}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Zone B: Tabbed Content (Dynamic, Scrollable) */}
        <div className="flex-1 overflow-y-auto px-4 py-2">
          {/* Identity Tab */}
          {activeTab === 'identity' &&
            (config.provider === 'aws' ? (
              /* AWS Mode - Show ready card */
              <div className="card border border-orange-500/20 p-8 text-center">
                <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-orange-500/10 flex items-center justify-center">
                  <svg
                    className="w-10 h-10 text-orange-400"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M6.763 10.036c.022.615.022 1.194.022 1.773 0 .615 0 1.195-.022 1.773h-6.74c-.022-.578-.022-1.158-.022-1.773s0-1.195.022-1.773h6.74zm6.104 6.741c.434.638.868 1.195 1.302 1.753.434.558.868 1.116 1.302 1.674-1.085.434-2.17.723-3.255.868-.434-.578-.868-1.116-1.302-1.674-.434-.558-.868-1.116-1.302-1.753 1.085-.145 2.17-.434 3.255-.868zm-6.104-13.482c.022.615.022 1.194.022 1.773 0 .615 0 1.195-.022 1.773h-6.74c-.022-.578-.022-1.158-.022-1.773s0-1.195.022-1.773h6.74zm13.482 6.741c.022.578.022 1.158.022 1.773s0 1.195-.022 1.773h-6.74c.022-.578.022-1.158.022-1.773s0-1.195-.022-1.773h6.74zm-6.104-6.741c.434.638.868 1.195 1.302 1.753.434.558.868 1.116 1.302 1.674-1.085.434-2.17.723-3.255.868-.434-.578-.868-1.116-1.302-1.674-.434-.558-.868-1.116-1.302-1.753 1.085-.145 2.17-.434 3.255-.868zm-6.104 13.482c-.434-.638-.868-1.195-1.302-1.753-.434-.558-.868-1.116-1.302-1.674 1.085-.434 2.17-.723 3.255-.868.434.578.868 1.116 1.302 1.674.434.558.868 1.116 1.302 1.753-1.085.145-2.17.434-3.255.868z" />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">AWS Builder ID</h3>
                <p className="text-sm text-slate-400 mb-6">
                  Configure count and headless mode in Engine tab, then click START
                </p>
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-orange-500/10 border border-orange-500/30 text-sm text-orange-400">
                  <div className="w-2 h-2 rounded-full bg-orange-500 shadow-[0_0_8px] shadow-orange-500/50 animate-pulse" />
                  Ready
                </div>
              </div>
            ) : (
              /* IDE/Git Mode - Show IMAP Card */
              <div className="space-y-4">
                <IdentitySystemCard
                  config={identityConfig}
                  onChange={updates => {
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
                  // Addy.io props
                  onTestAddyio={handleTestAddyioConnection}
                  isTestingAddyio={isTestingAddyio}
                  addyioConnectionStatus={addyioConnectionStatus}
                  addyioConnectionMessage={addyioConnectionMessage}
                  addyioAccountInfo={addyioAccountInfo}
                  addyioDomains={addyioDomains}
                />
              </div>
            ))}

          {/* Engine Tab - Settings */}
          {activeTab === 'engine' && (
            <div className="space-y-4">
              {/* Headless Mode - Full Width Toggle */}
              <div
                className="rounded-lg p-3"
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.05)',
                }}
              >
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center">
                      {config.advanced.headless ? (
                        <EyeOff className="w-4 h-4 text-indigo-400" />
                      ) : (
                        <Eye className="w-4 h-4 text-slate-500" />
                      )}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-slate-200">
                        {t('autoReg.headless')}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {t('autoReg.headlessDescription')}
                      </div>
                    </div>
                  </div>
                  <div
                    className={cn(
                      'w-10 h-5 rounded-full transition-colors relative cursor-pointer',
                      config.advanced.headless ? 'bg-indigo-500' : 'bg-white/10'
                    )}
                  >
                    <div
                      className={cn(
                        'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow-sm',
                        config.advanced.headless ? 'translate-x-5' : 'translate-x-0.5'
                      )}
                    />
                  </div>
                  <input
                    type="checkbox"
                    checked={config.advanced.headless}
                    onChange={e => setAdvancedSettings({ headless: e.target.checked })}
                    disabled={false} // Allow changing for next registration
                    className="sr-only"
                  />
                </label>
              </div>

              {/* Speed & Delay Row */}
              <div className="grid grid-cols-2 gap-3">
                {/* Speed Multiplier */}
                <Tooltip text={t('autoReg.tooltips.speed')}>
                  <div
                    className="rounded-lg p-3"
                    style={{
                      background: 'rgba(255,255,255,0.02)',
                      border: '1px solid rgba(255,255,255,0.05)',
                    }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-slate-400">{t('autoReg.speed')}</span>
                      <span className="text-xs font-mono text-indigo-400">
                        {config.advanced.speedMultiplier.toFixed(1)}x
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0.5"
                      max="2"
                      step="0.1"
                      value={config.advanced.speedMultiplier}
                      onChange={e =>
                        setAdvancedSettings({ speedMultiplier: parseFloat(e.target.value) })
                      }
                      disabled={false} // Allow adjusting speed
                      className="w-full h-1 rounded-full appearance-none cursor-pointer accent-indigo-500"
                      style={{ background: 'rgba(255,255,255,0.1)' }}
                    />
                    <div className="flex justify-between mt-1">
                      <span className="text-[9px] text-slate-600">{t('autoReg.slow')}</span>
                      <span className="text-[9px] text-slate-600">{t('autoReg.fast')}</span>
                    </div>
                  </div>
                </Tooltip>

                {/* Delay Between Accounts */}
                <Tooltip text={t('autoReg.tooltips.delay')}>
                  <div
                    className="rounded-lg p-3"
                    style={{
                      background: 'rgba(255,255,255,0.02)',
                      border: '1px solid rgba(255,255,255,0.05)',
                    }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-slate-400">{t('autoReg.delay')}</span>
                      <span className="text-xs font-mono text-indigo-400">
                        {config.advanced.delayBetweenAccounts}s
                      </span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="10"
                      step="1"
                      value={config.advanced.delayBetweenAccounts}
                      onChange={e =>
                        setAdvancedSettings({ delayBetweenAccounts: parseInt(e.target.value) })
                      }
                      disabled={false} // Allow adjusting delay
                      className="w-full h-1 rounded-full appearance-none cursor-pointer accent-indigo-500"
                      style={{ background: 'rgba(255,255,255,0.1)' }}
                    />
                    <div className="flex justify-between mt-1">
                      <span className="text-[9px] text-slate-600">1s</span>
                      <span className="text-[9px] text-slate-600">10s</span>
                    </div>
                  </div>
                </Tooltip>
              </div>

              {/* Timeouts Section */}
              <div
                className="rounded-lg p-3"
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.05)',
                }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Timer className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-xs uppercase text-slate-500 tracking-wider font-semibold">
                    {t('autoReg.timeouts')}
                  </span>
                </div>

                {/* 2-Column Grid for Timeouts */}
                <div className="grid grid-cols-2 gap-2">
                  <TimeoutInput
                    label={t('autoReg.verification')}
                    value={config.advanced.verificationCodeTimeout}
                    onChange={v => setAdvancedSettings({ verificationCodeTimeout: v })}
                    min={60}
                    max={180}
                    step={10}
                    disabled={false} // Allow adjusting timeouts
                    tooltip={t('autoReg.tooltips.verification')}
                  />
                  <TimeoutInput
                    label={t('autoReg.oauth')}
                    value={config.advanced.oauthCallbackTimeout}
                    onChange={v => setAdvancedSettings({ oauthCallbackTimeout: v })}
                    min={30}
                    max={180}
                    step={10}
                    disabled={false} // Allow adjusting timeouts
                    tooltip={t('autoReg.tooltips.oauth')}
                  />
                  <TimeoutInput
                    label={t('autoReg.allowAccess')}
                    value={config.advanced.allowAccessWait}
                    onChange={v => setAdvancedSettings({ allowAccessWait: v })}
                    min={60}
                    max={300}
                    step={10}
                    disabled={false} // Allow adjusting timeouts
                    tooltip={t('autoReg.tooltips.allowAccess')}
                  />
                  <TimeoutInput
                    label={t('autoReg.pageLoad')}
                    value={config.advanced.pageLoadTimeout}
                    onChange={v => setAdvancedSettings({ pageLoadTimeout: v })}
                    min={2}
                    max={15}
                    step={1}
                    disabled={false} // Allow adjusting timeouts
                    tooltip={t('autoReg.tooltips.pageLoad')}
                  />
                  <TimeoutInput
                    label={t('autoReg.elementWait')}
                    value={config.advanced.elementWaitTimeout}
                    onChange={v => setAdvancedSettings({ elementWaitTimeout: v })}
                    min={1}
                    max={10}
                    step={1}
                    disabled={false} // Allow adjusting timeouts
                    tooltip={t('autoReg.tooltips.elementWait')}
                  />
                  <TimeoutInput
                    label={t('autoReg.imapPoll')}
                    value={config.advanced.imapPollInterval}
                    onChange={v => setAdvancedSettings({ imapPollInterval: v })}
                    min={0.5}
                    max={5}
                    step={0.5}
                    disabled={false} // Allow adjusting timeouts
                    tooltip={t('autoReg.tooltips.imapPoll')}
                  />
                </div>
              </div>

              {/* Browser Behavior Section */}
              <div
                className="rounded-lg p-3"
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.05)',
                }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Keyboard className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-xs uppercase text-slate-500 tracking-wider font-semibold">
                    {t('autoReg.behavior')}
                  </span>
                </div>

                {/* Password Length */}
                <Tooltip text={t('autoReg.tooltips.passwordLength')}>
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-slate-400">{t('autoReg.passwordLength')}</span>
                      <span className="text-xs font-mono text-indigo-400">
                        {config.advanced.passwordLength}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="12"
                      max="24"
                      step="1"
                      value={config.advanced.passwordLength}
                      onChange={e =>
                        setAdvancedSettings({ passwordLength: parseInt(e.target.value) })
                      }
                      disabled={false} // Allow adjusting password length
                      className="w-full h-1 rounded-full appearance-none cursor-pointer accent-indigo-500"
                      style={{ background: 'rgba(255,255,255,0.1)' }}
                    />
                  </div>
                </Tooltip>

                {/* Toggle Switches - 2 rows */}
                <div className="grid grid-cols-2 gap-2">
                  <ToggleSwitch
                    label={t('autoReg.realisticTyping')}
                    checked={config.advanced.realisticTyping}
                    onChange={v => setAdvancedSettings({ realisticTyping: v })}
                    disabled={false} // Allow changing behavior settings
                    tooltip={t('autoReg.tooltips.realisticTyping')}
                  />
                  <ToggleSwitch
                    label={t('autoReg.humanDelays')}
                    checked={config.advanced.humanDelays}
                    onChange={v => setAdvancedSettings({ humanDelays: v })}
                    disabled={false} // Allow changing behavior settings
                    tooltip={t('autoReg.tooltips.humanDelays')}
                  />
                  <ToggleSwitch
                    label={t('autoReg.screenshots')}
                    checked={config.advanced.screenshotsOnError}
                    onChange={v => setAdvancedSettings({ screenshotsOnError: v })}
                    disabled={false} // Allow changing behavior settings
                    tooltip={t('autoReg.tooltips.screenshots')}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Network Tab */}
          {activeTab === 'network' && (
            <NetworkCard
              config={networkConfig}
              onChange={updates => setProxyConfig(updates)}
              disabled={false} // Allow changing network settings
            />
          )}
        </div>

        {/* Zone C: Launch Pad (Fixed Bottom) */}
        <div className="shrink-0 p-4 border-t border-white/5">
          <div
            className="flex rounded-lg overflow-hidden"
            style={{ boxShadow: '0 0 20px rgba(99, 102, 241, 0.15)' }}
          >
            {/* Count Input - cleaner, no # symbol */}
            <div className="relative">
              <input
                type="number"
                min={1}
                max={100}
                value={config.count}
                onChange={e => setCount(parseInt(e.target.value) || 1)}
                disabled={activeThreads > 0}
                className="w-14 h-11 text-center font-mono font-bold text-white text-lg rounded-l-lg rounded-r-none border-r-0 focus:outline-none focus:ring-0"
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRight: 'none',
                }}
              />
            </div>

            {/* Start/Stop Button - attached to input */}
            {activeThreads === 0 ? (
              <button
                onClick={handleStart}
                disabled={!canStart || pythonAvailable === false}
                className={cn(
                  'flex-1 h-11 rounded-l-none rounded-r-lg text-sm font-semibold flex items-center justify-center gap-2',
                  'text-white transition-all',
                  canStart
                    ? 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500'
                    : 'bg-slate-700/50 cursor-not-allowed'
                )}
              >
                <Play className="w-4 h-4" />
                {t('autoReg.start')}
              </button>
            ) : (
              <button
                onClick={handleStop}
                className="flex-1 h-11 rounded-l-none rounded-r-lg text-sm font-semibold flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 text-white transition-colors"
              >
                <Square className="w-4 h-4" />
                {t('autoReg.stop')}
              </button>
            )}
          </div>

          {/* Status indicator */}
          <div className="flex items-center justify-end gap-1.5 mt-2 text-[10px] text-slate-500">
            {canStart ? (
              <>
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px] shadow-emerald-500/50" />{' '}
                {t('autoReg.readyToStart')}
              </>
            ) : (
              <>
                <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />{' '}
                {t('autoReg.configureMailFirst')}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Right Panel - Mission Control HUD */}
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
            />
          </div>
        </div>
      </div>
    </div>
  );
}
