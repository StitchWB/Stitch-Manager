import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  FileText,
  Search,
  Download,
  Trash2,
  RefreshCw,
  Copy,
  Check,
  List,
  Layers,
  AlertTriangle,
  Terminal,
  SlidersHorizontal,
  Signal,
  Radio,
  X,
} from 'lucide-react';
import Header from '../components/layout/Header';


import { useAppStore } from '../stores/app';
import { useLogsStore, LogLevel, LogEntry } from '../stores/logs';
import { useUIPreferencesStore } from '../stores/uiPreferences';
import { useRegistrationStore } from '../stores/registration';
import { t } from '../lib/i18n';
import { cn } from '../lib/utils';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';







import { copyToClipboard as copyTextToClipboard } from '@/lib/tauri/modules/utils';
import { Badge, Button, ButtonBase, EmptyState, FilterDropdown, Input, LoadingSpinner, LogGroup, MultiFilterDropdown, TabButton, Toggle } from '@/components/ui';

const LOG_SOURCES = [
  'accounts',
  'registration',
  'patcher',
  'settings',
  'server',
  'system',
  'ai_proxy.sidecar',
  'ai_proxy.process',
  'python_runner',
] as const;

const LOG_CHANNELS = ['all', 'app', 'frontend', 'backend', 'proxy', 'sidecar', 'toast'] as const;
const DEFAULT_DETAILS_PANE_WIDTH = 360;

const LEVEL_DOT_MAP: Record<string, string> = {
  all: 'border border-slate-600',
  debug: 'bg-slate-500',
  info: 'bg-sky-400',
  success: 'bg-emerald-400',
  warn: 'bg-amber-400',
  error: 'bg-red-400',
};

const CHANNEL_DOT_MAP: Record<string, string> = {
  all: 'border border-slate-600',
  app: 'bg-slate-400',
  frontend: 'bg-sky-400',
  backend: 'bg-purple-400',
  proxy: 'bg-emerald-400',
  sidecar: 'bg-amber-400',
  toast: 'bg-pink-400',
};

interface LogGroupData {
  stage: string;
  entries: LogEntry[];
  status: 'success' | 'error' | 'progress' | 'info';
  duration?: number;
  firstTimestamp: number;
}

function detectStageFromLog(log: LogEntry): string {
  const stageMatches = log.message.match(/\[([^\]]+)\]/g);
  if (stageMatches && stageMatches.length > 0) {
    const lastMatch = stageMatches[stageMatches.length - 1];
    const stage = lastMatch.slice(1, -1);
    if (!stage.includes('/') && stage.length > 0) return stage;
  }
  return log.source || 'system';
}

function groupLogsByStage(logs: LogEntry[]): LogGroupData[] {
  const groups = new Map<string, LogEntry[]>();
  for (const log of logs) {
    const stage = detectStageFromLog(log);
    if (!groups.has(stage)) groups.set(stage, []);
    groups.get(stage)!.push(log);
  }

  const result: LogGroupData[] = [];
  for (const [stage, entries] of groups.entries()) {
    const hasError = entries.some(e => e.level === 'error');
    const hasSuccess = entries.some(e => e.level === 'success');
    const hasProgress = entries.some(
      e => e.message.includes('⏳') || e.message.includes('Attempt')
    );
    let status: 'success' | 'error' | 'progress' | 'info' = 'info';
    if (hasError) status = 'error';
    else if (hasSuccess) status = 'success';
    else if (hasProgress) status = 'progress';

    const timestamps = entries.map(e => new Date(e.timestamp).getTime());
    const firstTimestamp = Math.min(...timestamps);
    const lastTimestamp = Math.max(...timestamps);
    result.push({
      stage,
      entries,
      status,
      duration: lastTimestamp - firstTimestamp,
      firstTimestamp,
    });
  }

  return result.sort((a, b) => b.firstTimestamp - a.firstTimestamp);
}

export default function Logs() {
  const { language } = useAppStore();
  const { logVerbosity } = useRegistrationStore();
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
    groupingEnabled,
    autoCollapseSuccess,
    collapsedGroups,
    toggleGroup,
    setGroupingEnabled,
    setAutoCollapseSuccess,
    expandAllGroups,
    collapseAllGroups,
  } = useLogsStore();

  const {
    logsPage: {
      levelFilter,
      sourceFilter,
      searchQuery,
      channelFilter,
      selectedTab,
      detailsPaneWidth,
      selectedLogId,
    },
    setLogsLevelFilter,
    setLogsSourceFilter,
    setLogsChannelFilter,
    setLogsSearchQuery,
    setLogsSelectedTab,
    setLogsDetailsPaneWidth,
    setLogsSelectedLogId,
    resetLogsFilters,
  } = useUIPreferencesStore();

  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isResizingPane, setIsResizingPane] = useState(false);
  const { copy } = useCopyToClipboard();
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const rawSourceFilters = useMemo(
    () =>
      Array.isArray(sourceFilter)
        ? sourceFilter
        : sourceFilter && sourceFilter !== 'all'
          ? [sourceFilter]
          : [],
    [sourceFilter]
  );

  const availableSources = useMemo(() => {
    const merged: string[] = [...LOG_SOURCES];
    const seen = new Set(merged);

    for (const log of logs) {
      const source = log.source || 'system';
      if (!seen.has(source)) {
        seen.add(source);
        merged.push(source);
      }
    }

    return merged;
  }, [logs]);

  const sourceFilters = useMemo(
    () => rawSourceFilters.filter(source => availableSources.includes(source)),
    [availableSources, rawSourceFilters]
  );

  const effectiveSourceFilters = useMemo(() => {
    const allSelected =
      availableSources.length > 0 && sourceFilters.length >= availableSources.length;
    return allSelected ? [] : sourceFilters;
  }, [availableSources.length, sourceFilters]);

  void language;

  useEffect(() => {
    fetchLogs();
    subscribeToLogs();
    return () => unsubscribeFromLogs();
  }, [fetchLogs, subscribeToLogs, unsubscribeFromLogs]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilter({ search: searchQuery || undefined });
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery, setFilter]);

  const groupedLogs = useMemo(() => groupLogsByStage(logs), [logs]);

  const pythonLogs = useMemo(
    () =>
      logs.filter(log => {
        const msg = log.message.toLowerCase();
        return (
          log.source === 'python_runner' ||
          msg.includes('scenario.replay') ||
          msg.includes('scenario.record') ||
          msg.includes('python.stderr') ||
          msg.includes('python.protocol')
        );
      }),
    [logs]
  );

  const errorLogs = useMemo(
    () => logs.filter(log => log.level === 'error' || log.level === 'warn'),
    [logs]
  );

  const errorLogIds = useMemo(() => errorLogs.map(log => log.id), [errorLogs]);
  const selectedErrorIndex = useMemo(() => {
    if (!selectedLogId) return -1;
    return errorLogIds.indexOf(selectedLogId);
  }, [errorLogIds, selectedLogId]);

  const selectedLog = useMemo(
    () => logs.find(l => l.id === selectedLogId) ?? null,
    [logs, selectedLogId]
  );

  const handleLevelChange = useCallback(
    (level: string) => {
      setLogsLevelFilter(level);
      setFilter({ levels: level && level !== 'all' ? [level as LogLevel] : [] });
    },
    [setFilter, setLogsLevelFilter]
  );

  const handleSourceChange = useCallback(
    (sources: string[]) => {
      const normalized = Array.from(new Set(sources)).filter(Boolean);
      const allSelected =
        availableSources.length > 0 && normalized.length >= availableSources.length;
      const nextSources = allSelected ? [] : normalized;

      setLogsSourceFilter(nextSources);
      setFilter({ sources: nextSources });
    },
    [availableSources, setFilter, setLogsSourceFilter]
  );

  const handleChannelChange = useCallback(
    (channel: string) => {
      setLogsChannelFilter(channel);
      setFilter({ channels: channel && channel !== 'all' ? [channel] : [] });
    },
    [setFilter, setLogsChannelFilter]
  );

  const levelCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: logs.length,
      debug: 0,
      info: 0,
      success: 0,
      warn: 0,
      error: 0,
    };

    for (const log of logs) {
      counts[log.level] = (counts[log.level] ?? 0) + 1;
    }

    return counts;
  }, [logs]);

  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const source of availableSources) counts[source] = 0;
    for (const log of logs) {
      const source = log.source || 'system';
      counts[source] = (counts[source] ?? 0) + 1;
    }
    return counts;
  }, [availableSources, logs]);

  const channelCounts = useMemo(() => {
    const counts: Record<string, number> = { all: logs.length };
    for (const channel of LOG_CHANNELS) {
      if (channel !== 'all') counts[channel] = 0;
    }
    for (const log of logs) {
      const channel = log.channel ?? 'app';
      counts[channel] = (counts[channel] ?? 0) + 1;
    }
    return counts;
  }, [logs]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (levelFilter !== 'all') count += 1;
    if (channelFilter !== 'all') count += 1;
    count += effectiveSourceFilters.length;
    if (searchQuery.trim()) count += 1;
    return count;
  }, [channelFilter, effectiveSourceFilters.length, levelFilter, searchQuery]);

  const handleRefresh = useCallback(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleClear = useCallback(async () => {
    try {
      await clearLogs();
      setShowClearConfirm(false);
      setLogsSelectedLogId(null);
    } catch (err) {
      console.error('Failed to clear logs:', err);
    }
  }, [clearLogs, setLogsSelectedLogId]);

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

  useEffect(() => {
    if (!rawSourceFilters.length || !availableSources.length) return;
    const allSelected = sourceFilters.length >= availableSources.length;
    if (!allSelected) return;

    setLogsSourceFilter([]);
    setFilter({ sources: [] });
  }, [
    availableSources.length,
    rawSourceFilters.length,
    setFilter,
    setLogsSourceFilter,
    sourceFilters.length,
  ]);

  const clearLevelFilter = useCallback(() => {
    handleLevelChange('all');
  }, [handleLevelChange]);

  const clearChannelFilter = useCallback(() => {
    handleChannelChange('all');
  }, [handleChannelChange]);

  const clearSourceFilter = useCallback(
    (source: string) => {
      handleSourceChange(effectiveSourceFilters.filter(s => s !== source));
    },
    [effectiveSourceFilters, handleSourceChange]
  );

  const clearSearchFilter = useCallback(() => {
    setLogsSearchQuery('');
    setFilter({ search: undefined });
  }, [setFilter, setLogsSearchQuery]);

  useEffect(() => {
    if (channelFilter && channelFilter !== 'all') {
      setFilter({ channels: [channelFilter] });
    }
  }, [channelFilter, setFilter]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = (target?.tagName || '').toLowerCase();
      const isTyping =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        Boolean(target?.isContentEditable);

      if (!isTyping && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (isTyping) return;

      const tabs: Array<typeof selectedTab> = ['stream', 'grouped', 'errors', 'python'];
      const idx = tabs.indexOf(selectedTab);
      if (idx < 0) return;

      if (e.key === '[') {
        e.preventDefault();
        const prev = (idx - 1 + tabs.length) % tabs.length;
        setLogsSelectedTab(tabs[prev]);
      }

      if (e.key === ']') {
        e.preventDefault();
        const next = (idx + 1) % tabs.length;
        setLogsSelectedTab(tabs[next]);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedTab, setLogsSelectedTab]);

  useEffect(() => {
    if (!isResizingPane) return;
    const onMove = (e: MouseEvent) => {
      const next = Math.round(window.innerWidth - e.clientX);
      const clamped = Math.min(560, Math.max(300, next));
      setLogsDetailsPaneWidth(clamped);
    };
    const onUp = () => setIsResizingPane(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isResizingPane, setLogsDetailsPaneWidth]);

  useEffect(() => {
    if (!selectedLogId) return;
    if (!logs.some(l => l.id === selectedLogId)) {
      setLogsSelectedLogId(null);
    }
  }, [logs, selectedLogId, setLogsSelectedLogId]);

  const applyPreset = useCallback(
    (preset: 'errors' | 'python' | 'registration') => {
      if (preset === 'errors') {
        setLogsSelectedTab('errors');
        setLogsSourceFilter([]);
        setLogsLevelFilter('all');
        setFilter({
          sources: [],
          levels: [],
          channels: channelFilter === 'all' ? [] : [channelFilter],
        });
        return;
      }

      if (preset === 'python') {
        setLogsSelectedTab('python');
        setLogsSourceFilter(['python_runner']);
        setFilter({ sources: ['python_runner'] });
        return;
      }

      setLogsSelectedTab('stream');
      setLogsSourceFilter(['registration']);
      setFilter({ sources: ['registration'] });
    },
    [channelFilter, setFilter, setLogsLevelFilter, setLogsSelectedTab, setLogsSourceFilter]
  );

  const copyMessage = useCallback(
    async (text: string, logId: string) => {
      await copy(text);
      setCopiedId(logId);
      setTimeout(() => setCopiedId(null), 1200);
    },
    [copy]
  );

  const jumpToError = useCallback(
    (direction: 'prev' | 'next') => {
      if (!errorLogIds.length) return;

      let nextIndex = 0;
      if (selectedErrorIndex >= 0) {
        nextIndex = direction === 'prev' ? selectedErrorIndex - 1 : selectedErrorIndex + 1;
      } else {
        nextIndex = direction === 'prev' ? errorLogIds.length - 1 : 0;
      }

      if (nextIndex < 0) nextIndex = errorLogIds.length - 1;
      if (nextIndex >= errorLogIds.length) nextIndex = 0;

      setLogsSelectedLogId(errorLogIds[nextIndex]);
    },
    [errorLogIds, selectedErrorIndex, setLogsSelectedLogId]
  );

  const renderFlatLogs = (rows: LogEntry[]) => (
    <div className="font-mono text-xs">
      {rows.map(log => {
        const isCopied = copiedId === log.id;
        return (
          <div
            key={log.id}
            className={cn(
              'w-full flex items-start gap-2 px-3 py-1.5 border-b border-white/[0.03] transition-colors',
              selectedLogId === log.id ? 'bg-indigo-500/10' : 'hover:bg-white/[0.02]'
            )}
          >
            <ButtonBase
              className="flex-1 min-w-0 flex items-start gap-3 text-left"
              onClick={() => setLogsSelectedLogId(log.id)}
            >
              <span className="text-slate-600 tabular-nums shrink-0">
                {new Date(log.timestamp).toLocaleTimeString('en-US', {
                  hour12: false,
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>

              <span
                className={cn(
                  'shrink-0 w-11 text-center font-bold uppercase',
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

              <span className="text-purple-400 shrink-0 w-28 truncate">
                [{log.source || 'system'}]
              </span>

              <div className="flex-1 min-w-0 text-slate-300 break-words line-clamp-2">
                {log.message}
              </div>
            </ButtonBase>

            <ButtonBase
              onClick={() => {
                void copyMessage(log.message, log.id);
              }}
              className="text-slate-500 hover:text-slate-200 transition-colors p-1 rounded hover:bg-white/5 shrink-0"
            >
              {isCopied ? (
                <Check className="w-3 h-3 text-vsc-green" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </ButtonBase>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title={t('logs.title')}
        subtitle={t('logs.subtitle')}
        icon={<FileText size={18} />}
        actions={
          <div className="flex items-center gap-2">
            <Badge variant="info" size="sm">
              Verbosity: {logVerbosity}
            </Badge>
            <Button
              size="xs"
              variant="secondary"
              onClick={handleRefresh}
              isLoading={isLoading}
              leftIcon={<RefreshCw size={12} />}
            >
              {t('logs.refresh')}
            </Button>
            <Button
              size="xs"
              variant="secondary"
              onClick={handleExport}
              disabled={logs.length === 0}
              leftIcon={<Download size={12} />}
            >
              {t('logs.export')}
            </Button>
            <Button
              size="xs"
              variant="danger"
              onClick={() => setShowClearConfirm(true)}
              disabled={logs.length === 0}
              leftIcon={<Trash2 size={12} />}
            >
              {t('logs.clear')}
            </Button>
          </div>
        }
      />

      <div className="px-6 pt-3 pb-2 border-b border-white/5 bg-[#0a0a0c]/80 backdrop-blur-xl sticky top-0 z-20">
        <div className="flex flex-wrap items-center gap-2">
          <FilterDropdown
            value={levelFilter}
            onChange={handleLevelChange}
            icon={<SlidersHorizontal size={14} />}
            label={t('logs.level')}
            triggerClassName="h-8 min-w-[152px]"
            showActiveState
            options={[
              {
                value: 'all',
                label: t('logs.allLevels'),
                dot: LEVEL_DOT_MAP.all,
                count: levelCounts.all,
              },
              {
                value: 'debug',
                label: t('logs.debug'),
                dot: LEVEL_DOT_MAP.debug,
                count: levelCounts.debug,
              },
              {
                value: 'info',
                label: t('logs.info'),
                dot: LEVEL_DOT_MAP.info,
                count: levelCounts.info,
              },
              {
                value: 'success',
                label: t('logs.success'),
                dot: LEVEL_DOT_MAP.success,
                count: levelCounts.success,
              },
              {
                value: 'warn',
                label: t('logs.warning'),
                dot: LEVEL_DOT_MAP.warn,
                count: levelCounts.warn,
              },
              {
                value: 'error',
                label: t('logs.error'),
                dot: LEVEL_DOT_MAP.error,
                count: levelCounts.error,
              },
            ]}
          />

          <MultiFilterDropdown
            values={effectiveSourceFilters}
            onChange={handleSourceChange}
            icon={<Signal size={14} />}
            triggerClassName="h-8 min-w-[180px]"
            menuClassName="min-w-[260px]"
            placeholder={t('logs.allSources')}
            footerAllLabel={t('logs.selectAllSources')}
            footerClearLabel={t('common.clear')}
            emptyMeansAll
            renderValue={values =>
              values.length === 0
                ? t('logs.allSources')
                : values.length === 1
                  ? values[0]
                  : t('logs.sourceCountSelected', { count: values.length })
            }
            options={availableSources.map(source => ({
              value: source,
              label: source,
              dot: source.startsWith('ai_proxy') ? 'bg-emerald-400' : 'bg-purple-400',
              count: sourceCounts[source] ?? 0,
            }))}
          />

          <FilterDropdown
            value={channelFilter}
            onChange={handleChannelChange}
            icon={<Radio size={14} />}
            label={t('logs.channel')}
            triggerClassName="h-8 min-w-[148px]"
            showActiveState
            options={LOG_CHANNELS.map(channel => ({
              value: channel,
              label: channel === 'all' ? t('logs.allChannels') : channel,
              dot: CHANNEL_DOT_MAP[channel],
              count: channelCounts[channel] ?? 0,
            }))}
          />

          <Input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setLogsSearchQuery(e.target.value)
            }
            placeholder={t('logs.searchPlaceholder')}
            leftIcon={<Search className="w-4 h-4" />}
            containerClassName="w-[280px] max-w-full"
            className="h-8 py-1 text-xs"
          />

          <Button
            size="xs"
            variant="ghost"
            onClick={handleResetFilters}
            disabled={activeFilterCount === 0}
          >
            {t('logs.resetFilters')}
          </Button>

          <div className="ml-auto flex items-center gap-2">
            <Badge variant="default" size="sm">
              {logs.length}/{total}
            </Badge>
          </div>
        </div>

        {activeFilterCount > 0 && (
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {levelFilter !== 'all' && (
              <Badge variant="info" size="sm" className="normal-case gap-2">
                <span>
                  {t('logs.level')}: {levelFilter}
                </span>
                <ButtonBase
                  className="text-sky-200 hover:text-white"
                  onClick={clearLevelFilter}
                  aria-label="Clear level filter"
                >
                  <X size={12} />
                </ButtonBase>
              </Badge>
            )}
            {channelFilter !== 'all' && (
              <Badge variant="warning" size="sm" className="normal-case gap-2">
                <span>
                  {t('logs.channel')}: {channelFilter}
                </span>
                <ButtonBase
                  className="text-amber-200 hover:text-white"
                  onClick={clearChannelFilter}
                  aria-label="Clear channel filter"
                >
                  <X size={12} />
                </ButtonBase>
              </Badge>
            )}
            {effectiveSourceFilters.map(source => (
              <Badge key={source} variant="default" size="sm" className="normal-case gap-2">
                <span>
                  {t('logs.source')}: {source}
                </span>
                <ButtonBase
                  className="text-slate-300 hover:text-white"
                  onClick={() => clearSourceFilter(source)}
                  aria-label={`Clear source filter ${source}`}
                >
                  <X size={12} />
                </ButtonBase>
              </Badge>
            ))}
            {searchQuery.trim() && (
              <Badge variant="outline" size="sm" className="normal-case gap-2">
                <span>
                  {t('common.search')}: {searchQuery}
                </span>
                <ButtonBase
                  className="text-slate-300 hover:text-white"
                  onClick={clearSearchFilter}
                  aria-label="Clear search filter"
                >
                  <X size={12} />
                </ButtonBase>
              </Badge>
            )}
            <Badge variant="outline" size="sm" className="ml-auto normal-case">
              {t('logs.filtersApplied', { count: activeFilterCount })}
            </Badge>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 mt-2">
          <TabButton
            active={selectedTab === 'stream'}
            onClick={() => setLogsSelectedTab('stream')}
            label={`Stream (${logs.length})`}
            icon={<List size={14} />}
            className={selectedTab === 'stream' ? 'text-sky-200' : ''}
          />
          <TabButton
            active={selectedTab === 'grouped'}
            onClick={() => setLogsSelectedTab('grouped')}
            label={`Grouped (${groupedLogs.length})`}
            icon={<Layers size={14} />}
            className={selectedTab === 'grouped' ? 'text-indigo-200' : ''}
          />
          <TabButton
            active={selectedTab === 'errors'}
            onClick={() => setLogsSelectedTab('errors')}
            label={`Errors (${errorLogs.length})`}
            icon={<AlertTriangle size={14} />}
            className={selectedTab === 'errors' ? 'text-red-200' : ''}
          />
          <TabButton
            active={selectedTab === 'python'}
            onClick={() => setLogsSelectedTab('python')}
            label={`Python jobs (${pythonLogs.length})`}
            icon={<Terminal size={14} />}
            className={selectedTab === 'python' ? 'text-emerald-200' : ''}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-2">
          <Button
            size="xs"
            variant={selectedTab === 'errors' ? 'secondary' : 'ghost'}
            onClick={() => applyPreset('errors')}
          >
            {t('logs.presetOnlyErrors')}
          </Button>
          <Button
            size="xs"
            variant={selectedTab === 'python' ? 'secondary' : 'ghost'}
            onClick={() => applyPreset('python')}
          >
            {t('logs.presetPythonRunner')}
          </Button>
          <Button
            size="xs"
            variant={effectiveSourceFilters.includes('registration') ? 'secondary' : 'ghost'}
            onClick={() => applyPreset('registration')}
          >
            {t('logs.presetRegistration')}
          </Button>

          <div className="ml-auto flex items-center gap-2">
            <Badge variant="outline" size="sm">
              F: Search
            </Badge>
            <Badge variant="outline" size="sm">
              [ / ]: Tabs
            </Badge>
          </div>
        </div>

        {selectedTab === 'grouped' && (
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <Toggle
              checked={groupingEnabled}
              onChange={setGroupingEnabled}
              label={t('logs.groupByStage')}
            />
            <Toggle
              checked={autoCollapseSuccess}
              onChange={setAutoCollapseSuccess}
              label={t('logs.autoCollapseSuccess')}
            />
            <Button onClick={expandAllGroups} variant="ghost" size="xs">
              {t('logs.expandAll')}
            </Button>
            <Button onClick={collapseAllGroups} variant="ghost" size="xs">
              {t('logs.collapseAll')}
            </Button>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 min-w-0 p-4 overflow-hidden">
          {error && (
            <div className="mb-3 p-3 bg-vsc-red/10 border border-vsc-red/30 rounded text-sm text-vsc-red">
              {error}
            </div>
          )}

          <div className="h-full card overflow-hidden flex flex-col bg-[#0a0a0a]">
            <div className="overflow-auto flex-1">
              {logs.length === 0 && !isLoading ? (
                <EmptyState
                  icon={FileText}
                  title={t('logs.noLogs')}
                  description="No logs to display"
                />
              ) : selectedTab === 'grouped' ? (
                <div className="p-3 space-y-2">
                  {groupedLogs.map(group => (
                    <LogGroup
                      key={group.stage}
                      stage={group.stage}
                      entries={group.entries}
                      status={group.status}
                      isCollapsed={collapsedGroups.has(group.stage)}
                      onToggle={() => toggleGroup(group.stage)}
                      duration={group.duration}
                      icon="📋"
                    />
                  ))}
                </div>
              ) : selectedTab === 'errors' ? (
                renderFlatLogs(errorLogs)
              ) : selectedTab === 'python' ? (
                renderFlatLogs(pythonLogs)
              ) : (
                renderFlatLogs(logs)
              )}

              {isLoading && (
                <div className="flex items-center justify-center py-8">
                  <LoadingSpinner size="md" />
                </div>
              )}

              {hasMore && !isLoading && (
                <div className="flex justify-center py-4">
                  <Button onClick={loadMore} variant="secondary" size="sm">
                    {t('logs.loadMore')}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div
          className={cn(
            'hidden xl:block w-1 cursor-col-resize transition-colors rounded-full mx-0.5',
            isResizingPane ? 'bg-indigo-400/70' : 'bg-white/5 hover:bg-indigo-400/50'
          )}
          onMouseDown={() => setIsResizingPane(true)}
          onDoubleClick={() => setLogsDetailsPaneWidth(DEFAULT_DETAILS_PANE_WIDTH)}
          title="Drag to resize • Double-click to reset"
          aria-hidden="true"
        />
        <aside
          className="hidden xl:flex border-l border-white/5 bg-[#090b10] p-4 flex-col gap-3"
          style={{ width: `${detailsPaneWidth}px` }}
        >
          <div className="text-xs uppercase tracking-wider text-slate-500">Details</div>
          {!selectedLog ? (
            <div className="text-sm text-slate-500">Select a log row to inspect details</div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] text-slate-500">Error navigation</div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" size="sm">
                    {errorLogIds.length === 0
                      ? 'Error 0/0'
                      : `Error ${selectedErrorIndex >= 0 ? selectedErrorIndex + 1 : 1}/${errorLogIds.length}`}
                  </Badge>
                  <Button size="xs" variant="ghost" onClick={() => jumpToError('prev')}>
                    Prev error
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => jumpToError('next')}>
                    Next error
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    selectedLog.level === 'error'
                      ? 'danger'
                      : selectedLog.level === 'warn'
                        ? 'warning'
                        : 'info'
                  }
                  size="sm"
                >
                  {selectedLog.level}
                </Badge>
                <span className="text-xs text-slate-400">
                  {new Date(selectedLog.timestamp).toLocaleString()}
                </span>
              </div>

              <div className="text-xs text-slate-400">Source</div>
              <div className="text-sm text-slate-200">{selectedLog.source}</div>

              <div className="text-xs text-slate-400">Channel</div>
              <div className="text-sm text-slate-200">{selectedLog.channel || 'app'}</div>

              {selectedLog.correlationId ? (
                <>
                  <div className="text-xs text-slate-400">Correlation ID</div>
                  <div className="text-[11px] font-mono text-slate-300 break-all">
                    {selectedLog.correlationId}
                  </div>
                </>
              ) : null}

              {selectedLog.sessionId ? (
                <>
                  <div className="text-xs text-slate-400">Session ID</div>
                  <div className="text-[11px] font-mono text-slate-300 break-all">
                    {selectedLog.sessionId}
                  </div>
                </>
              ) : null}

              <div className="text-xs text-slate-400">Message</div>
              <div className="text-sm text-slate-200 whitespace-pre-wrap break-words">
                {selectedLog.message}
              </div>

              {selectedLog.context ? (
                <>
                  <div className="text-xs text-slate-400">Context</div>
                  <pre className="text-[11px] font-mono text-slate-300 bg-black/30 border border-white/10 rounded-md p-2 overflow-auto max-h-56">
                    {JSON.stringify(selectedLog.context, null, 2)}
                  </pre>
                </>
              ) : null}

              <div className="flex gap-2 pt-2 border-t border-white/10">
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => {
                    void copyMessage(selectedLog.message, selectedLog.id);
                  }}
                >
                  Copy message
                </Button>
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => {
                    const payload = JSON.stringify(selectedLog, null, 2);
                    void copyTextToClipboard({ text: payload });
                  }}
                >
                  Copy JSON
                </Button>
              </div>
            </>
          )}
        </aside>
      </div>

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
