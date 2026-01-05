import { useEffect, useCallback, useRef } from 'react';
import { Download, CheckCircle, XCircle, Copy, RefreshCw } from 'lucide-react';
import Header from '../components/layout/Header';
import RegistrationConfig from '../components/RegistrationConfig';
import LogConsole from '../components/LogConsole';
import { useRegistrationStore } from '../stores/registration';
import { useAppStore } from '../stores/app';
import type { RegistrationLog } from '../types';

// WebSocket URL - connects to Python backend
// Uses environment variable if available, otherwise builds from current hostname
const getWebSocketUrl = (): string => {
  // Check for environment variable first (Vite uses import.meta.env)
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }
  // Fall back to building URL from current hostname
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname || 'localhost';
  const port = import.meta.env.VITE_API_PORT || '8000';
  return `${protocol}//${host}:${port}/registration/ws`;
};

const WS_URL = getWebSocketUrl();

export default function AutoReg() {
  const { addNotification } = useAppStore();
  const {
    results,
    isRunning,
    successCount,
    failedCount,
    addLog,
    addResult,
    setProgress,
    setWsConnected,
  } = useRegistrationStore();

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // WebSocket connection handler
  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      const ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        setWsConnected(true);
        addLog({ level: 'info', message: 'Connected to registration server' });
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          switch (data.type) {
            case 'log':
              addLog({
                level: data.level as RegistrationLog['level'],
                message: data.message,
                jobId: data.jobId,
              });
              break;
              
            case 'progress':
              setProgress({
                current: data.current,
                total: data.total,
                percentage: Math.round((data.current / data.total) * 100),
                currentStep: data.step,
              });
              break;
              
            case 'result':
              addResult({
                email: data.email,
                status: data.success ? 'success' : 'failed',
                token: data.token,
                error: data.error,
              });
              
              if (data.success) {
                addLog({ level: 'success', message: `Account created: ${data.email}` });
              } else {
                addLog({ level: 'error', message: `Failed: ${data.email} - ${data.error}` });
              }
              break;
              
            case 'complete':
              addLog({ level: 'info', message: 'Registration batch completed' });
              addNotification({
                type: 'success',
                title: 'Registration Complete',
                message: `Created ${data.successCount} accounts`,
              });
              break;
              
            case 'error':
              addLog({ level: 'error', message: data.message });
              break;
          }
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        addLog({ level: 'warn', message: 'Disconnected from registration server' });
        
        // Attempt to reconnect after 5 seconds
        if (isRunning) {
          reconnectTimeoutRef.current = setTimeout(() => {
            addLog({ level: 'info', message: 'Attempting to reconnect...' });
            connectWebSocket();
          }, 5000);
        }
      };

      ws.onerror = () => {
        addLog({ level: 'error', message: 'WebSocket connection error' });
      };

      wsRef.current = ws;
    } catch (err) {
      console.error('Failed to connect WebSocket:', err);
    }
  }, [addLog, addResult, setProgress, setWsConnected, addNotification, isRunning]);

  // Connect WebSocket when registration starts
  useEffect(() => {
    if (isRunning) {
      connectWebSocket();
    }

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [isRunning, connectWebSocket]);

  // Cleanup WebSocket on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  // Export results to CSV
  const exportResults = () => {
    if (results.length === 0) return;

    const headers = ['Email', 'Status', 'Token', 'Error', 'Created At'];
    const rows = results.map((r) => [
      r.email,
      r.status,
      r.token || '',
      r.error || '',
      r.createdAt,
    ]);

    const csv = [headers, ...rows].map((row) => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `registration-results-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Copy token to clipboard
  const copyToken = async (token: string) => {
    await navigator.clipboard.writeText(token);
    addNotification({
      type: 'success',
      title: 'Copied',
      message: 'Token copied to clipboard',
    });
  };

  // Truncate token for display
  const truncateToken = (token: string, length = 20) => {
    if (token.length <= length) return token;
    return `${token.slice(0, length)}...`;
  };

  return (
    <>
      <Header title="Auto-Registration Factory" subtitle="Automated account creation pipeline" />

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel: Configuration (40%) */}
        <div className="w-[40%] min-w-[400px] max-w-[500px]">
          <RegistrationConfig />
        </div>

        {/* Right Panel: Terminal & Results (60%) */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Live Log Console (60% of right panel) */}
          <div className="h-[60%] min-h-[300px]">
            <LogConsole />
          </div>

          {/* Results Table (40% of right panel) */}
          <div className="flex-1 bg-background-dark border-t border-border-dark flex flex-col overflow-hidden">
            {/* Results Header */}
            <div className="h-12 flex items-center justify-between px-4 border-b border-border-dark bg-surface-dark/50">
              <div className="flex items-center gap-4">
                <h3 className="text-sm font-medium text-white">Results</h3>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-green-400 bg-green-400/10 px-2 py-0.5 rounded flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" />
                    {successCount} Success
                  </span>
                  <span className="text-xs text-red-400 bg-red-400/10 px-2 py-0.5 rounded flex items-center gap-1">
                    <XCircle className="w-3 h-3" />
                    {failedCount} Failed
                  </span>
                </div>
              </div>
              <button
                onClick={exportResults}
                disabled={results.length === 0}
                className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 rounded hover:bg-white/10"
              >
                <Download className="w-3.5 h-3.5" />
                Export CSV
              </button>
            </div>

            {/* Results Table */}
            <div className="flex-1 overflow-auto">
              {results.length === 0 ? (
                <div className="flex items-center justify-center h-full text-slate-600">
                  <div className="text-center">
                    <RefreshCw className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No results yet</p>
                    <p className="text-xs mt-1">Results will appear here as accounts are created</p>
                  </div>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-surface-dark/50 sticky top-0">
                    <tr className="text-left text-xs text-slate-400 uppercase tracking-wider">
                      <th className="px-4 py-2 font-medium">Email</th>
                      <th className="px-4 py-2 font-medium">Status</th>
                      <th className="px-4 py-2 font-medium">Token</th>
                      <th className="px-4 py-2 font-medium">Error</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-dark">
                    {results.map((result) => (
                      <tr
                        key={result.id}
                        className={`hover:bg-white/5 transition-colors ${
                          result.status === 'failed' ? 'bg-red-500/5' : ''
                        }`}
                      >
                        <td className="px-4 py-2.5 text-white font-mono text-xs">
                          {result.email}
                        </td>
                        <td className="px-4 py-2.5">
                          {result.status === 'success' ? (
                            <span className="inline-flex items-center gap-1 text-green-400 text-xs">
                              <CheckCircle className="w-3.5 h-3.5" />
                              Success
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-red-400 text-xs">
                              <XCircle className="w-3.5 h-3.5" />
                              Failed
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {result.token ? (
                            <div className="flex items-center gap-2">
                              <code className="text-xs text-slate-400 font-mono bg-surface-dark px-2 py-0.5 rounded">
                                {truncateToken(result.token)}
                              </code>
                              <button
                                onClick={() => copyToken(result.token!)}
                                className="text-slate-500 hover:text-white transition-colors"
                                title="Copy token"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <span className="text-slate-600 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-red-400 text-xs max-w-[200px] truncate">
                          {result.error || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
