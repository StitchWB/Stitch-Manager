import { useEffect, useRef } from 'react';
import {
  Button,
  MultiFilterDropdown,
  Select,
  SegmentedControl,
  StickyToolbar,
  ToolbarTitle,
  ToolbarRow,
  ToolbarFiltersGroup,
  ToolbarSearchField,
  ToolbarSection,
} from '@/components/ui';
import { t } from '@/lib/i18n';
import type { ScenarioRecordItem } from '@/lib/backend/modules/pythonJobs';

type ReplayScenarioListPanelProps = {
  alias: string | null;
  items: ScenarioRecordItem[];
  loading: boolean;
  error: string | null;
  query: string;
  onQueryChange: (value: string) => void;
  sortBy: 'recent' | 'health' | 'steps';
  onSortChange: (value: 'recent' | 'health' | 'steps') => void;
  healthFilter: 'all' | 'valid' | 'errors';
  onHealthFilterChange: (value: 'all' | 'valid' | 'errors') => void;
  compactMode: boolean;
  onCompactModeChange: (value: boolean) => void;
  tagOptions: Array<{ value: string; label: string }>;
  selectedTags: string[];
  onSelectedTagsChange: (values: string[]) => void;
  filteredItems: ScenarioRecordItem[];
  selectedPath: string;
  onSelectPath: (value: string) => void;
  recentScenarioPaths: string[];
  scenarioPathEmpty: boolean;
  onRefresh: () => void;
  onSeedCurrent: () => void;
  onReindex: () => void;
  reindexing: boolean;
  formatScenarioName: (item: ScenarioRecordItem) => string;
  selectedPinned?: boolean;
};

export function ReplayScenarioListPanel({
  alias,
  items,
  loading,
  error,
  query,
  onQueryChange,
  sortBy,
  onSortChange,
  healthFilter,
  onHealthFilterChange,
  compactMode,
  onCompactModeChange,
  tagOptions,
  selectedTags,
  onSelectedTagsChange,
  filteredItems,
  selectedPath,
  onSelectPath,
  recentScenarioPaths,
  scenarioPathEmpty,
  onRefresh,
  onSeedCurrent,
  onReindex,
  reindexing,
  formatScenarioName,
  selectedPinned = false,
}: ReplayScenarioListPanelProps) {
  const listViewportRef = useRef<HTMLDivElement | null>(null);
  const selectedItemRef = useRef<HTMLDivElement | null>(null);

  const isSortOption = (value: string): value is 'recent' | 'health' | 'steps' => {
    return value === 'recent' || value === 'health' || value === 'steps';
  };

  const isHealthFilterOption = (value: string): value is 'all' | 'valid' | 'errors' => {
    return value === 'all' || value === 'valid' || value === 'errors';
  };

  const selectedPathKey = selectedPath.trim();
  const filteredCount = filteredItems.length;

  useEffect(() => {
    if (!selectedPathKey || filteredCount === 0) return;

    const viewport = listViewportRef.current;
    const selectedEl = selectedItemRef.current;
    if (!viewport || !selectedEl) return;

    const viewportRect = viewport.getBoundingClientRect();
    const selectedRect = selectedEl.getBoundingClientRect();
    if (selectedRect.top < viewportRect.top || selectedRect.bottom > viewportRect.bottom) {
      selectedEl.scrollIntoView({ block: 'nearest' });
    }
  }, [filteredCount, selectedPathKey]);

  return (
    <div className="space-y-3">
      <StickyToolbar topClassName="top-2" className="bg-black/45 p-3 space-y-3">
        <ToolbarSection
          className="gap-2"
          left={
            <ToolbarTitle
              eyebrow={t('recorder.replay.savedScenarios')}
              title={t('recorder.replay.pickScenario')}
            />
          }
          right={
            <Button size="xs" variant="secondary" onClick={onRefresh} disabled={!alias || loading}>
              {loading ? t('common.loading') : t('common.refresh')}
            </Button>
          }
        />

        <ToolbarRow>
          <div className="flex-1 min-w-0">
            <SegmentedControl
              size="sm"
              stretch={false}
              value={healthFilter}
              onChange={value => {
                if (isHealthFilterOption(value)) {
                  onHealthFilterChange(value);
                }
              }}
              options={[
                { label: t('recorder.replay.healthFilterAll'), value: 'all' },
                { label: t('recorder.replay.healthFilterValid'), value: 'valid' },
                { label: t('recorder.replay.healthFilterErrors'), value: 'errors' },
              ]}
            />
          </div>
          <Button size="xs" variant="secondary" onClick={() => onCompactModeChange(!compactMode)}>
            {compactMode
              ? t('recorder.replay.compactDisabled')
              : t('recorder.replay.compactEnabled')}
          </Button>
        </ToolbarRow>

        <ToolbarFiltersGroup>
          <MultiFilterDropdown
            values={selectedTags}
            onChange={onSelectedTagsChange}
            options={tagOptions}
            placeholder={t('recorder.replay.tagsFilterLabel')}
            triggerClassName="h-8"
            showActiveState
            showFooterActions
            renderValue={values =>
              values.length === 0 ? t('recorder.replay.tagsFilterLabel') : values.join(', ')
            }
          />
        </ToolbarFiltersGroup>

        <Select
          value={sortBy}
          onValueChange={value => {
            if (isSortOption(value)) {
              onSortChange(value);
            }
          }}
        >
          <option value="recent">{t('recorder.replay.sortRecent')}</option>
          <option value="health">{t('recorder.replay.sortHealth')}</option>
          <option value="steps">{t('recorder.replay.sortSteps')}</option>
        </Select>
      </StickyToolbar>

      {items.length > 0 ? (
        <>
          <ToolbarSearchField
            value={query}
            onValueChange={onQueryChange}
            placeholder={t('recorder.replay.searchPlaceholder')}
          />
          <div ref={listViewportRef} className="max-h-64 overflow-auto space-y-2 pr-1">
            {filteredItems.length > 0 ? (
              filteredItems.map(item => {
                const selected = selectedPath.trim() === item.scenarioPath;
                return (
                  <div
                    key={item.id}
                    ref={selected ? selectedItemRef : null}
                    className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors cursor-pointer ${
                      selected
                        ? 'border-indigo-500/50 bg-indigo-500/10'
                        : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'
                    }`}
                    onClick={() => onSelectPath(item.scenarioPath)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectPath(item.scenarioPath); }}}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          {item.favorite ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-400/20">
                              {t('common.star')}
                            </span>
                          ) : null}
                          <div
                            className={`${compactMode ? 'text-xs' : 'text-sm'} text-slate-200 truncate`}
                            title={formatScenarioName(item)}
                          >
                            {formatScenarioName(item)}
                          </div>
                        </div>
                        {!compactMode ? (
                          <div className="mt-1 text-[11px] text-slate-500 truncate">
                            {new Date(item.createdAt).toLocaleString()} • {item.scenarioPath}
                          </div>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-slate-400 whitespace-nowrap text-right pl-2">
                        <div>
                          {item.stepsCount} {t('recorder.replay.steps')}
                        </div>
                        <div>
                          {t('recorder.replay.healthShort')}:{' '}
                          <span
                            className={
                              item.missing
                                ? 'text-red-300'
                                : (item.healthScore ?? 100) >= 90
                                  ? 'text-emerald-300'
                                  : (item.healthScore ?? 100) >= 75
                                    ? 'text-amber-300'
                                    : 'text-red-300'
                            }
                          >
                            {item.healthScore ?? '—'}
                          </span>
                        </div>
                      </div>
                    </div>
                    {item.missing ? (
                      <div className="mt-1 text-[11px] text-amber-300">
                        {t('recorder.replay.missingFile')}
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <div className="text-xs text-slate-500 py-2">{t('recorder.replay.noMatches')}</div>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <div className="text-xs text-slate-500">{t('recorder.replay.emptySaved')}</div>
          {error ? (
            <div className="text-xs text-amber-300">
              {t('recorder.replay.indexLoadFailed', { error })}
            </div>
          ) : null}
          {!scenarioPathEmpty ? (
            <Button size="xs" variant="secondary" onClick={onSeedCurrent}>
              {t('recorder.replay.seedCurrent')}
            </Button>
          ) : null}
          <Button size="xs" variant="secondary" onClick={onReindex} disabled={!alias || reindexing}>
            {reindexing ? t('recorder.replay.reindexing') : t('recorder.replay.reindex')}
          </Button>
        </div>
      )}

      {items.length === 0 && recentScenarioPaths.length > 0 ? (
        <Select
          label={t('recorder.replay.recentScenarios')}
          value=""
          onValueChange={value => {
            if (!value) return;
            onSelectPath(value);
          }}
        >
          <option value="">{t('recorder.replay.selectRecent')}</option>
          {recentScenarioPaths.map(path => (
            <option key={path} value={path}>
              {path}
            </option>
          ))}
        </Select>
      ) : null}

      {selectedPinned ? (
        <div className="text-[11px] text-slate-500">{t('recorder.replay.selectedPinnedHint')}</div>
      ) : null}
    </div>
  );
}
