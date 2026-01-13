import { useEffect, useCallback, useState, useMemo } from 'react';
import {
  Play,
  Square,
  Mail,
  Eye,
  EyeOff,
  RefreshCw,
  Wifi,
  Shield,
} from 'lucide-react';
import { listen } from '@tauri-apps/api/event';

import { cn } from '../lib/utils';
import { StatusBar } from '../components/ui/KPICard';
import { Terminal } from '../components/ui/Terminal';
import { ModuleCard, type ModuleStatus } from '../components/ui/ModuleCard';

import { useRegistrationStore } from '../stores/registration';
import { useAppStore } from '../stores/app';
import { startWindsurfAutoreg, startPythonAutoreg, checkPythonAutoreg, testImapConnection, addAccount, stopRegistration } from '../lib/tauri';

import {
  PROVIDERS,
  EMAIL_SHORTCODES,
  DEFAULT_EMAIL_PATTERN,
  DEFAULT_IMAP_PORT,
  RANDOM_NAMES,
} from '../constants/registration';
import { THEME, INPUT_STYLE } from '../constants/theme';

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

  const [showImapPassword, setShowImapPassword] = useState(false);
  const [showProxyPassword, setShowProxyPassword] = useState(false);
  const [pythonAvailable, setPythonAvailable] = useState<boolean | null>(null);
  const [activeThreads, setActiveThreads] = useState(0);
  const [expandedModule, setExpandedModule] = useState<string | null>('imap');
  const [emailPattern, setEmailPattern] = useState(DEFAULT_EMAIL_PATTERN);
  const [preview, setPreview] = useState('');

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

  const emailDomain = useMemo(() => config.imap.email?.split('@')[1] || 'example.com', [config.imap.email]);

  const generatePreview = useCallback(() => {
    let result = emailPattern || 'prefix';
    result = result.replace(/\{rnd\}/gi, Math.random().toString(36).substring(2, 6));
    result = result.replace(/\{time\}/gi, Date.now().toString().slice(-6));
    result = result.replace(/\{name\}/gi, RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)]);
    setPreview(`${result}@${emailDomain}`);
  }, [emailPattern, emailDomain]);

  useEffect(() => {
    generatePreview();
  }, [emailPattern, emailDomain]);

  const insertShortcode = (code: string) => {
    setEmailPattern(prev => prev + code);
  };

  const networkStatus: ModuleStatus = config.proxy.enabled 
    ? (config.proxy.url ? 'ready' : 'error')
    : 'ready';
  
  const networkSummary = config.proxy.enabled 
    ? (config.proxy.url ? `Proxy: ${config.proxy.url.slice(0, 25)}...` : 'Proxy URL required')
    : 'Direct Connection';

  const imapStatus: ModuleStatus = (config.imap.server && config.imap.email && (config.imap.password || imapPasswordSet))
    ? 'ready'
    : 'error';
  
  const imapSummary = imapStatus === 'ready' 
    ? config.imap.email 
    : 'Configure IMAP';

  const canStart = imapStatus === 'ready' && networkStatus !== 'error';

  const toggleModule = (id: string) => {
    setExpandedModule(prev => prev === id ? null : id);
  };

  const handleStart = useCallback(async () => {
    if (!canStart) {
      addNotification({ type: 'error', title: 'Configuration Required', message: 'Please configure IMAP settings' });
      return;
    }

    setActiveThreads(1);
    addLog({ level: 'info', message: `Starting ${config.provider} registration...` });

    try {
      const timestamp = Date.now();
      let email = emailPattern;
      email = email.replace(/\{rnd\}/gi, Math.random().toString(36).substring(2, 6));
      email = email.replace(/\{time\}/gi, timestamp.toString().slice(-6));
      email = email.replace(/\{name\}/gi, RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)]);
      email = `${email}@${emailDomain}`;

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
          imap_server: config.imap.server,
          imap_port: config.imap.port || DEFAULT_IMAP_PORT,
          imap_user: config.imap.email,
          imap_password: config.imap.password || '********',
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
          imap_server: config.imap.server,
          imap_port: config.imap.port || DEFAULT_IMAP_PORT,
          imap_user: config.imap.email,
          imap_password: config.imap.password || '********',
          proxy_url: config.proxy.enabled ? config.proxy.url : undefined,
        });
      }

      if (result.success && result.email && result.password) {
        await addAccount({ 
          provider: config.provider, 
          email: result.email, 
          password: result.password,
          token: result.token,
          refresh_token: result.refresh_token
        });
        addLog({ level: 'success', message: `Account created: ${result.email}` });
        addHistoryEntry({ provider: config.provider, email: result.email, status: 'completed' });
        addNotification({ type: 'success', title: 'Success', message: `Account ${result.email} created` });
      } else {
        addLog({ level: 'error', message: result.error || 'Registration failed' });
      }
    } catch (error) {
      addLog({ level: 'error', message: String(error) });
    } finally {
      setActiveThreads(0);
    }
  }, [config, emailPattern, emailDomain, canStart, addLog, addNotification, addHistoryEntry]);

  const handleTestImap = useCallback(async () => {
    addLog({ level: 'info', message: 'Testing IMAP connection...' });
    try {
      const result = await testImapConnection({
        imap_server: config.imap.server,
        imap_user: config.imap.email,
        imap_password: config.imap.password || '********',
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
    <div className="h-full flex" style={{ background: THEME.bg.deep }}>
      {/* Left Panel */}
      <div className="w-[340px] shrink-0 flex flex-col border-r border-white/5">
        
        {/* Target Selector */}
        <div className="px-4 py-3 border-b border-white/5">
          <div className="flex rounded-lg p-0.5" style={{ background: 'rgba(255,255,255,0.03)' }}>
            {PROVIDERS.map(provider => (
              <button
                key={provider.id}
                onClick={() => !provider.disabled && setProvider(provider.id)}
                disabled={isRunning || provider.disabled}
                className={cn(
                  'flex-1 py-1.5 text-xs font-medium rounded-md transition-all',
                  config.provider === provider.id
                    ? 'text-white'
                    : 'text-slate-500 hover:text-slate-300',
                  provider.disabled && 'opacity-30 cursor-not-allowed'
                )}
                style={config.provider === provider.id ? {
                  background: 'rgba(99, 102, 241, 0.2)',
                  boxShadow: '0 0 20px rgba(99, 102, 241, 0.3)'
                } : {}}
              >
                {provider.name}
              </button>
            ))}
          </div>
        </div>

        {/* Email Pattern - Seamless Input */}
        <div className="px-4 py-4 border-b border-white/5">
          <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-2">Email Pattern</div>
          
          <div className="rounded-lg p-3" style={{ background: THEME.bg.surface, border: `1px solid ${THEME.border.light}` }}>
            {/* Variable Badges */}
            <div className="flex items-center gap-2 flex-wrap mb-3">
              {EMAIL_SHORTCODES.map(({ id, label, code }) => (
                <button
                  key={id}
                  onClick={() => insertShortcode(code)}
                  disabled={isRunning}
                  className="text-xs font-medium px-2 py-1 rounded border border-white/10 text-slate-400 hover:border-indigo-500/50 hover:text-indigo-400 transition-colors cursor-pointer bg-transparent"
                >
                  {label}
                </button>
              ))}
              <div className="flex-1" />
              <button
                onClick={() => setEmailPattern('')}
                className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors"
              >
                Clear
              </button>
            </div>

            {/* Seamless Input Group */}
            <div className="flex items-center w-full h-11 rounded-lg border border-white/10 bg-[#121214] focus-within:border-indigo-500/50 transition-colors">
              <input
                type="text"
                value={emailPattern}
                onChange={(e) => setEmailPattern(e.target.value)}
                disabled={isRunning}
                placeholder={DEFAULT_EMAIL_PATTERN}
                className="flex-1 h-full bg-transparent border-none outline-none pl-3 text-sm font-mono text-white placeholder-zinc-600 focus:ring-0"
              />
              <span className="pr-3 pl-2 text-sm font-mono text-zinc-500 select-none border-l border-white/5">
                @{emailDomain}
              </span>
            </div>

            {/* Preview */}
            <div className="flex items-center justify-between mt-3">
              <span className="text-sm text-emerald-400 font-mono truncate">{preview}</span>
              <button
                onClick={generatePreview}
                className="p-1.5 rounded text-slate-600 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Infrastructure Stack */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-3">Infrastructure</div>
          <div className="space-y-2">
            
            {/* Network Module */}
            <ModuleCard
              id="network"
              title="Network"
              icon={<Wifi className="w-4 h-4" />}
              status={networkStatus}
              summary={networkSummary}
              isExpanded={expandedModule === 'network'}
              onToggle={toggleModule}
              disabled={isRunning}
            >
              <div className="space-y-3">
                <label className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Use Proxy</span>
                  <input
                    type="checkbox"
                    checked={config.proxy.enabled}
                    onChange={(e) => setProxyConfig({ enabled: e.target.checked })}
                    className="w-4 h-4 accent-indigo-500 rounded"
                  />
                </label>
                
                {config.proxy.enabled && (
                  <>
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase mb-1 block">Proxy URL</label>
                      <input
                        type="text"
                        placeholder="http://user:pass@proxy:8080"
                        value={config.proxy.url}
                        onChange={(e) => setProxyConfig({ url: e.target.value })}
                        className="w-full h-9 px-3 rounded-md font-mono text-xs text-white placeholder-slate-600 outline-none"
                        style={INPUT_STYLE}
                      />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-slate-500 uppercase mb-1 block">Username</label>
                        <input
                          type="text"
                          placeholder="Optional"
                          value={config.proxy.username || ''}
                          onChange={(e) => setProxyConfig({ username: e.target.value })}
                          className="w-full h-9 px-3 rounded-md text-xs text-white placeholder-slate-600 outline-none"
                          style={INPUT_STYLE}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-500 uppercase mb-1 block">Password</label>
                        <div className="relative">
                          <input
                            type={showProxyPassword ? 'text' : 'password'}
                            placeholder="Optional"
                            value={config.proxy.password || ''}
                            onChange={(e) => setProxyConfig({ password: e.target.value })}
                            className="w-full h-9 px-3 pr-8 rounded-md text-xs text-white placeholder-slate-600 outline-none"
                            style={INPUT_STYLE}
                          />
                          <button
                            type="button"
                            onClick={() => setShowProxyPassword(!showProxyPassword)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400"
                          >
                            {showProxyPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </ModuleCard>

            {/* IMAP Module */}
            <ModuleCard
              id="imap"
              title="Mail (IMAP)"
              icon={<Mail className="w-4 h-4" />}
              status={imapStatus}
              summary={imapSummary}
              isExpanded={expandedModule === 'imap'}
              onToggle={toggleModule}
              disabled={isRunning}
            >
              <div className="space-y-3">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-[10px] text-slate-500 uppercase mb-1 block">IMAP Host</label>
                    <input
                      type="text"
                      placeholder="imap.example.com"
                      value={config.imap.server}
                      onChange={(e) => setIMAPConfig({ server: e.target.value })}
                      className="w-full h-9 px-3 rounded-md font-mono text-xs text-white placeholder-slate-600 outline-none"
                      style={INPUT_STYLE}
                    />
                  </div>
                  <div className="w-20">
                    <label className="text-[10px] text-slate-500 uppercase mb-1 block">Port</label>
                    <input
                      type="number"
                      placeholder="993"
                      value={config.imap.port}
                      onChange={(e) => setIMAPConfig({ port: parseInt(e.target.value) || DEFAULT_IMAP_PORT })}
                      className="w-full h-9 px-3 rounded-md font-mono text-xs text-white placeholder-slate-600 outline-none text-center"
                      style={INPUT_STYLE}
                    />
                  </div>
                </div>
                
                <div>
                  <label className="text-[10px] text-slate-500 uppercase mb-1 block">Email</label>
                  <input
                    type="email"
                    placeholder="user@example.com"
                    value={config.imap.email}
                    onChange={(e) => setIMAPConfig({ email: e.target.value })}
                    className="w-full h-9 px-3 rounded-md font-mono text-xs text-white placeholder-slate-600 outline-none"
                    style={INPUT_STYLE}
                  />
                </div>
                
                <div>
                  <label className="text-[10px] text-slate-500 uppercase mb-1 block">Password</label>
                  <div className="relative">
                    <input
                      type={showImapPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={config.imap.password || (imapPasswordSet ? '••••••••' : '')}
                      onChange={(e) => setIMAPConfig({ password: e.target.value.replace(/•/g, '') })}
                      className={cn(
                        'w-full h-9 px-3 pr-9 rounded-md font-mono text-xs text-white placeholder-slate-600 outline-none',
                        imapPasswordSet && !config.imap.password && 'ring-1 ring-emerald-500/30'
                      )}
                      style={INPUT_STYLE}
                    />
                    <button
                      type="button"
                      onClick={() => setShowImapPassword(!showImapPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-400"
                    >
                      {showImapPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex justify-end h-4 items-center">
                     {saveStatus === 'saving' && <span className="text-[10px] text-slate-500">Saving...</span>}
                     {saveStatus === 'saved' && <span className="text-[10px] text-emerald-500 transition-opacity duration-500">Saved</span>}
                     {saveStatus === 'error' && <span className="text-[10px] text-red-500">Save failed</span>}
                </div>

                <button
                  onClick={handleTestImap}
                  disabled={!config.imap.server || !config.imap.email}
                  className="w-full h-8 text-[11px] font-medium text-slate-400 hover:text-white rounded-md hover:bg-white/[0.05] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ border: '1px solid rgba(255,255,255,0.1)' }}
                >
                  Test Connection
                </button>
              </div>
            </ModuleCard>

            {/* Captcha Module */}
            <ModuleCard
              id="captcha"
              title="Captcha"
              icon={<Shield className="w-4 h-4" />}
              status="idle"
              summary=""
              isExpanded={expandedModule === 'captcha'}
              onToggle={toggleModule}
              disabled={isRunning}
            >
              <div className="space-y-3">
                <div className="text-xs text-slate-500 py-2">
                  Captcha solving service integration coming soon.
                </div>
              </div>
            </ModuleCard>
          </div>
        </div>

        {/* Launch Pad - Grid Layout */}
        <div className="p-4 border-t border-white/5" style={{ background: 'rgba(0,0,0,0.3)' }}>
          <div className="grid grid-cols-[80px_1fr] gap-3">
            {/* Count Input */}
            <input
              type="number"
              min={1}
              max={100}
              value={config.count}
              onChange={(e) => setCount(parseInt(e.target.value) || 1)}
              disabled={isRunning}
              className="h-11 rounded-lg text-center font-mono font-bold text-white outline-none focus:border-indigo-500/50"
              style={INPUT_STYLE}
            />
            
            {/* Start Button */}
            {!isRunning ? (
              <button
                onClick={handleStart}
                disabled={!canStart || pythonAvailable === false}
                className={cn(
                  'h-11 rounded-lg text-sm font-semibold flex items-center justify-center gap-2',
                  'transition-all duration-200',
                  canStart 
                    ? 'text-white hover:scale-[1.02] active:scale-[0.98]'
                    : 'text-slate-500 cursor-not-allowed'
                )}
                style={canStart ? { 
                  background: 'linear-gradient(135deg, #6366f1, #4f46e5)', 
                  boxShadow: '0 0 30px rgba(99, 102, 241, 0.4)' 
                } : {
                  background: 'rgba(255,255,255,0.03)'
                }}
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
          <div className="flex items-center justify-end gap-1.5 mt-2 text-[10px] text-slate-600">
            {canStart ? (
              <><div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px] shadow-emerald-500/50" /> Ready to start</>
            ) : (
              <><div className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Configure IMAP first</>
            )}
          </div>
        </div>
      </div>

      {/* Right Panel - Terminal */}
      <div className="flex-1 flex flex-col min-w-0" style={{ background: THEME.bg.deep }}>
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/5" style={{ background: 'rgba(0,0,0,0.3)' }}>
          <StatusBar success={successCount} failed={failedCount} active={activeThreads} />
          <button
            onClick={clearLogs}
            className="text-[11px] font-mono text-slate-600 hover:text-slate-400 transition-colors"
          >
            Clear
          </button>
        </div>
        <Terminal logs={logs} className="flex-1" />
      </div>
    </div>
  );
}
