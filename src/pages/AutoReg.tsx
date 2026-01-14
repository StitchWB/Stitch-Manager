import { useEffect, useCallback, useState, useMemo } from 'react';
import {
  Play,
  Square,
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

import {
  PROVIDERS,
  DEFAULT_IMAP_PORT,
  RANDOM_NAMES,
} from '../constants/registration';

export default function AutoRegNext() {
  const { addNotification } = useAppStore();
  const {
    config,
    isRunning,
    logs,
    successCount,
    failedCount,
    imapPasswordSet,
    saveStatus,
    setProvider,
    setIMAPConfig,
    setProxyConfig,
    setCount,
    loadSettings,
    addLog,
    clearLogs,
    addHistoryEntry,
  } = useRegistrationStore();

  const [pythonAvailable, setPythonAvailable] = useState<boolean | null>(null);
  const [activeThreads, setActiveThreads] = useState(0);

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
      return !!(config.imap.gmailBase && config.imap.gmailAppPassword);
    }
    return !!(config.imap.server && config.imap.email && (config.imap.password || imapPasswordSet));
  }, [config.imap, imapPasswordSet]);

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

    try {
      // Loop for multiple account registration
      for (let i = 0; i < totalCount; i++) {
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
              console.log(`[Counter] Provider: ${config.provider}, Strategy: gmail, Counter: ${counter}`);
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
              console.log(`[Counter] Provider: ${config.provider}, Strategy: custom, Counter: ${counter}`);
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
            // Windsurf uses Firebase auth
            result = await startWindsurfAutoreg({
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
            });
          } else {
            // Kiro uses AWS Cognito / Builder ID
            result = await startPythonAutoreg({
              email,
              headless: false,
              device_flow: false,
              auto_generate: false,
              imap_server: imapServer,
              imap_port: config.imap.port || DEFAULT_IMAP_PORT,
              imap_user: imapUser,
              imap_password: imapPassword,
              proxy_url: config.proxy.enabled ? config.proxy.url : undefined,
            });
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

          // Small delay between registrations to avoid rate limiting
          if (i < totalCount - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } catch (error) {
          failCount++;
          addLog({ level: 'error', message: `[${i + 1}/${totalCount}] Error: ${String(error)}` });
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

  const handleTestImap = useCallback(async () => {
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
    } catch (e) {
      addLog({ level: 'error', message: `IMAP error: ${e}` });
    }
  }, [config.imap, addLog, addNotification]);

  const handleStop = useCallback(async () => {
    addLog({ level: 'warn', message: 'Stop requested - stopping registration process...' });
    try {
      await stopRegistration();
      addLog({ level: 'info', message: 'Registration stopped' });
      addNotification({ type: 'info', title: 'Stopped', message: 'Registration process stopped' });
    } catch (e) {
      addLog({ level: 'error', message: `Failed to stop: ${e}` });
    }
    setActiveThreads(0);
  }, [addLog, addNotification]);

  return (
    <div className="h-full flex" style={{ background: '#050508' }}>
      {/* Left Panel */}
      <div className="w-[360px] shrink-0 flex flex-col border-r border-white/5">
        
        {/* Provider Tabs - Dashboard Style */}
        <div className="px-4 pt-4 pb-3">
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

        {/* Configuration Stack */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            
            {/* Identity System Card - Unified */}
            <IdentitySystemCard
              config={identityConfig}
              onChange={(updates) => {
                // Handle pattern updates
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
            />

            {/* Network Card - Compact */}
            <NetworkCard
              config={networkConfig}
              onChange={(updates) => setProxyConfig(updates)}
              disabled={isRunning}
            />
        </div>

        {/* Launch Pad - Dashboard Style */}
        <div className="p-4 border-t border-white/5">
          <div className="grid grid-cols-[80px_1fr] gap-3">
            {/* Count Input */}
            <input
              type="number"
              min={1}
              max={100}
              value={config.count}
              onChange={(e) => setCount(parseInt(e.target.value) || 1)}
              disabled={isRunning}
              className="input-ds h-11 text-center font-mono font-bold"
            />
            
            {/* Start Button */}
            {!isRunning ? (
              <button
                onClick={handleStart}
                disabled={!canStart || pythonAvailable === false}
                className={cn(
                  'btn-primary h-11 text-sm font-semibold',
                  !canStart && 'opacity-50 cursor-not-allowed'
                )}
              >
                <Play className="w-4 h-4" />
                START
              </button>
            ) : (
              <button
                onClick={handleStop}
                className="h-11 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 text-white transition-colors"
              >
                <Square className="w-4 h-4" />
                STOP
              </button>
            )}
          </div>
          
          {/* Status indicator */}
          <div className="flex items-center justify-end gap-1.5 mt-2 text-[10px] text-slate-500">
            {canStart ? (
              <><div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px] shadow-emerald-500/50" /> Ready to start</>
            ) : (
              <><div className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Configure mail first</>
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
              <h3 className="text-sm font-semibold text-white">Console Output</h3>
              <p className="text-2xs text-slate-500 mt-0.5">Live registration logs</p>
            </div>
            <div className="flex items-center gap-3">
              <StatusBar success={successCount} failed={failedCount} active={activeThreads} />
              <button
                onClick={clearLogs}
                className="btn-ghost text-xs py-1.5 px-3"
              >
                Clear
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
