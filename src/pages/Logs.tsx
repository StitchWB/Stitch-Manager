import { useState, useEffect, useCallback } from 'react';
import { FileText, Search, Download, Trash2, RefreshCw, Copy, Check } from 'lucide-react';
import Header from '../components/layout/Header';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingSpinner } from '../components/ui';
import { useAppStore } from '../stores/app';
import { useLogsStore, LogLevel } from '../stores/logs';
import { useUIPreferencesStore } from '../stores/uiPreferences';
import { t } from '../lib/i18n';
import { cn } from '../lib/utils';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { Tooltip } from '../components/Tooltip';

// ============================================
// Constants
// ============================================

const LOG_SOURCES = [
  'accounts',
  'registration',
  'patcher',
  'settings',
  'server',
  'system',
] as const;

// ============================================
// Component
// ============================================

export default function Logs() {
  const { language } = useAppStore();
  const {
    logs,
    total,
    hasMore,
    isLoading,
    error,
    fetchLogs,
    loadMore,
    clearLogs,
    exportLogs,
    setFilter,
    resetFilter,
    subscribeToLogs,
    unsubscribeFromLogs,
  } = useLogsStore();

  // UI preferences from store (persisted in localStorage)
  const {
    logsPage: { levelFilter, sourceFilter, searchQuery },
    setLogsLevelFilter,
    setLogsSourceFilter,
    setLogsSearchQuery,
    resetLogsFilters,
  } = useUIPreferencesStore();
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { copy } = useCopyToClipboard();

  // Force re-render when language changes
  void language;

  // ============================================
  // Effects
  // ============================================

  // On mount: fetch logs and subscribe to real-time updates
  useEffect(() => {
    fetchLogs();
    subscribeToLogs();

    return () => {
      unsubscribeFromLogs();
    };
  }, [fetchLogs, subscribeToLogs, unsubscribeFromLogs]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilter({ search: searchQuery || undefined });
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, setFilter]);

  // Apply filters on mount from persisted state
  useEffect(() => {
    // Only apply non-'all' filters
    if (levelFilter && levelFilter !== 'all') {
      setFilter({ levels: [levelFilter as LogLevel] });
    }
    if (sourceFilter && sourceFilter !== 'all') {
      setFilter({ sources: [sourceFilter] });
    }
    if (searchQuery) {
      setFilter({ search: searchQuery });
    }
  }, []); // Only on mount

  // ============================================
  // Handlers
  // ============================================

  const handleLevelChange = useCallback(
    (level: string) => {
      setLogsLevelFilter(level);
      // Convert 'all' to empty array (no filter)
      setFilter({ levels: level && level !== 'all' ? [level as LogLevel] : [] });
    },
    [setFilter, setLogsLevelFilter]
  );

  const handleSourceChange = useCallback(
    (source: string) => {
      setLogsSourceFilter(source);
      // Convert 'all' to empty array (no filter)
      setFilter({ sources: source && source !== 'all' ? [source] : [] });
    },
    [setFilter, setLogsSourceFilter]
  );

  const handleRefresh = useCallback(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleClear = useCallback(async () => {
    try {
      await clearLogs();
      setShowClearConfirm(false);
    } catch (err) {
      console.error('Failed to clear logs:', err);
    }
  }, [clearLogs]);

  const handleExport = useCallback(async () => {
    try {
      const content = await exportLogs('json');
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `stitch-logs-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export logs:', err);
    }
  }, [exportLogs]);

  const handleResetFilters = useCallback(() => {
    resetLogsFilters();
    resetFilter();
  }, [resetFilter, resetLogsFilters]);

  const toggleLogExpansion = useCallback((logId: string) => {
    setExpandedLogs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(logId)) {
        newSet.delete(logId);
      } else {
        newSet.add(logId);
      }
      return newSet;
    });
  }, []);

  const copyToClipboard = useCallback(
    async (text: string, logId: string) => {
      await copy(text);
      setCopiedId(logId);
      setTimeout(() => setCopiedId(null), 2000);
    },
    [copy]
  );

  // ============================================
  // Render
  // ============================================

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title={t('logs.title')}
        subtitle={t('logs.subtitle')}
        icon={<FileText size={18} />}
        actions={
          <div className="flex items-center gap-2">
            <Button
              onClick={handleRefresh}
              disabled={isLoading}
              variant="secondary"
              size="sm"
              leftIcon={<RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />}
            >
              {t('logs.refresh')}
            </Button>
            <Button
              onClick={handleExport}
              disabled={logs.length === 0}
              variant="secondary"
              size="sm"
              leftIcon={<Download className="w-3.5 h-3.5" />}
            >
              {t('logs.export')}
            </Button>
            <Button
              onClick={() => setShowClearConfirm(true)}
              disabled={logs.length === 0}
              variant="danger"
              size="sm"
              leftIcon={<Trash2 className="w-3.5 h-3.5" />}
            >
              {t('logs.clear')}
            </Button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        {/* Filters */}
        <div className="flex items-center gap-4 mb-4">
          {/* Level Filter */}
          <Select
            value={levelFilter}
            onChange={e => handleLevelChange(e.target.value)}
            className="w-32"
            options={[
              { value: 'all', label: t('logs.allLevels') },
              { value: 'debug', label: t('logs.debug') },
              { value: 'info', label: t('logs.info') },
              { value: 'success', label: t('logs.success') },
              { value: 'warn', label: t('logs.warning') },
              { value: 'error', label: t('logs.error') },
            ]}
          />

          {/* Source Filter */}
          <Select
            value={sourceFilter}
            onChange={e => handleSourceChange(e.target.value)}
            className="w-36"
            options={[
              { value: 'all', label: t('logs.allSources') },
              ...LOG_SOURCES.map(source => ({
                value: source,
                label: source,
              })),
            ]}
          />

          {/* Search Input */}
          <div className="flex-1 relative max-w-md">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setLogsSearchQuery(e.target.value)}
              placeholder={t('logs.searchPlaceholder')}
              className="input-ds text-sm py-1.5 pl-9 w-full"
            />
          </div>

          {/* Reset Filters */}
          {(levelFilter || sourceFilter || searchQuery) && (
            <button
              onClick={handleResetFilters}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              {t('logs.resetFilters')}
            </button>
          )}
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-4 p-3 bg-vsc-red/10 border border-vsc-red/30 rounded text-sm text-vsc-red">
            {error}
          </div>
        )}

        {/* Logs Table - Terminal Mode */}
        <div className="card flex-1 overflow-hidden flex flex-col bg-[#0a0a0a]">
          <div className="overflow-auto flex-1">
            {logs.length === 0 && !isLoading ? (
              <EmptyState
                icon={FileText}
                title={t('logs.noLogs')}
                description="No logs to display"
              />
            ) : (
              <div className="font-mono text-xs">
                {logs.map(log => {
                  const isCopied = copiedId === log.id;
                  const isLongMessage = log.message.length > 200;
                  const isExpanded = expandedLogs.has(log.id);

                  return (
                    <div
                      key={log.id}
                      className="flex items-start gap-3 px-4 py-1 hover:bg-white/[0.02] transition-colors border-b border-white/[0.02] group"
                    >
                      {/* Timestamp - Gray */}
                      <span className="text-slate-600 tabular-nums shrink-0">
                        {new Date(log.timestamp).toLocaleTimeString('en-US', {
                          hour12: false,
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>

                      {/* Level - Color coded, 3 chars */}
                      <span
                        className={cn(
                          'shrink-0 w-12 text-center font-bold uppercase',
                          log.level === 'debug' && 'text-slate-500',
                          log.level === 'info' && 'text-vsc-blue',
                          log.level === 'success' && 'text-vsc-green',
                          log.level === 'warn' && 'text-vsc-yellow',
                          log.level === 'error' && 'text-vsc-red'
                        )}
                      >
                        {log.level === 'debug'
                          ? 'DBG'
                          : log.level === 'info'
                            ? 'INF'
                            : log.level === 'success'
                              ? 'OK'
                              : log.level === 'warn'
                                ? 'WRN'
                                : 'ERR'}
                      </span>

                      {/* Source - Purple */}
                      <span className="text-purple-400 shrink-0 w-24 truncate">
                        [{log.source || 'system'}]
                      </span>

                      {/* Message - White, expandable */}
                      <div className="flex-1 min-w-0">
                        <div
                          className={cn(
                            'text-slate-300 break-words cursor-pointer',
                            !isExpanded && isLongMessage && 'line-clamp-1'
                          )}
                          onClick={() => isLongMessage && toggleLogExpansion(log.id)}
                        >
                          {log.message}
                        </div>
                      </div>

                      {/* Copy button - appears on hover */}
                      <Tooltip content="Copy message">
                        <button
                          onClick={() => copyToClipboard(log.message, log.id)}
                          className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-slate-300 transition-all p-1 rounded hover:bg-white/5 shrink-0"
                        >
                          {isCopied ? (
                            <Check className="w-3 h-3 text-vsc-green" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </Tooltip>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Loading Spinner */}
            {isLoading && (
              <div className="flex items-center justify-center py-8">
                <LoadingSpinner size="md" />
              </div>
            )}

            {/* Load More Button */}
            {hasMore && !isLoading && (
              <div className="flex justify-center py-4">
                <Button onClick={loadMore} variant="secondary" size="sm">
                  {t('logs.loadMore')}
                </Button>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-white/5 px-4 py-2 flex items-center justify-between bg-slate-900/50">
            <span className="text-2xs text-slate-500 font-mono">
              {t('logs.showing')} <span className="text-slate-300 tabular-nums">{logs.length}</span>{' '}
              {t('logs.of')} <span className="text-slate-300 tabular-nums">{total}</span>{' '}
              {t('logs.entries')}
            </span>
            {hasMore && <span className="text-2xs text-slate-600">{t('logs.scrollHint')}</span>}
          </div>
        </div>
      </div>

      {/* Clear Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-slate-800 border border-white/10 rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-white mb-2">{t('logs.clearConfirmTitle')}</h3>
            <p className="text-sm text-slate-400 mb-6">{t('logs.clearConfirmMessage')}</p>
            <div className="flex justify-end gap-3">
              <Button onClick={() => setShowClearConfirm(false)} variant="secondary">
                {t('common.cancel')}
              </Button>
              <Button onClick={handleClear} variant="danger">
                {t('common.clear')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
