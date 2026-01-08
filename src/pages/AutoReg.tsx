import { useEffect, useCallback, useState } from 'react';
import { 
  Download, 
  CheckCircle, 
  XCircle, 
  Copy, 
  RefreshCw,
  Play,
  Square,
  ChevronDown,
  ChevronRight,
  Server,
  Globe,
  Eye,
  EyeOff,
  Clock,
  Loader2,
  Check,
  AlertCircle,
  Smartphone,
  Bot,
  Monitor,
  Sparkles
} from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import Header from '../components/layout/Header';
import LogConsole from '../components/LogConsole';
import DeviceFlowAuth from '../components/DeviceFlowAuth';
import { useRegistrationStore } from '../stores/registration';
import { useAppStore } from '../stores/app';
import { t } from '../lib/i18n';
import { startPythonAutoreg, checkPythonAutoreg, testImapConnection, addAccount, startWindsurfAutoreg } from '../lib/tauri';
import type { RegistrationLog, ProviderName } from '../types';

type AuthMethod = 'auto' | 'device_flow' | 'manual';

interface RegistrationLogEvent {
  level: string;
  message: string;
}

interface AccountAddedEvent {
  id: number;
  email: string;
  provider: string;
}

interface RegistrationCompleteEvent {
  success: boolean;
}

interface RegistrationErrorEvent {
  error: string;
}

// Provider configuration with colors
const PROVIDERS: { id: ProviderName; name: string; color: string; disabled?: boolean }[] = [
  { id: 'kiro', name: 'Kiro', color: '#3B82F6' },
  { id: 'windsurf', name: 'Windsurf', color: '#10B981' },
  { id: 'trae', name: 'Trae', color: '#8B5CF6', disabled: true },
];

export default function AutoReg() {
  const { addNotification, language } = useAppStore();
  const {
    config,
    isRunning,
    progress,
    results,
    history,
    successCount,
    failedCount,
    settingsLoaded,
    saveStatus,
    imapPasswordSet,
    addLog,
    addResult,
    setProgress,
    setWsConnected,
    setProvider,
    setIMAPConfig,
    setProxyConfig,
    setPatternConfig,
    setCount,
    loadSettings,
    addHistoryEntry,
    updateHistoryEntry,
    start,
    stop,
  } = useRegistrationStore();

  // Force re-render when language changes
  void language; // Force re-render on language change

  // Collapsible sections state
  const [imapExpanded, setImapExpanded] = useState(false);
  const [proxyExpanded, setProxyExpanded] = useState(false);
  const [patternsExpanded, setPatternsExpanded] = useState(false);
  const [showImapPassword, setShowImapPassword] = useState(false);
  const [showProxyPassword, setShowProxyPassword] = useState(false);
  const [authMethod, setAuthMethod] = useState<AuthMethod>('auto');
  const [pythonAvailable, setPythonAvailable] = useState<boolean | null>(null);
  const [showDeviceFlow, setShowDeviceFlow] = useState(false);

  // Check Python availability on mount
  useEffect(() => {
    checkPythonAutoreg().then(setPythonAvailable).catch(() => setPythonAvailable(false));
  }, []);

  // Handle device flow success
  const handleDeviceFlowSuccess = useCallback(() => {
    addLog({ level: 'success', message: 'Device Flow authentication successful!' });
    addNotification({ type: 'success', title: 'Authentication Complete', message: 'Account has been added via Device Flow' });
    setShowDeviceFlow(false);
  }, [addLog, addNotification]);

  // Handle Python automation start
  const handleStartPythonAutoreg = useCallback(async () => {
    // Check if password exists either in current config OR in database (imapPasswordSet)
    const hasImapPassword = !!config.imap.password || imapPasswordSet;
    if (!config.imap.server || !config.imap.email || !hasImapPassword) {
      addNotification({ type: 'error', title: 'IMAP Required', message: 'Please configure IMAP settings for auto-registration' });
      setImapExpanded(true);
      return;
    }

    addLog({ level: 'info', message: 'Starting Python browser automation...' });
    
    try {
      const result = await startPythonAutoreg({
        auto_generate: true,
        headless: false,
        device_flow: false,
        imap_server: config.imap.server,
        imap_port: config.imap.port || 993,
        imap_user: config.imap.email,
        imap_password: config.imap.password || '********',  // Backend will fetch from DB if masked
        email_strategy: 'catch_all',  // Use catch_all for auto-generated emails
        proxy_url: config.proxy.enabled ? config.proxy.url : undefined,
      });

      // Log the result details for debugging
      addLog({ level: 'debug', message: `Result: success=${result.success}, email=${result.email}, password=${result.password ? 'SET' : 'MISSING'}, token=${result.token_file || 'N/A'}` });
      
      // Save account if we have email and password, regardless of OAuth token success
      // The account is registered in AWS even if OAuth callback failed
      if (result.email && result.password) {
        try {
          await addAccount({
            provider: config.provider,
            email: result.email,
            password: result.password,
          });
          addLog({ level: 'success', message: `Account saved to database: ${result.email}` });
          
          // Add to history
          addHistoryEntry({
            provider: config.provider,
            email: result.email,
            status: 'completed',
          });
          
          // Trigger accounts refresh
          window.dispatchEvent(new CustomEvent('refresh-accounts'));
          
          // Show success notification
          if (result.success) {
            addNotification({ type: 'success', title: 'Registration Complete', message: `Account ${result.email} created with token` });
          } else {
            // Account created but OAuth token not obtained - still a partial success
            addNotification({ type: 'warning', title: 'Account Created', message: `Account ${result.email} registered but token not obtained. You can login manually.` });
          }
        } catch (saveError) {
          const saveMsg = saveError instanceof Error ? saveError.message : String(saveError);
          addLog({ level: 'warn', message: `Account registered but failed to save: ${saveMsg}` });
          addNotification({ type: 'error', title: 'Save Failed', message: saveMsg });
        }
      } else if (result.success) {
        // Success but missing email/password (shouldn't happen)
        addLog({ level: 'warn', message: `Registration succeeded but missing credentials: email=${result.email || 'missing'}, password=${result.password ? 'set' : 'missing'}` });
        addNotification({ type: 'warning', title: 'Partial Success', message: 'Registration completed but credentials not captured' });
      } else {
        // Complete failure - no account created
        addLog({ level: 'error', message: `Registration failed: ${result.error}` });
        addNotification({ type: 'error', title: 'Registration Failed', message: result.error || 'Unknown error' });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      addLog({ level: 'error', message: `Python automation error: ${msg}` });
      addNotification({ type: 'error', title: 'Automation Error', message: msg });
    }
  }, [config, addLog, addNotification]);

  // Handle Windsurf registration
  const handleStartWindsurfAutoreg = useCallback(async () => {
    // Windsurf needs IMAP for verification code
    const hasImapPassword = !!config.imap.password || imapPasswordSet;
    if (!config.imap.server || !config.imap.email || !hasImapPassword) {
      addNotification({ type: 'error', title: 'IMAP Required', message: 'Windsurf registration requires IMAP for verification code' });
      setImapExpanded(true);
      return;
    }
    
    // Generate email based on pattern
    const emailDomain = config.imap.email?.split('@')[1] || 'example.com';
    let randomEmail: string;
    const timestamp = Date.now();
    
    switch (config.patterns.emailPattern) {
      case 'random':
        randomEmail = `${Math.random().toString(36).substring(2, 10)}@${emailDomain}`;
        break;
      case 'name_random':
        randomEmail = `${config.patterns.nameCustomFirst?.toLowerCase() || 'user'}_${Math.random().toString(36).substring(2, 6)}@${emailDomain}`;
        break;
      case 'name_counter':
        randomEmail = `${config.patterns.nameCustomFirst?.toLowerCase() || 'user'}_${String(timestamp).slice(-3)}@${emailDomain}`;
        break;
      case 'custom_prefix':
        randomEmail = `${config.patterns.emailCustomPrefix || 'user'}_${timestamp}@${emailDomain}`;
        break;
      case 'provider_timestamp':
      default:
        randomEmail = `windsurf_${timestamp}@${emailDomain}`;
        break;
    }
    
    addLog({ level: 'info', message: 'Starting Windsurf registration...' });
    
    try {
      const result = await startWindsurfAutoreg({
        email: randomEmail,
        headless: false,
        login_only: false,
        proxy_url: config.proxy.enabled ? config.proxy.url : undefined,
        imap_server: config.imap.server,
        imap_port: config.imap.port || 993,
        imap_user: config.imap.email,
        imap_password: config.imap.password || '********',
        email_pattern: config.patterns.emailPattern,
        name_pattern: config.patterns.namePattern,
        name_custom_first: config.patterns.nameCustomFirst,
        name_custom_last: config.patterns.nameCustomLast,
      });

      addLog({ level: 'debug', message: `Windsurf result: success=${result.success}, email=${result.email}, password=${result.password ? 'SET' : 'MISSING'}` });
      
      if (result.success && result.email && result.password) {
        try {
          await addAccount({
            provider: 'windsurf',
            email: result.email,
            password: result.password,
          });
          addLog({ level: 'success', message: `Windsurf account saved: ${result.email}` });
          
          addHistoryEntry({
            provider: 'windsurf',
            email: result.email,
            status: 'completed',
          });
          
          window.dispatchEvent(new CustomEvent('refresh-accounts'));
          addNotification({ type: 'success', title: 'Windsurf Registration Complete', message: `Account ${result.email} created` });
        } catch (saveError) {
          const saveMsg = saveError instanceof Error ? saveError.message : String(saveError);
          addLog({ level: 'warn', message: `Windsurf account created but failed to save: ${saveMsg}` });
          addNotification({ type: 'error', title: 'Save Failed', message: saveMsg });
        }
      } else if (result.email && result.password) {
        // Account created but token failed - still save it
        try {
          await addAccount({
            provider: 'windsurf',
            email: result.email,
            password: result.password,
          });
          addLog({ level: 'warn', message: `Windsurf account saved without token: ${result.email}` });
          addHistoryEntry({ provider: 'windsurf', email: result.email, status: 'completed' });
          window.dispatchEvent(new CustomEvent('refresh-accounts'));
          addNotification({ type: 'warning', title: 'Partial Success', message: `Account created but token not obtained: ${result.error}` });
        } catch (saveError) {
          addLog({ level: 'error', message: `Failed to save: ${saveError}` });
        }
      } else {
        addLog({ level: 'error', message: `Windsurf registration failed: ${result.error}` });
        addNotification({ type: 'error', title: 'Windsurf Registration Failed', message: result.error || 'Unknown error' });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      addLog({ level: 'error', message: `Windsurf automation error: ${msg}` });
      addNotification({ type: 'error', title: 'Automation Error', message: msg });
    }
  }, [config, addLog, addNotification, addHistoryEntry, imapPasswordSet]);

  // Test IMAP connection
  const handleTestImap = useCallback(async () => {
    const hasImapPassword = !!config.imap.password || imapPasswordSet;
    if (!config.imap.server || !config.imap.email || !hasImapPassword) {
      addNotification({ type: 'error', title: 'IMAP Required', message: 'Please fill all IMAP fields' });
      return;
    }
    
    addLog({ level: 'info', message: 'Testing IMAP connection...' });
    
    try {
      const result = await testImapConnection({
        imap_server: config.imap.server,
        imap_user: config.imap.email,
        imap_password: config.imap.password || '********',  // Backend will fetch from DB if masked
      });
      addLog({ level: 'info', message: result });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      addLog({ level: 'error', message: `Test failed: ${msg}` });
    }
  }, [config, addLog, addNotification]);

  // Load settings on mount
  useEffect(() => {
    if (!settingsLoaded) loadSettings();
  }, [settingsLoaded, loadSettings]);

  useEffect(() => {
    setWsConnected(true);
    addLog({ level: 'info', message: 'Connected to Tauri backend' });

    const unlistenLog = listen<RegistrationLogEvent>('REGISTRATION_LOG', (event) => {
      const { level, message } = event.payload;
      addLog({ level: level as RegistrationLog['level'], message });
      
      if (message.startsWith('PROGRESS:')) {
        try {
          const progressData = JSON.parse(message.substring(9));
          if (progressData.step && progressData.totalSteps) {
            setProgress({
              current: progressData.step,
              total: progressData.totalSteps,
              percentage: Math.round((progressData.step / progressData.totalSteps) * 100),
              currentStep: progressData.detail || `Step ${progressData.step}`,
            });
          }
        } catch { /* ignore */ }
      }
    });

    const unlistenAccount = listen<AccountAddedEvent>('ACCOUNT_ADDED', (event) => {
      const { email, provider } = event.payload;
      addResult({ email, status: 'success', token: 'saved' });
      addLog({ level: 'success', message: `Account created and saved: ${email}` });
      addHistoryEntry({ 
        provider: provider as ProviderName, 
        email, 
        status: 'completed' 
      });
    });

    const unlistenComplete = listen<RegistrationCompleteEvent>('REGISTRATION_COMPLETE', (event) => {
      if (event.payload.success) {
        addLog({ level: 'info', message: 'Registration completed successfully' });
        addNotification({ type: 'success', title: t('notifications.registrationComplete'), message: t('notifications.accountRegistrationFinished') });
      }
    });

    const unlistenError = listen<RegistrationErrorEvent>('REGISTRATION_ERROR', (event) => {
      const { error } = event.payload;
      addLog({ level: 'error', message: `Registration failed: ${error}` });
      addNotification({ type: 'error', title: t('notifications.registrationFailed'), message: error });
    });

    return () => {
      unlistenLog.then(fn => fn());
      unlistenAccount.then(fn => fn());
      unlistenComplete.then(fn => fn());
      unlistenError.then(fn => fn());
      setWsConnected(false);
    };
  }, [addLog, addResult, setProgress, setWsConnected, addNotification, addHistoryEntry, updateHistoryEntry]);

  const handleCopyResults = useCallback(() => {
    const text = results
      .map((r) => `${r.email}: ${r.status}${r.token ? ` (${r.token})` : ''}${r.error ? ` - ${r.error}` : ''}`)
      .join('\n');
    navigator.clipboard.writeText(text);
    addNotification({ type: 'success', title: t('notifications.copied'), message: t('notifications.resultsCopiedToClipboard') });
  }, [results, addNotification]);

  const handleExportResults = useCallback(() => {
    const data = JSON.stringify(results, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `registration-results-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [results]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <span className="px-2 py-0.5 rounded-full text-2xs bg-slate-500/20 text-slate-400">Pending</span>;
      case 'running':
        return <span className="px-2 py-0.5 rounded-full text-2xs bg-blue-500/20 text-blue-400 flex items-center gap-1"><Loader2 className="w-2.5 h-2.5 animate-spin" />Running</span>;
      case 'completed':
        return <span className="px-2 py-0.5 rounded-full text-2xs bg-emerald-500/20 text-emerald-400">Completed</span>;
      case 'failed':
        return <span className="px-2 py-0.5 rounded-full text-2xs bg-red-500/20 text-red-400">Failed</span>;
      default:
        return null;
    }
  };

  const getProviderBadge = (provider: ProviderName) => {
    const p = PROVIDERS.find(pr => pr.id === provider);
    if (!p) return null;
    return (
      <span 
        className="px-2 py-0.5 rounded-full text-2xs font-medium"
        style={{ backgroundColor: `${p.color}20`, color: p.color }}
      >
        {p.name}
      </span>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title={t('autoReg.title')}
        subtitle={t('autoReg.subtitle')}
        icon={<RefreshCw size={18} />}
      />

      <div className="flex-1 flex gap-4 p-4 min-h-0 overflow-hidden">
        {/* Left Panel - Settings (35%) */}
        <div className="w-[35%] flex flex-col gap-3 overflow-hidden">
          {/* Provider Selection Cards */}
          <div className="card p-3 shrink-0 animate-fade-in" style={{ animationDelay: '0ms' }}>
            <label className="text-2xs text-slate-500 uppercase tracking-wider mb-2 block">{t('autoReg.selectProvider')}</label>
            <div className="flex gap-2">
              {PROVIDERS.map((provider) => (
                <button
                  key={provider.id}
                  onClick={() => !provider.disabled && setProvider(provider.id)}
                  disabled={isRunning || provider.disabled}
                  className={`flex-1 relative py-3 px-3 rounded-lg border-2 transition-all duration-200 ${
                    provider.disabled 
                      ? 'opacity-40 cursor-not-allowed border-white/5 bg-white/[0.02]'
                      : config.provider === provider.id
                        ? 'border-opacity-60 bg-opacity-10'
                        : 'border-white/10 bg-white/[0.02] hover:border-white/20'
                  } ${isRunning ? 'opacity-50' : ''}`}
                  style={{
                    borderColor: config.provider === provider.id && !provider.disabled ? provider.color : undefined,
                    backgroundColor: config.provider === provider.id && !provider.disabled ? `${provider.color}10` : undefined,
                  }}
                >
                  <div 
                    className="w-2 h-2 rounded-full mx-auto mb-1.5"
                    style={{ backgroundColor: provider.color }}
                  />
                  <span className="text-xs font-medium text-white block">{provider.name}</span>
                  {provider.disabled && (
                    <span className="absolute -top-1 -right-1 px-1.5 py-0.5 rounded text-[9px] bg-purple-500/20 text-purple-400 font-medium">
                      {t('autoReg.comingSoon')}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Auth Method Selection - Only for Kiro */}
          {config.provider === 'kiro' && (
          <div className="card p-3 shrink-0 animate-fade-in" style={{ animationDelay: '25ms' }}>
            <label className="text-2xs text-slate-500 uppercase tracking-wider mb-2 block">Auth Method</label>
            <div className="flex gap-2">
              {/* Full Auto */}
              <button
                onClick={() => setAuthMethod('auto')}
                disabled={isRunning}
                className={`flex-1 py-2.5 px-2 rounded-lg border-2 transition-all duration-200 ${
                  authMethod === 'auto'
                    ? 'border-emerald-500/60 bg-emerald-500/10'
                    : 'border-white/10 bg-white/[0.02] hover:border-white/20'
                } ${isRunning ? 'opacity-50' : ''}`}
              >
                <Bot className={`w-4 h-4 mx-auto mb-1 ${authMethod === 'auto' ? 'text-emerald-400' : 'text-slate-500'}`} />
                <span className="text-2xs font-medium text-white block">Full Auto</span>
                {pythonAvailable === false && (
                  <span className="text-[9px] text-amber-400 block mt-0.5">Python required</span>
                )}
              </button>
              
              {/* Device Flow */}
              <button
                onClick={() => setAuthMethod('device_flow')}
                disabled={isRunning}
                className={`flex-1 py-2.5 px-2 rounded-lg border-2 transition-all duration-200 ${
                  authMethod === 'device_flow'
                    ? 'border-blue-500/60 bg-blue-500/10'
                    : 'border-white/10 bg-white/[0.02] hover:border-white/20'
                } ${isRunning ? 'opacity-50' : ''}`}
              >
                <Smartphone className={`w-4 h-4 mx-auto mb-1 ${authMethod === 'device_flow' ? 'text-blue-400' : 'text-slate-500'}`} />
                <span className="text-2xs font-medium text-white block">Device Flow</span>
              </button>
              
              {/* Manual */}
              <button
                onClick={() => setAuthMethod('manual')}
                disabled={isRunning}
                className={`flex-1 py-2.5 px-2 rounded-lg border-2 transition-all duration-200 ${
                  authMethod === 'manual'
                    ? 'border-purple-500/60 bg-purple-500/10'
                    : 'border-white/10 bg-white/[0.02] hover:border-white/20'
                } ${isRunning ? 'opacity-50' : ''}`}
              >
                <Monitor className={`w-4 h-4 mx-auto mb-1 ${authMethod === 'manual' ? 'text-purple-400' : 'text-slate-500'}`} />
                <span className="text-2xs font-medium text-white block">Manual</span>
              </button>
            </div>
            <p className="text-[10px] text-slate-500 mt-2">
              {authMethod === 'auto' && 'Browser automation with DrissionPage - fills forms, gets verification code from IMAP'}
              {authMethod === 'device_flow' && 'OAuth Device Flow - enter code in browser, no automation needed'}
              {authMethod === 'manual' && 'Opens browser for manual registration'}
            </p>
          </div>
          )}

          {/* Registration Settings */}
          <div className="card p-3 flex-1 overflow-y-auto no-scrollbar animate-fade-in" style={{ animationDelay: '50ms' }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-white">{t('autoReg.config')}</h3>
              <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs transition-all ${
                saveStatus === 'saving' ? 'bg-amber-500/20 text-amber-400' 
                : saveStatus === 'saved' ? 'bg-emerald-500/20 text-emerald-400' 
                : saveStatus === 'error' ? 'bg-red-500/20 text-red-400' : 'opacity-0'
              }`}>
                {saveStatus === 'saving' && <><Loader2 className="w-2.5 h-2.5 animate-spin" /><span>{t('autoReg.saving')}</span></>}
                {saveStatus === 'saved' && <><Check className="w-2.5 h-2.5" /><span>{t('autoReg.saved')}</span></>}
                {saveStatus === 'error' && <><AlertCircle className="w-2.5 h-2.5" /><span>{t('autoReg.error')}</span></>}
              </div>
            </div>

            <div className="space-y-3">
              {/* IMAP Settings - Collapsible */}
              <div className="border border-white/10 rounded-lg overflow-hidden bg-white/[0.02]">
                <button
                  onClick={() => setImapExpanded(!imapExpanded)}
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors"
                >
                  <span className="text-xs text-white flex items-center gap-2">
                    <Server className="w-3.5 h-3.5 text-primary" />
                    {t('autoReg.imapSettings')}
                  </span>
                  {imapExpanded ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                </button>
                {imapExpanded && (
                  <div className="px-3 pb-3 space-y-2 border-t border-white/5">
                    <div className="grid grid-cols-4 gap-2 pt-2">
                      <input
                        type="text"
                        placeholder="imap.example.com"
                        value={config.imap.server}
                        onChange={(e) => setIMAPConfig({ server: e.target.value })}
                        disabled={isRunning}
                        className="col-span-3 input-ds h-8 text-xs disabled:opacity-50"
                      />
                      <input
                        type="number"
                        placeholder="993"
                        value={config.imap.port}
                        onChange={(e) => setIMAPConfig({ port: parseInt(e.target.value) || 993 })}
                        disabled={isRunning}
                        className="input-ds h-8 text-xs disabled:opacity-50"
                      />
                    </div>
                    <input
                      type="email"
                      placeholder="user@example.com"
                      value={config.imap.email}
                      onChange={(e) => setIMAPConfig({ email: e.target.value })}
                      disabled={isRunning}
                      className="input-ds h-8 text-xs disabled:opacity-50"
                    />
                    <div className="relative">
                      <input
                        type={showImapPassword ? 'text' : 'password'}
                        placeholder="Password"
                        value={config.imap.password || (imapPasswordSet ? '••••••••' : '')}
                        onChange={(e) => {
                          // If user starts typing over the placeholder dots, clear them first
                          const newValue = e.target.value.replace(/•/g, '');
                          setIMAPConfig({ password: newValue });
                        }}
                        onFocus={(e) => {
                          // Clear placeholder dots on focus if no real password
                          if (imapPasswordSet && !config.imap.password) {
                            e.target.value = '';
                          }
                        }}
                        disabled={isRunning}
                        className={`input-ds h-8 text-xs pr-16 disabled:opacity-50 ${
                          imapPasswordSet && !config.imap.password ? 'text-emerald-400/70 border-emerald-500/30' : ''
                        }`}
                      />
                      <div className="absolute inset-y-0 right-0 flex items-center gap-1 pr-2">
                        {imapPasswordSet && !config.imap.password && (
                          <span className="text-[9px] text-emerald-400 bg-emerald-500/20 px-1 rounded">saved</span>
                        )}
                        <button
                          type="button"
                          onClick={() => setShowImapPassword(!showImapPassword)}
                          className="text-slate-500 hover:text-white"
                        >
                          {showImapPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleTestImap}
                      disabled={isRunning}
                      className="w-full mt-2 py-1.5 text-2xs bg-slate-700 hover:bg-slate-600 text-white rounded transition-colors disabled:opacity-50"
                    >
                      Test IMAP Connection
                    </button>
                  </div>
                )}
              </div>

              {/* Proxy Settings - Collapsible */}
              <div className="border border-white/10 rounded-lg overflow-hidden bg-white/[0.02]">
                <button
                  onClick={() => setProxyExpanded(!proxyExpanded)}
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors"
                >
                  <span className="text-xs text-white flex items-center gap-2">
                    <Globe className="w-3.5 h-3.5 text-accent" />
                    {t('autoReg.proxySettings')}
                    {config.proxy.enabled && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    )}
                  </span>
                  {proxyExpanded ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                </button>
                {proxyExpanded && (
                  <div className="px-3 pb-3 space-y-2 border-t border-white/5">
                    <label className="flex items-center justify-between pt-2 cursor-pointer">
                      <span className="text-2xs text-slate-400">Enable Proxy</span>
                      <input
                        type="checkbox"
                        checked={config.proxy.enabled}
                        onChange={(e) => setProxyConfig({ enabled: e.target.checked })}
                        disabled={isRunning}
                        className="w-4 h-4 accent-primary rounded"
                      />
                    </label>
                    {config.proxy.enabled && (
                      <>
                        <input
                          type="text"
                          placeholder="http://proxy:8080"
                          value={config.proxy.url}
                          onChange={(e) => setProxyConfig({ url: e.target.value })}
                          disabled={isRunning}
                          className="input-ds h-8 text-xs disabled:opacity-50"
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="text"
                            placeholder="Username"
                            value={config.proxy.username || ''}
                            onChange={(e) => setProxyConfig({ username: e.target.value })}
                            disabled={isRunning}
                            className="input-ds h-8 text-xs disabled:opacity-50"
                          />
                          <div className="relative">
                            <input
                              type={showProxyPassword ? 'text' : 'password'}
                              placeholder="Password"
                              value={config.proxy.password || ''}
                              onChange={(e) => setProxyConfig({ password: e.target.value })}
                              disabled={isRunning}
                              className="input-ds h-8 text-xs pr-8 disabled:opacity-50"
                            />
                            <button
                              type="button"
                              onClick={() => setShowProxyPassword(!showProxyPassword)}
                              className="absolute inset-y-0 right-0 flex items-center pr-2 text-slate-500 hover:text-white"
                            >
                              {showProxyPassword ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Pattern Settings - Collapsible */}
              <div className="border border-white/10 rounded-lg overflow-hidden bg-white/[0.02]">
                <button
                  onClick={() => setPatternsExpanded(!patternsExpanded)}
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors"
                >
                  <span className="text-xs text-white flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    Pattern Settings
                  </span>
                  {patternsExpanded ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                </button>
                {patternsExpanded && (
                  <div className="px-3 pb-3 space-y-3 border-t border-white/5 pt-2">
                    {/* Email Pattern */}
                    <div>
                      <label className="text-2xs text-slate-400 block mb-1">Email Pattern</label>
                      <select
                        value={config.patterns.emailPattern}
                        onChange={(e) => setPatternConfig({ emailPattern: e.target.value as 'random' | 'name_random' | 'provider_timestamp' | 'custom_prefix' | 'name_counter' })}
                        disabled={isRunning}
                        className="input-ds h-8 text-xs disabled:opacity-50 w-full"
                      >
                        <option value="provider_timestamp">provider_timestamp (windsurf_1234567890)</option>
                        <option value="random">random (xK7mP2qL)</option>
                        <option value="name_random">name_random (john_xK7m)</option>
                        <option value="name_counter">name_counter (john_001)</option>
                        <option value="custom_prefix">custom_prefix (myprefix_1234)</option>
                      </select>
                      {config.patterns.emailPattern === 'custom_prefix' && (
                        <input
                          type="text"
                          placeholder="Custom prefix"
                          value={config.patterns.emailCustomPrefix}
                          onChange={(e) => setPatternConfig({ emailCustomPrefix: e.target.value })}
                          disabled={isRunning}
                          className="input-ds h-8 text-xs disabled:opacity-50 w-full mt-1"
                        />
                      )}
                    </div>

                    {/* Name Pattern */}
                    <div>
                      <label className="text-2xs text-slate-400 block mb-1">Name Pattern</label>
                      <select
                        value={config.patterns.namePattern}
                        onChange={(e) => setPatternConfig({ namePattern: e.target.value as 'random' | 'from_email' | 'custom' })}
                        disabled={isRunning}
                        className="input-ds h-8 text-xs disabled:opacity-50 w-full"
                      >
                        <option value="random">Random English (John Smith)</option>
                        <option value="from_email">From Email (windsurf → Windsurf)</option>
                        <option value="custom">Custom Name</option>
                      </select>
                      {config.patterns.namePattern === 'custom' && (
                        <div className="grid grid-cols-2 gap-2 mt-1">
                          <input
                            type="text"
                            placeholder="First name"
                            value={config.patterns.nameCustomFirst}
                            onChange={(e) => setPatternConfig({ nameCustomFirst: e.target.value })}
                            disabled={isRunning}
                            className="input-ds h-8 text-xs disabled:opacity-50"
                          />
                          <input
                            type="text"
                            placeholder="Last name"
                            value={config.patterns.nameCustomLast}
                            onChange={(e) => setPatternConfig({ nameCustomLast: e.target.value })}
                            disabled={isRunning}
                            className="input-ds h-8 text-xs disabled:opacity-50"
                          />
                        </div>
                      )}
                    </div>

                    {/* Preview */}
                    <div className="bg-slate-800/50 rounded p-2">
                      <span className="text-2xs text-slate-500 block mb-1">Preview:</span>
                      <div className="text-xs text-emerald-400 font-mono">
                        {config.patterns.emailPattern === 'provider_timestamp' && `${config.provider}_${Date.now()}@domain.com`}
                        {config.patterns.emailPattern === 'random' && 'xK7mP2qL@domain.com'}
                        {config.patterns.emailPattern === 'name_random' && 'john_xK7m@domain.com'}
                        {config.patterns.emailPattern === 'name_counter' && 'john_001@domain.com'}
                        {config.patterns.emailPattern === 'custom_prefix' && `${config.patterns.emailCustomPrefix || 'prefix'}_${Date.now()}@domain.com`}
                      </div>
                      <div className="text-xs text-blue-400 font-mono mt-1">
                        {config.patterns.namePattern === 'random' && 'John Smith'}
                        {config.patterns.namePattern === 'from_email' && 'Windsurf User'}
                        {config.patterns.namePattern === 'custom' && `${config.patterns.nameCustomFirst || 'First'} ${config.patterns.nameCustomLast || 'Last'}`}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Count */}
              <div>
                <label className="input-label text-2xs">{t('autoReg.count')}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={config.count}
                    onChange={(e) => setCount(parseInt(e.target.value) || 1)}
                    disabled={isRunning}
                    className="input-ds h-9 text-xs disabled:opacity-50 w-full"
                  />
                </div>
              </div>

              {/* Start/Stop Button */}
              <div className="pt-2">
                {!isRunning ? (
                  authMethod === 'device_flow' ? (
                    <button 
                      onClick={() => setShowDeviceFlow(true)} 
                      className="w-full btn-primary py-2.5 text-sm font-semibold flex items-center justify-center gap-2"
                    >
                      <Smartphone className="w-4 h-4" />
                      Start Device Flow
                    </button>
                  ) : authMethod === 'auto' ? (
                    <button 
                      onClick={config.provider === 'windsurf' ? handleStartWindsurfAutoreg : handleStartPythonAutoreg}
                      disabled={pythonAvailable === false}
                      className="w-full btn-primary py-2.5 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <Bot className="w-4 h-4" />
                      {pythonAvailable === false ? 'Python Not Available' : `Start ${config.provider === 'windsurf' ? 'Windsurf' : 'Kiro'} Registration`}
                    </button>
                  ) : (
                    <button 
                      onClick={start} 
                      className="w-full btn-primary py-2.5 text-sm font-semibold flex items-center justify-center gap-2"
                    >
                      <Play className="w-4 h-4" />
                      {t('autoReg.startRegistration')}
                    </button>
                  )
                ) : (
                  <button 
                    onClick={stop} 
                    className="w-full py-2.5 text-sm font-semibold bg-red-500 hover:bg-red-600 text-white rounded-lg flex items-center justify-center gap-2 transition-colors"
                  >
                    <Square className="w-4 h-4" />
                    {t('autoReg.stopRegistration')}
                  </button>
                )}
              </div>

              {/* Device Flow Modal */}
              {showDeviceFlow && (
                <DeviceFlowAuth 
                  onSuccess={handleDeviceFlowSuccess}
                  onCancel={() => setShowDeviceFlow(false)}
                />
              )}
            </div>
          </div>

          {/* Registration History */}
          <div className="card p-3 shrink-0 max-h-[200px] overflow-hidden flex flex-col animate-fade-in" style={{ animationDelay: '100ms' }}>
            <h3 className="text-xs font-semibold text-white mb-2 flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              {t('autoReg.registrationHistory')}
            </h3>
            {history.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-slate-600 text-2xs">
                {t('autoReg.noHistory')}
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto no-scrollbar">
                <table className="w-full text-2xs">
                  <thead className="sticky top-0 bg-slate-900/95">
                    <tr className="text-slate-500 text-left">
                      <th className="pb-1.5 font-medium">{t('autoReg.provider')}</th>
                      <th className="pb-1.5 font-medium">{t('accounts.email')}</th>
                      <th className="pb-1.5 font-medium">{t('common.status')}</th>
                      <th className="pb-1.5 font-medium text-right">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {history.slice(0, 10).map((entry) => (
                      <tr key={entry.id} className="text-slate-300">
                        <td className="py-1.5">{getProviderBadge(entry.provider)}</td>
                        <td className="py-1.5 font-mono truncate max-w-[120px]">{entry.email}</td>
                        <td className="py-1.5">{getStatusBadge(entry.status)}</td>
                        <td className="py-1.5 text-right text-slate-500">
                          {new Date(entry.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - Terminal & Progress (65%) */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Progress Section */}
          {isRunning && (
            <div className="card p-3 mb-3 shrink-0 animate-fade-in">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-white font-medium flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                  {t('autoReg.progress')}
                </span>
                <span className="text-2xs text-slate-400">
                  {t('autoReg.step')} {progress.current}/{progress.total || config.count}
                </span>
              </div>
              <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-300 rounded-full"
                  style={{ width: `${progress.percentage || 0}%` }}
                />
              </div>
              {progress.currentStep && (
                <p className="text-2xs text-slate-500 mt-1.5 truncate">{progress.currentStep}</p>
              )}
            </div>
          )}

          {/* Log Console - Full remaining height */}
          <LogConsole className="flex-1" />

          {/* Compact Results Summary */}
          <div className="card p-3 mt-3 shrink-0">
            <div className="flex items-center justify-between gap-3">
              {/* Inline Stats */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 bg-white/5 rounded px-2 py-1">
                  <span className="text-xs text-slate-500">{t('autoReg.results.total')}</span>
                  <span className="text-sm font-bold text-white tabular-nums">{results.length}</span>
                </div>
                <div className="flex items-center gap-1.5 bg-emerald-500/10 rounded px-2 py-1">
                  <CheckCircle className="w-3 h-3 text-emerald-400" />
                  <span className="text-sm font-bold text-emerald-400 tabular-nums">{successCount}</span>
                </div>
                <div className="flex items-center gap-1.5 bg-red-500/10 rounded px-2 py-1">
                  <XCircle className="w-3 h-3 text-red-400" />
                  <span className="text-sm font-bold text-red-400 tabular-nums">{failedCount}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1">
                <button
                  onClick={handleCopyResults}
                  disabled={results.length === 0}
                  className="btn-icon disabled:opacity-50"
                  title={t('autoReg.copyResults')}
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={handleExportResults}
                  disabled={results.length === 0}
                  className="btn-icon disabled:opacity-50"
                  title={t('autoReg.exportResults')}
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Compact Results List - Only show if there are results */}
            {results.length > 0 && (
              <div className="mt-2 max-h-24 overflow-y-auto space-y-1 no-scrollbar">
                {results.map((result, index) => (
                  <div
                    key={index}
                    className={`flex items-center justify-between px-2 py-1 rounded text-xs ${
                      result.status === 'success'
                        ? 'bg-emerald-500/10'
                        : 'bg-red-500/10'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      {result.status === 'success' ? (
                        <CheckCircle className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <XCircle className="w-3 h-3 text-red-400" />
                      )}
                      <span className="text-white font-mono text-2xs">{result.email}</span>
                    </div>
                    {result.error && (
                      <span className="text-2xs text-red-400 truncate max-w-[100px]">
                        {result.error}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
