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
  AlertCircle
} from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import Header from '../components/layout/Header';
import LogConsole from '../components/LogConsole';
import { useRegistrationStore } from '../stores/registration';
import { useAppStore } from '../stores/app';
import { t } from '../lib/i18n';
import type { RegistrationLog, ProviderName } from '../types';
import type { EmailStrategy } from '../stores/registration';

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

const EMAIL_STRATEGIES: { id: EmailStrategy; labelKey: string }[] = [
  { id: 'single', labelKey: 'autoReg.strategies.single' },
  { id: 'plus-alias', labelKey: 'autoReg.strategies.plusAlias' },
  { id: 'catch-all', labelKey: 'autoReg.strategies.catchAll' },
  { id: 'pool', labelKey: 'autoReg.strategies.pool' },
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
    setEmailStrategy,
    setIMAPConfig,
    setProxyConfig,
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
  const [showImapPassword, setShowImapPassword] = useState(false);
  const [showProxyPassword, setShowProxyPassword] = useState(false);

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
              {/* Email Strategy */}
              <div>
                <label className="input-label text-2xs">{t('autoReg.emailStrategy')}</label>
                <select
                  value={config.emailStrategy}
                  onChange={(e) => setEmailStrategy(e.target.value as EmailStrategy)}
                  disabled={isRunning}
                  className="input-ds h-9 text-xs disabled:opacity-50"
                >
                  {EMAIL_STRATEGIES.map((s) => (
                    <option key={s.id} value={s.id}>{t(s.labelKey)}</option>
                  ))}
                </select>
              </div>

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
                        placeholder={imapPasswordSet && !config.imap.password ? "••••••••" : "Password"}
                        value={config.imap.password}
                        onChange={(e) => setIMAPConfig({ password: e.target.value })}
                        disabled={isRunning}
                        className={`input-ds h-8 text-xs pr-8 disabled:opacity-50 ${
                          imapPasswordSet && !config.imap.password ? 'placeholder:text-emerald-400/70' : ''
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowImapPassword(!showImapPassword)}
                        className="absolute inset-y-0 right-0 flex items-center pr-2 text-slate-500 hover:text-white"
                      >
                        {showImapPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
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
                  <button 
                    onClick={start} 
                    className="w-full btn-primary py-2.5 text-sm font-semibold flex items-center justify-center gap-2"
                  >
                    <Play className="w-4 h-4" />
                    {t('autoReg.startRegistration')}
                  </button>
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
