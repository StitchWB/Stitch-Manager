import { useEffect, useCallback } from 'react';
import { Download, CheckCircle, XCircle, Copy } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import Header from '../components/layout/Header';
import RegistrationConfig from '../components/RegistrationConfig';
import LogConsole from '../components/LogConsole';
import { useRegistrationStore } from '../stores/registration';
import { useAppStore } from '../stores/app';
import type { RegistrationLog } from '../types';

// Event payload types from Rust backend
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
  const { addNotification } = useAppStore();
  const {
    results,
    successCount,
    failedCount,
    addLog,
    addResult,
    setProgress,
    setWsConnected,
  } = useRegistrationStore();

  // Setup Tauri event listeners
  useEffect(() => {
    // Mark as connected (using Tauri IPC instead of WebSocket)
    setWsConnected(true);
    addLog({ level: 'info', message: 'Connected to Tauri backend' });

    // Listen for registration logs
    const unlistenLog = listen<RegistrationLogEvent>('REGISTRATION_LOG', (event) => {
      const { level, message } = event.payload;
      addLog({
        level: level as RegistrationLog['level'],
        message,
      });
      
      // Parse progress from message if present
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
        } catch {
          // Not a progress message, ignore
        }
      }
    });

    // Listen for account added events
    const unlistenAccount = listen<AccountAddedEvent>('ACCOUNT_ADDED', (event) => {
      const { email } = event.payload;
      addResult({
        email,
        status: 'success',
        token: 'saved',
      });
      addLog({ level: 'success', message: `Account created and saved: ${email}` });
    });

    // Listen for registration complete
    const unlistenComplete = listen<RegistrationCompleteEvent>('REGISTRATION_COMPLETE', (event) => {
      if (event.payload.success) {
        addLog({ level: 'info', message: 'Registration completed successfully' });
        addNotification({
          type: 'success',
          title: 'Registration Complete',
          message: 'Account registration finished',
        });
      }
    });

    // Listen for registration errors
    const unlistenError = listen<RegistrationErrorEvent>('REGISTRATION_ERROR', (event) => {
      const { error } = event.payload;
      addLog({ level: 'error', message: `Registration failed: ${error}` });
      addNotification({
        type: 'error',
        title: 'Registration Failed',
        message: error,
      });
    });

    // Cleanup listeners on unmount
    return () => {
      unlistenLog.then(fn => fn());
      unlistenAccount.then(fn => fn());
      unlistenComplete.then(fn => fn());
      unlistenError.then(fn => fn());
      setWsConnected(false);
    };
  }, [addLog, addResult, setProgress, setWsConnected, addNotification]);

  // Copy results to clipboard
  const handleCopyResults = useCallback(() => {
    const text = results
      .map((r) => `${r.email}: ${r.status}${r.token ? ` (${r.token})` : ''}${r.error ? ` - ${r.error}` : ''}`)
      .join('\n');
    navigator.clipboard.writeText(text);
    addNotification({
      type: 'success',
      title: 'Copied',
      message: 'Results copied to clipboard',
    });
  }, [results, addNotification]);

  // Export results as JSON
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
    <div className="flex flex-col h-full">
      <Header
        title="Auto Registration"
        subtitle="Automated account registration with browser automation"
      />

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 p-6 overflow-auto">
        {/* Left Column - Configuration */}
        <div className="space-y-6">
          <RegistrationConfig />
        </div>

        {/* Right Column - Results & Logs */}
        <div className="space-y-6">
          {/* Results Summary */}
          <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Results</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyResults}
                  disabled={results.length === 0}
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Copy results"
                >
                  <Copy className="w-4 h-4" />
                </button>
                <button
                  onClick={handleExportResults}
                  disabled={results.length === 0}
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Export results"
                >
                  <Download className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="bg-slate-900/50 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-white">{results.length}</div>
                <div className="text-xs text-slate-400">Total</div>
              </div>
              <div className="bg-emerald-500/10 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-emerald-400">{successCount}</div>
                <div className="text-xs text-slate-400">Success</div>
              </div>
              <div className="bg-red-500/10 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-red-400">{failedCount}</div>
                <div className="text-xs text-slate-400">Failed</div>
              </div>
            </div>

            {/* Results List */}
            <div className="max-h-48 overflow-y-auto space-y-2">
              {results.length === 0 ? (
                <div className="text-center text-slate-500 py-4">
                  No results yet. Start registration to see results here.
                </div>
              ) : (
                results.map((result, index) => (
                  <div
                    key={index}
                    className={`flex items-center justify-between p-2 rounded-lg ${
                      result.status === 'success'
                        ? 'bg-emerald-500/10 border border-emerald-500/20'
                        : 'bg-red-500/10 border border-red-500/20'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {result.status === 'success' ? (
                        <CheckCircle className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-400" />
                      )}
                      <span className="text-sm text-white">{result.email}</span>
                    </div>
                    {result.error && (
                      <span className="text-xs text-red-400 truncate max-w-[150px]">
                        {result.error}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Log Console */}
          <LogConsole />
        </div>
      </div>
    </div>
  );
}
