import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  AlertTriangle,
  Layers,
  List,
  Radio,
  Search,
  Signal,
  SlidersHorizontal,
  Terminal,
  X,
} from 'lucide-react';
import { useLogsStore, type LogLevel } from '../../stores/logs';
import { useUIPreferencesStore } from '../../stores/uiPreferences';
import { t } from '../../lib/i18n';
import { Badge, Button, ButtonBase, FilterDropdown, Input, MultiFilterDropdown, TabButton, Toggle } from '@/components/ui';

const LOG_SOURCES = [
  'accounts',
  'registration',
  'patcher',
  'settings',
  'server',
  'system',
  'ai_proxy.process',
  'python_runner',
] as const;

const LOG_CHANNELS = ['all', 'app', 'frontend', 'backend', 'proxy', 'toast'] as const;

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
  toast: 'bg-pink-400',
};

interface LogFilterBarProps {
  tabCounts: {
    stream: number;
    grouped: number;
    errors: number;
    python: number;
  };
}

export function LogFilterBar({ tabCounts }: LogFilterBarProps) {
  const {
    logs,
    total,
    setFilter,
    resetFilter,
    groupingEnabled,
    autoCollapseSuccess,
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
    },
    setLogsLevelFilter,
    setLogsSourceFilter,
    setLogsChannelFilter,
    setLogsSearchQuery,
    setLogsSelectedTab,
    resetLogsFilters,
  } = useUIPreferencesStore();

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

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilter({ search: searchQuery || undefined });
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery, setFilter]);

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

  const handleResetFilters = useCallback(() => {
    resetLogsFilters();
    resetFilter();
  }, [resetFilter, resetLogsFilters]);

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

  return (
    <div className="px-6 pt-3 pb-2 border-b border-white/5 bg-vsc-bg/80 backdrop-blur-xl sticky top-0 z-20">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setLogsSearchQuery(e.target.value)
          }
          placeholder={t('logs.searchPlaceholder')}
          leftIcon={<Search className="w-4 h-4" />}
          containerClassName="flex-1 min-w-[200px] max-w-full"
          className="h-8 py-1 text-xs"
        />

        <FilterDropdown
          value={levelFilter}
          onChange={handleLevelChange}
          icon={<SlidersHorizontal size={14} />}
          label={t('logs.level')}
          triggerClassName="h-8 min-w-[120px]"
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
          triggerClassName="h-8 min-w-[160px]"
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
          triggerClassName="h-8 min-w-[120px]"
          showActiveState
          options={LOG_CHANNELS.map(channel => ({
            value: channel,
            label: channel === 'all' ? t('logs.allChannels') : channel,
            dot: CHANNEL_DOT_MAP[channel],
            count: channelCounts[channel] ?? 0,
          }))}
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
          label={`Grouped (${tabCounts.grouped})`}
          icon={<Layers size={14} />}
          className={selectedTab === 'grouped' ? 'text-indigo-200' : ''}
        />

        {selectedTab === 'grouped' && (
          <>
            <div className="w-px h-6 bg-white/10" />
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
          </>
        )}

        <TabButton
          active={selectedTab === 'errors'}
          onClick={() => setLogsSelectedTab('errors')}
          label={`Errors (${tabCounts.errors})`}
          icon={<AlertTriangle size={14} />}
          className={selectedTab === 'errors' ? 'text-red-200' : ''}
        />
        <TabButton
          active={selectedTab === 'python'}
          onClick={() => setLogsSelectedTab('python')}
          label={`Python jobs (${tabCounts.python})`}
          icon={<Terminal size={14} />}
          className={selectedTab === 'python' ? 'text-emerald-200' : ''}
        />

        <div className="w-px h-6 bg-white/10" />

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
      </div>
    </div>
  );
}
