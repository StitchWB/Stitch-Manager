import { useState, useEffect, useCallback } from 'react';
import { X, Trash2, RefreshCw, Bug } from 'lucide-react';
import { aiProxy } from '@/lib/backend';
import type { ProxyDebugLog } from '@/lib/backend/modules/aiProxy';
import { Button, LoadingSpinner } from '@/components/ui';

interface ProxyDebugDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ProxyDebugDrawer({ isOpen, onClose }: ProxyDebugDrawerProps) {
  const [logs, setLogs] = useState<ProxyDebugLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedLog, setSelectedLog] = useState<ProxyDebugLog | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchLogs = useCallback(async () => {
    if (!isOpen) return;
    setLoading(true);
    try {
      const data = await aiProxy.getProxyDebugLogs(100);
      setLogs(data);
    } catch (err) {
      console.error('Failed to fetch proxy debug logs:', err);
    } finally {
      setLoading(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      fetchLogs();
    }
  }, [isOpen, fetchLogs]);

  useEffect(() => {
    if (!autoRefresh || !isOpen) return;
    const interval = setInterval(fetchLogs, 3000);
    return () => clearInterval(interval);
  }, [autoRefresh, isOpen, fetchLogs]);

  const handleClear = async () => {
    try {
      await aiProxy.clearProxyDebugLogs(0); // clear all
      setLogs([]);
      setSelectedLog(null);
    } catch (err) {
      console.error('Failed to clear logs:', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Drawer */}
      <div className="relative w-full max-w-3xl bg-[#18181b] border-l border-white/10 flex flex-col h-full shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <Bug className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-white">Proxy Debug Logs</h2>
            <span className="text-xs text-slate-500">({logs.length})</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                className="accent-amber-500 w-3 h-3"
                checked={autoRefresh}
                onChange={e => setAutoRefresh(e.target.checked)}
              />
              Auto
            </label>
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchLogs}
              disabled={loading}
              className="h-7 px-2 text-xs"
            >
              {loading ? <LoadingSpinner size="sm" /> : <RefreshCw className="w-3 h-3" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              className="h-7 px-2 text-xs text-red-400 hover:text-red-300"
            >
              <Trash2 className="w-3 h-3" />
            </Button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Logs list */}
          <div className="w-1/2 border-r border-white/10 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[#18181b] z-10">
                <tr className="border-b border-white/10 text-slate-400">
                  <th className="px-3 py-2 text-left font-medium">Method</th>
                  <th className="px-3 py-2 text-left font-medium">Path</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr
                    key={log.id ?? log.createdAt}
                    className={`border-b border-white/5 cursor-pointer transition-colors ${
                      selectedLog?.id === log.id ? 'bg-amber-500/10' : 'hover:bg-white/5'
                    }`}
                    onClick={() => setSelectedLog(log)}
                  >
                    <td className="px-3 py-2">
                      <span className={
                        log.method === 'GET' ? 'text-emerald-400' :
                        log.method === 'POST' ? 'text-blue-400' :
                        'text-slate-300'
                      }>{log.method}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-300 truncate max-w-[150px]" title={log.path}>
                      {log.path}
                    </td>
                    <td className="px-3 py-2">
                      {log.errorMessage ? (
                        <span className="text-red-400">ERR</span>
                      ) : log.responseStatus ? (
                        <span className={
                          log.responseStatus >= 200 && log.responseStatus < 300 ? 'text-emerald-400' :
                          log.responseStatus >= 400 ? 'text-red-400' :
                          'text-amber-400'
                        }>{log.responseStatus}</span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {log.durationMs !== null && log.durationMs !== undefined ? `${log.durationMs}ms` : '—'}
                    </td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-slate-500">
                      {loading ? 'Loading...' : 'No proxy debug logs yet. Make a request through the proxy.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Detail panel */}
          <div className="w-1/2 overflow-auto p-4">
            {selectedLog ? (
              <div className="space-y-4">
                <div>
                  <h3 className="text-xs font-medium text-slate-400 mb-1">Request</h3>
                  <div className="bg-black/30 rounded-lg p-3 space-y-2 text-xs">
                    <div className="flex gap-2">
                      <span className="text-emerald-400 font-mono">{selectedLog.method}</span>
                      <span className="text-slate-300 font-mono">{selectedLog.path}</span>
                    </div>
                    {selectedLog.requestHeaders && (
                      <pre className="text-slate-500 text-[10px] overflow-auto max-h-32 whitespace-pre-wrap">
                        {selectedLog.requestHeaders}
                      </pre>
                    )}
                    {selectedLog.requestBody && (
                      <pre className="text-slate-300 text-[10px] overflow-auto max-h-48 whitespace-pre-wrap bg-black/20 rounded p-2">
                        {selectedLog.requestBody}
                      </pre>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-medium text-slate-400 mb-1">Response</h3>
                  <div className="bg-black/30 rounded-lg p-3 space-y-2 text-xs">
                    {selectedLog.responseStatus ? (
                      <span className={`font-mono ${
                        selectedLog.responseStatus >= 200 && selectedLog.responseStatus < 300 ? 'text-emerald-400' :
                        selectedLog.responseStatus >= 400 ? 'text-red-400' :
                        'text-amber-400'
                      }`}>
                        Status: {selectedLog.responseStatus}
                      </span>
                    ) : selectedLog.errorMessage ? (
                      <span className="text-red-400">Error: {selectedLog.errorMessage}</span>
                    ) : null}
                    {selectedLog.responseHeaders && (
                      <pre className="text-slate-500 text-[10px] overflow-auto max-h-32 whitespace-pre-wrap">
                        {selectedLog.responseHeaders}
                      </pre>
                    )}
                    {selectedLog.responseBody && (
                      <pre className="text-slate-300 text-[10px] overflow-auto max-h-64 whitespace-pre-wrap bg-black/20 rounded p-2">
                        {selectedLog.responseBody}
                      </pre>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-500 text-sm">
                Select a log entry to view details
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
