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
import { Terminal } from '../components/ui/Terminal';
import { IdentitySystemCard, type IdentityConfig } from '../components/ui/IdentitySystemCard';
import { NetworkCard, type NetworkConfig } from '../components/ui/NetworkCard';

import { useRegistrationStore } from '../stores/registration';
import { useAppStore } from '../stores/app';
import { startWindsurfAutoreg, startPythonAutoreg, checkPythonAutoreg, testImapConnection, addAccount, stopRegistration, getNextCounter, listAccounts } from '../lib/tauri';
import { t } from '../lib/i18n';

import {
  PROVIDERS,
  DEFAULT_IMAP_PORT,
  RANDOM_NAMES,
} from '../constants/registration';

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
  disabled 
}: { 
  label: string; 
  value: number; 
  onChange: (v: number) => void; 
  min: number; 
  max: number; 
  step?: number;
  unit?: string;
  disabled?: boolean;
}) {
  const decrement = () => onChange(Math.max(min, value - step));
  const increment = () => onChange(Math.min(max, value + step));

  return (
    <div className="rounded-lg p-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div className="text-[10px] text-slate-500 mb-1.5">{label}</div>
      <div className="flex items-center gap-1">
        <button
          onClick={decrement}
          disabled={disabled || value <= min}
          className="w-5 h-5 rounded flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <Minus className="w-3 h-3" />
        </button>
        <span className="flex-1 text-center text-xs font-mono text-indigo-400">{value}{unit}</span>
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
}

// Compact toggle switch component
function ToggleSwitch({ 
  label, 
  checked, 
  onChange, 
  disabled,
  icon
}: { 
  label: string; 
  checked: boolean; 
  onChange: (v: boolean) => void; 
  disabled?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <label className={cn(
      "flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors",
      checked ? "bg-indigo-500/10" : "bg-white/[0.02]",
      disabled && "opacity-50 cursor-not-allowed"
    )}>
      {icon && <span className="text-slate-500">{icon}</span>}
      <span className="text-[10px] text-slate-400 flex-1">{label}</span>
      <div className={cn(
        "w-7 h-4 rounded-full transition-colors relative",
        checked ? "bg-indigo-500" : "bg-white/10"
      )}>
        <div className={cn(
          "absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform",
          checked ? "translate-x-3.5" : "translate-x-0.5"
        )} />
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="sr-only"
      />
    </label>
  );
}

export default function AutoRegNext() {
  const { addNotification } = useAppStore();
  const {
    config,
    isRunning,
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
    addLog,
    clearLogs,
    addHistoryEntry,
  } = useRegistrationStore();

  const [pythonAvailable, setPythonAvailable] = useState<boolean | null>(null);
  const [activeThreads, setActiveThreads] = useState(0);
  const [activeTab, setActiveTab] = useState<ConfigTab>('identity');
  
  // Ref to track if registration should be cancelled
  const cancelledRef = useRef(false);

  useEffect(() => {
    loadSettings();
    checkPythonAutoreg().then(setPythonAvailable).catch(() => setPythonAvailable(false));
  }, [loadSettings]);

  useEffect(() => {
    const unlistenLog = listen<{ level: string; message: string }>('REGISTRATION_LOG', (event) => {
      addLog({ level: event.payload.level as 'info' | 'error' | 'success' | 'warn' | 'debug', message: event.payload.message });
    });
    return () => { unlistenLog.then(fn => fn()); };
  }, [addLog]);

  // Check if mail configuration is ready
  const isMailReady = useMemo(() => {
    if (config.imap.strategy === 'gmail') {
      return !!(config.imap.gmailBase && (config.imap.gmailAppPassword || gmailAppPasswordSet));
    }
    return !!(config.imap.server && config.imap.email && (config.imap.password || imapPasswordSet));
  }, [config.imap, imapPasswordSet, gmailAppPasswordSet]);

  const canStart = isMailReady;

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

  const handleStart = useCallback(async () => {
    if (!canStart) {
      addNotification({ type: 'error', title: 'Configuration Required', message: 'Please configure IMAP settings' });
      return;
    }

    // Reset cancellation flag
    cancelledRef.current = false;

    const totalCount = config.count || 1;
    setActiveThreads(1);
    addLog({ level: 'info', message: `Starting ${config.provider} registration (${totalCount} account${totalCount > 1 ? 's' : ''})...` });

    // Determine IMAP credentials based on strategy (once, outside loop)
    const imapServer = config.imap.strategy === 'gmail' ? 'imap.gmail.com' : config.imap.server;
    const imapUser = config.imap.strategy === 'gmail' ? config.imap.gmailBase : config.imap.email;
    const imapPassword = config.imap.strategy === 'gmail' ? config.imap.gmailAppPassword : (config.imap.password || '********');

    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;

    // Helper function to wrap registration call with timeout
    const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> => {
      return Promise.race([
        promise,
        new Promise<T>((_, reject) => 
          setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
        )
      ]);
    };

    try {
      // Loop for multiple account registration
      for (let i = 0; i < totalCount; i++) {
        // Check if cancelled
        if (cancelledRef.current) {
          addLog({ level: 'warn', message: `Registration cancelled by user at account ${i + 1}/${totalCount}` });
          break;
        }

        try {
          const timestamp = Date.now();
          let email: string;
          
          // Generate email based on strategy
          if (config.imap.strategy === 'gmail') {
            const base = config.imap.gmailBase.replace('@gmail.com', '');
            // For Gmail, use gmailAlias directly (it may contain shortcodes)
            let alias = config.imap.gmailAlias || 'alias';
            
            // Replace {counter} first if present
            if (alias.includes('{counter}')) {
              const counter = await getNextCounter({ provider: config.provider, strategy: 'gmail' });
              alias = alias.replace(/\{counter\}/gi, counter.toString());
            }
            
            alias = alias.replace(/\{rnd\}/gi, Math.random().toString(36).substring(2, 6));
            alias = alias.replace(/\{time\}/gi, timestamp.toString().slice(-6));
            alias = alias.replace(/\{name\}/gi, RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)]);
            email = `${base}+${alias}@gmail.com`;
          } else {
            let pattern = String(config.patterns.emailPattern);
            
            // Replace {counter} first if present
            if (pattern.includes('{counter}')) {
              const counter = await getNextCounter({ provider: config.provider, strategy: 'custom' });
              pattern = pattern.replace(/\{counter\}/gi, counter.toString());
            }
            
            pattern = pattern.replace(/\{rnd\}/gi, Math.random().toString(36).substring(2, 6));
            pattern = pattern.replace(/\{time\}/gi, timestamp.toString().slice(-6));
            pattern = pattern.replace(/\{name\}/gi, RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)]);
            email = `${pattern}@${emailDomain}`;
          }

          // Check if account already exists in local DB BEFORE starting registration
          const existingAccounts = await listAccounts({ provider: config.provider });
          const accountExists = existingAccounts.some(acc => acc.email.toLowerCase() === email.toLowerCase());
          
          if (accountExists) {
            skipCount++;
            addLog({ level: 'warn', message: `[${i + 1}/${totalCount}] Account ${email} already exists in database, skipping` });
            continue;
          }

          addLog({ level: 'info', message: `[${i + 1}/${totalCount}] Registering ${email}...` });

          let result: { 
            success: boolean; 
            email?: string; 
            password?: string; 
            token?: string;
            refresh_token?: string;
            error?: string 
          };

          if (config.provider === 'windsurf') {
            // Windsurf uses Firebase auth - wrap with timeout
            result = await withTimeout(
              startWindsurfAutoreg({
                email,
                headless: false,
                login_only: false,
                proxy_url: config.proxy.enabled ? config.proxy.url : undefined,
                imap_server: imapServer,
                imap_port: config.imap.port || DEFAULT_IMAP_PORT,
                imap_user: imapUser,
                imap_password: imapPassword,
                email_pattern: config.patterns.emailPattern,
                name_pattern: config.patterns.namePattern,
                name_custom_first: config.patterns.nameCustomFirst,
                name_custom_last: config.patterns.nameCustomLast,
              }),
              REGISTRATION_TIMEOUT_MS,
              `Registration timed out after ${REGISTRATION_TIMEOUT_MS / 60000} minutes`
            );
          } else {
            // Kiro uses AWS Cognito / Builder ID - wrap with timeout
            result = await withTimeout(
              startPythonAutoreg({
                email,
                headless: config.advanced.headless,
                device_flow: false,
                auto_generate: false,
                imap_server: imapServer,
                imap_port: config.imap.port || DEFAULT_IMAP_PORT,
                imap_user: imapUser,
                imap_password: imapPassword,
                proxy_url: config.proxy.enabled ? config.proxy.url : undefined,
                // Advanced settings passed as additional config
                speed_multiplier: config.advanced.speedMultiplier,
                verification_code_timeout: config.advanced.verificationCodeTimeout,
                oauth_callback_timeout: config.advanced.oauthCallbackTimeout,
                allow_access_wait: config.advanced.allowAccessWait,
                page_load_timeout: config.advanced.pageLoadTimeout,
                element_wait_timeout: config.advanced.elementWaitTimeout,
                imap_poll_interval: config.advanced.imapPollInterval,
                password_length: config.advanced.passwordLength,
                realistic_typing: config.advanced.realisticTyping,
                human_delays: config.advanced.humanDelays,
                screenshots_on_error: config.advanced.screenshotsOnError,
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
                token: result.token,
                refresh_token: result.refresh_token
              });
              successCount++;
              addLog({ level: 'success', message: `[${i + 1}/${totalCount}] Account created: ${result.email}` });
              addHistoryEntry({ provider: config.provider, email: result.email, status: 'completed' });
            } catch (err) {
              const errMsg = String(err);
              if (errMsg.includes('already exists') || errMsg.includes('Duplicate')) {
                skipCount++;
                addLog({ level: 'warn', message: `[${i + 1}/${totalCount}] Account ${result.email} already exists, skipping` });
              } else {
                failCount++;
                addLog({ level: 'error', message: `[${i + 1}/${totalCount}] Failed to save account: ${errMsg}` });
              }
            }
          } else {
            failCount++;
            addLog({ level: 'error', message: `[${i + 1}/${totalCount}] Registration failed: ${result.error || 'Unknown error'}` });
          }

          // Configurable delay between registrations to avoid rate limiting
          if (i < totalCount - 1) {
            await new Promise(resolve => setTimeout(resolve, config.advanced.delayBetweenAccounts * 1000));
          }
        } catch (error) {
          failCount++;
          const errorMsg = String(error);
          if (errorMsg.includes('timed out')) {
            addLog({ level: 'error', message: `[${i + 1}/${totalCount}] ${errorMsg} - attempting to stop process and continue...` });
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
        type: successCount > 0 ? 'success' : (failCount > 0 ? 'error' : 'info'), 
        title: 'Registration Complete', 
        message: summary 
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
      const user = config.imap.strategy === 'gmail' ? config.imap.gmailBase : config.imap.email;
      const password = config.imap.strategy === 'gmail' ? config.imap.gmailAppPassword : (config.imap.password || '********');

      const result = await testImapConnection({
        imap_server: server,
        imap_user: user,
        imap_password: password,
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
          <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
            {PROVIDERS.map(provider => (
              <button
                key={provider.id}
                onClick={() => !provider.disabled && setProvider(provider.id)}
                disabled={isRunning || provider.disabled}
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
          <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                disabled={isRunning}
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
          {activeTab === 'identity' && (
            <IdentitySystemCard
              config={identityConfig}
              onChange={(updates) => {
                if ('emailPattern' in updates) {
                  setIMAPConfig({ ...updates });
                } else {
                  setIMAPConfig(updates);
                }
              }}
              onTest={handleTestImap}
              disabled={isRunning}
              saveStatus={saveStatus}
              passwordSet={imapPasswordSet}
              gmailAppPasswordSet={gmailAppPasswordSet}
            />
          )}

          {/* Engine Tab */}
          {activeTab === 'engine' && (
            <div className="space-y-4">
              {/* Headless Mode - Full Width Toggle */}
              <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
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
                      <div className="text-sm font-medium text-slate-200">Headless Mode</div>
                      <div className="text-[10px] text-slate-500">Run browser without visible window</div>
                    </div>
                  </div>
                  <div className={cn(
                    "w-10 h-5 rounded-full transition-colors relative cursor-pointer",
                    config.advanced.headless ? "bg-indigo-500" : "bg-white/10"
                  )}>
                    <div className={cn(
                      "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow-sm",
                      config.advanced.headless ? "translate-x-5" : "translate-x-0.5"
                    )} />
                  </div>
                  <input
                    type="checkbox"
                    checked={config.advanced.headless}
                    onChange={(e) => setAdvancedSettings({ headless: e.target.checked })}
                    disabled={isRunning}
                    className="sr-only"
                  />
                </label>
              </div>

              {/* Speed & Delay Row */}
              <div className="grid grid-cols-2 gap-3">
                {/* Speed Multiplier */}
                <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-slate-400">Speed</span>
                    <span className="text-xs font-mono text-indigo-400">{config.advanced.speedMultiplier.toFixed(1)}x</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="2"
                    step="0.1"
                    value={config.advanced.speedMultiplier}
                    onChange={(e) => setAdvancedSettings({ speedMultiplier: parseFloat(e.target.value) })}
                    disabled={isRunning}
                    className="w-full h-1 rounded-full appearance-none cursor-pointer accent-indigo-500"
                    style={{ background: 'rgba(255,255,255,0.1)' }}
                  />
                  <div className="flex justify-between mt-1">
                    <span className="text-[9px] text-slate-600">Slow</span>
                    <span className="text-[9px] text-slate-600">Fast</span>
                  </div>
                </div>

                {/* Delay Between Accounts */}
                <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-slate-400">Delay</span>
                    <span className="text-xs font-mono text-indigo-400">{config.advanced.delayBetweenAccounts}s</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    step="1"
                    value={config.advanced.delayBetweenAccounts}
                    onChange={(e) => setAdvancedSettings({ delayBetweenAccounts: parseInt(e.target.value) })}
                    disabled={isRunning}
                    className="w-full h-1 rounded-full appearance-none cursor-pointer accent-indigo-500"
                    style={{ background: 'rgba(255,255,255,0.1)' }}
                  />
                  <div className="flex justify-between mt-1">
                    <span className="text-[9px] text-slate-600">1s</span>
                    <span className="text-[9px] text-slate-600">10s</span>
                  </div>
                </div>
              </div>

              {/* Timeouts Section */}
              <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="flex items-center gap-2 mb-3">
                  <Timer className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-xs uppercase text-slate-500 tracking-wider font-semibold">Timeouts</span>
                </div>
                
                {/* 2-Column Grid for Timeouts */}
                <div className="grid grid-cols-2 gap-2">
                  <TimeoutInput
                    label="Verification"
                    value={config.advanced.verificationCodeTimeout}
                    onChange={(v) => setAdvancedSettings({ verificationCodeTimeout: v })}
                    min={60}
                    max={180}
                    step={10}
                    disabled={isRunning}
                  />
                  <TimeoutInput
                    label="OAuth"
                    value={config.advanced.oauthCallbackTimeout}
                    onChange={(v) => setAdvancedSettings({ oauthCallbackTimeout: v })}
                    min={30}
                    max={180}
                    step={10}
                    disabled={isRunning}
                  />
                  <TimeoutInput
                    label="Allow Access"
                    value={config.advanced.allowAccessWait}
                    onChange={(v) => setAdvancedSettings({ allowAccessWait: v })}
                    min={60}
                    max={300}
                    step={10}
                    disabled={isRunning}
                  />
                  <TimeoutInput
                    label="Page Load"
                    value={config.advanced.pageLoadTimeout}
                    onChange={(v) => setAdvancedSettings({ pageLoadTimeout: v })}
                    min={2}
                    max={15}
                    step={1}
                    disabled={isRunning}
                  />
                  <TimeoutInput
                    label="Element Wait"
                    value={config.advanced.elementWaitTimeout}
                    onChange={(v) => setAdvancedSettings({ elementWaitTimeout: v })}
                    min={1}
                    max={10}
                    step={1}
                    disabled={isRunning}
                  />
                  <TimeoutInput
                    label="IMAP Poll"
                    value={config.advanced.imapPollInterval}
                    onChange={(v) => setAdvancedSettings({ imapPollInterval: v })}
                    min={0.5}
                    max={5}
                    step={0.5}
                    disabled={isRunning}
                  />
                </div>
              </div>

              {/* Browser Behavior Section */}
              <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="flex items-center gap-2 mb-3">
                  <Keyboard className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-xs uppercase text-slate-500 tracking-wider font-semibold">Behavior</span>
                </div>
                
                {/* Password Length */}
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-slate-400">Password Length</span>
                    <span className="text-xs font-mono text-indigo-400">{config.advanced.passwordLength}</span>
                  </div>
                  <input
                    type="range"
                    min="12"
                    max="24"
                    step="1"
                    value={config.advanced.passwordLength}
                    onChange={(e) => setAdvancedSettings({ passwordLength: parseInt(e.target.value) })}
                    disabled={isRunning}
                    className="w-full h-1 rounded-full appearance-none cursor-pointer accent-indigo-500"
                    style={{ background: 'rgba(255,255,255,0.1)' }}
                  />
                </div>

                {/* Toggle Switches - 2 rows */}
                <div className="grid grid-cols-2 gap-2">
                  <ToggleSwitch
                    label="Realistic Typing"
                    checked={config.advanced.realisticTyping}
                    onChange={(v) => setAdvancedSettings({ realisticTyping: v })}
                    disabled={isRunning}
                  />
                  <ToggleSwitch
                    label="Human Delays"
                    checked={config.advanced.humanDelays}
                    onChange={(v) => setAdvancedSettings({ humanDelays: v })}
                    disabled={isRunning}
                  />
                  <ToggleSwitch
                    label="Screenshots"
                    checked={config.advanced.screenshotsOnError}
                    onChange={(v) => setAdvancedSettings({ screenshotsOnError: v })}
                    disabled={isRunning}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Network Tab */}
          {activeTab === 'network' && (
            <NetworkCard
              config={networkConfig}
              onChange={(updates) => setProxyConfig(updates)}
              disabled={isRunning}
            />
          )}
        </div>

        {/* Zone C: Launch Pad (Fixed Bottom) */}
        <div className="shrink-0 p-4 border-t border-white/5">
          <div className="flex rounded-lg overflow-hidden" style={{ boxShadow: '0 0 20px rgba(99, 102, 241, 0.15)' }}>
            {/* Count Input - attached to button */}
            <div className="relative">
              <input
                type="number"
                min={1}
                max={100}
                value={config.count}
                onChange={(e) => setCount(parseInt(e.target.value) || 1)}
                disabled={isRunning}
                className="w-16 h-11 text-center font-mono font-bold text-white rounded-l-lg rounded-r-none border-r-0 focus:outline-none focus:ring-0"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRight: 'none' }}
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-600">#</span>
            </div>
            
            {/* Start/Stop Button - attached to input */}
            {!isRunning ? (
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
              <><div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px] shadow-emerald-500/50" /> {t('autoReg.readyToStart')}</>
            ) : (
              <><div className="w-1.5 h-1.5 rounded-full bg-amber-500" /> {t('autoReg.configureMailFirst')}</>
            )}
          </div>
        </div>
      </div>

      {/* Right Panel - Console Output Card */}
      <div className="flex-1 flex flex-col min-w-0 p-4" style={{ background: '#050508' }}>
        <div className="card h-full flex flex-col border border-white/5">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
            <div>
              <h3 className="text-sm font-semibold text-white">{t('autoReg.consoleOutput')}</h3>
              <p className="text-2xs text-slate-500 mt-0.5">{t('autoReg.liveRegistrationLogs')}</p>
            </div>
            <div className="flex items-center gap-3">
              <StatusBar success={successCount} failed={failedCount} active={activeThreads} />
              <button
                onClick={clearLogs}
                className="btn-ghost text-xs py-1.5 px-3"
              >
                {t('common.clear')}
              </button>
            </div>
          </div>
          
          {/* Terminal */}
          <div className="flex-1 min-h-0">
            <Terminal logs={logs} className="h-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
