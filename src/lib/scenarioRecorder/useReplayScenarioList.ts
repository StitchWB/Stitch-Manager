import { useMemo } from 'react';
import type { ScenarioRecordItem } from '@/lib/tauri/modules/pythonJobs';
import type { ReplayListHealthFilter, ReplayListSort } from './replayListPreferences';

type UseReplayScenarioListParams = {
  items: ScenarioRecordItem[];
  query: string;
  selectedTags?: string[];
  healthFilter: ReplayListHealthFilter;
  sortBy: ReplayListSort;
  selectedPath: string;
  validHealthThreshold?: number;
};

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

function scenarioTimestamp(item: ScenarioRecordItem): number {
  const ts = Date.parse(item.updatedAt || item.createdAt);
  return Number.isFinite(ts) ? ts : 0;
}

function applyHealthFilter(
  item: ScenarioRecordItem,
  filter: ReplayListHealthFilter,
  validHealthThreshold: number
): boolean {
  const isValid =
    !item.missing && (item.healthScore == null || item.healthScore >= validHealthThreshold);
  const hasErrors =
    item.missing || (item.healthScore != null && item.healthScore < validHealthThreshold);

  if (filter === 'valid') return isValid;
  if (filter === 'errors') return hasErrors;
  return true;
}

function sortScenarios(items: ScenarioRecordItem[], sortBy: ReplayListSort): ScenarioRecordItem[] {
  const sorted = [...items];

  if (sortBy === 'health') {
    sorted.sort((a, b) => {
      const favoriteDelta = Number(b.favorite) - Number(a.favorite);
      if (favoriteDelta !== 0) return favoriteDelta;

      const healthDelta = (b.healthScore ?? -1) - (a.healthScore ?? -1);
      if (healthDelta !== 0) return healthDelta;

      return scenarioTimestamp(b) - scenarioTimestamp(a);
    });
    return sorted;
  }

  if (sortBy === 'steps') {
    sorted.sort((a, b) => {
      const favoriteDelta = Number(b.favorite) - Number(a.favorite);
      if (favoriteDelta !== 0) return favoriteDelta;

      const stepsDelta = b.stepsCount - a.stepsCount;
      if (stepsDelta !== 0) return stepsDelta;

      return scenarioTimestamp(b) - scenarioTimestamp(a);
    });
    return sorted;
  }

  sorted.sort((a, b) => {
    const favoriteDelta = Number(b.favorite) - Number(a.favorite);
    if (favoriteDelta !== 0) return favoriteDelta;

    return scenarioTimestamp(b) - scenarioTimestamp(a);
  });
  return sorted;
}

export function useReplayScenarioList({
  items,
  query,
  selectedTags = [],
  healthFilter,
  sortBy,
  selectedPath,
  validHealthThreshold = 85,
}: UseReplayScenarioListParams) {
  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const activeTags = selectedTags.map(normalizeTag).filter(Boolean);
    const filtered = items.filter(item => {
      if (!applyHealthFilter(item, healthFilter, validHealthThreshold)) {
        return false;
      }

      if (activeTags.length > 0) {
        const tags = (item.metadata?.tags ?? []).map(normalizeTag);
        const hasAllTags = activeTags.every(tag => tags.includes(tag));
        if (!hasAllTags) {
          return false;
        }
      }

      const tagsBlob = (item.metadata?.tags ?? []).join(' ').toLowerCase();

      return (
        item.name.toLowerCase().includes(q) ||
        item.scenarioPath.toLowerCase().includes(q) ||
        (item.startedUrl ?? '').toLowerCase().includes(q) ||
        tagsBlob.includes(q)
      );
    });

    return sortScenarios(filtered, sortBy);
  }, [healthFilter, items, query, selectedTags, sortBy, validHealthThreshold]);

  const selectedPinned = useMemo(() => {
    const selected = selectedPath.trim();
    if (!selected) return false;
    return filteredItems.findIndex(item => item.scenarioPath === selected) > 0;
  }, [filteredItems, selectedPath]);

  const displayItems = useMemo(() => {
    const selected = selectedPath.trim();
    if (!selected) return filteredItems;

    const selectedItem = filteredItems.find(item => item.scenarioPath === selected);
    if (!selectedItem) return filteredItems;

    return [
      selectedItem,
      ...filteredItems.filter(item => item.scenarioPath !== selectedItem.scenarioPath),
    ];
  }, [filteredItems, selectedPath]);

  return {
    filteredItems,
    displayItems,
    selectedPinned,
  };
}

type FriendlyNameOptions = {
  deriveScenarioNameFromPath: (path: string) => string;
  defaultScenarioName: string;
  scenarioLabel: string;
};

export function deriveFriendlyScenarioName(
  item: ScenarioRecordItem,
  options: FriendlyNameOptions
): string {
  const { deriveScenarioNameFromPath, defaultScenarioName, scenarioLabel } = options;
  const raw = (item.name || '').trim();
  const normalizedRaw = raw.toLowerCase();
  const looksRaw =
    !raw || normalizedRaw.endsWith('.json') || normalizedRaw.includes('scenario') || raw.length < 3;
  if (!looksRaw) return raw;

  const fromPath = deriveScenarioNameFromPath(item.scenarioPath);
  if (fromPath && fromPath !== defaultScenarioName) return fromPath;

  const date = item.createdAt ? new Date(item.createdAt).toLocaleDateString() : null;
  return date ? `${scenarioLabel} ${date}` : defaultScenarioName;
}
