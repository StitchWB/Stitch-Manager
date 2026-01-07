import { useEffect, useCallback } from 'react';
import { Download, CheckCircle, XCircle, Copy, RefreshCw } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import Header from '../components/layout/Header';
import RegistrationConfig from '../components/RegistrationConfig';
import LogConsole from '../components/LogConsole';
import { useRegistrationStore } from '../stores/registration';
import { useAppStore } from '../stores/app';
import { t } from '../lib/i18n';
import type { RegistrationLog } from '../types';

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

export default function AutoReg() {
  const { addNotification, language } = useAppStore();
  const {
    results,
    successCount,
    failedCount,
    addLog,
    addResult,
    setProgress,
    setWsConnected,
  } = useRegistrationStore();

  // Force re-render when language changes
  const _ = language;

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
      const { email } = event.payload;
      addResult({ email, status: 'success', token: 'saved' });
      addLog({ level: 'success', message: `Account created and saved: ${email}` });
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
  }, [addLog, addResult, setProgress, setWsConnected, addNotification]);

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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title={t('autoReg.title')}
        subtitle={t('autoReg.subtitle')}
        icon={<RefreshCw size={18} />}
      />

      <div className="flex-1 flex gap-4 p-4 min-h-0 overflow-hidden">
        {/* Left - Config (40%) */}
        <div className="w-[40%] overflow-y-auto no-scrollbar">
          <RegistrationConfig />
        </div>

        {/* Right - Terminal (60%) */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
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
