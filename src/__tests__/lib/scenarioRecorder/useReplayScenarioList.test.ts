import { describe, it, expect } from '@jest/globals';
import { renderHook } from '@testing-library/react';
import type { ScenarioRecordItem } from '../../../lib/tauri/modules/pythonJobs';
import {
  deriveFriendlyScenarioName,
  useReplayScenarioList,
} from '../../../lib/scenarioRecorder/useReplayScenarioList';

function makeItem(partial: Partial<ScenarioRecordItem>): ScenarioRecordItem {
  return {
    id: partial.id ?? 'id',
    alias: partial.alias ?? 'alias-1',
    name: partial.name ?? 'Scenario Name',
    scenarioPath: partial.scenarioPath ?? 'scenario://default',
    runId: partial.runId ?? null,
    startedUrl: partial.startedUrl ?? null,
    stepsCount: partial.stepsCount ?? 5,
    createdAt: partial.createdAt ?? '2026-03-09T10:00:00.000Z',
    updatedAt: partial.updatedAt ?? '2026-03-09T10:00:00.000Z',
    lastPlayedAt: partial.lastPlayedAt ?? null,
    playCount: partial.playCount ?? 0,
    favorite: partial.favorite ?? false,
    healthScore: partial.healthScore ?? null,
    missing: partial.missing ?? false,
    metadata: partial.metadata ?? null,
    activeVersion: partial.activeVersion,
  };
}

describe('useReplayScenarioList', () => {
  it('filters by health state (valid/errors)', () => {
    const items: ScenarioRecordItem[] = [
      makeItem({ id: 'good', healthScore: 96, missing: false }),
      makeItem({ id: 'bad', healthScore: 60, missing: false }),
      makeItem({ id: 'missing', healthScore: null, missing: true }),
    ];

    const valid = renderHook(() =>
      useReplayScenarioList({
        items,
        query: '',
        healthFilter: 'valid',
        sortBy: 'recent',
        selectedPath: '',
      })
    );
    expect(valid.result.current.filteredItems.map(i => i.id)).toEqual(['good']);

    const errors = renderHook(() =>
      useReplayScenarioList({
        items,
        query: '',
        healthFilter: 'errors',
        sortBy: 'recent',
        selectedPath: '',
      })
    );
    expect(errors.result.current.filteredItems.map(i => i.id)).toEqual(['bad', 'missing']);
  });

  it('sorts with favorite priority even in health mode', () => {
    const items: ScenarioRecordItem[] = [
      makeItem({
        id: 'best-health',
        healthScore: 99,
        favorite: false,
        updatedAt: '2026-03-09T10:00:00.000Z',
      }),
      makeItem({
        id: 'favorite-low',
        healthScore: 20,
        favorite: true,
        updatedAt: '2026-03-09T09:00:00.000Z',
      }),
      makeItem({
        id: 'middle',
        healthScore: 80,
        favorite: false,
        updatedAt: '2026-03-09T11:00:00.000Z',
      }),
    ];

    const { result } = renderHook(() =>
      useReplayScenarioList({
        items,
        query: '',
        healthFilter: 'all',
        sortBy: 'health',
        selectedPath: '',
      })
    );

    expect(result.current.filteredItems.map(i => i.id)).toEqual([
      'favorite-low',
      'best-health',
      'middle',
    ]);
  });

  it('pins selected scenario to top in display items', () => {
    const items: ScenarioRecordItem[] = [
      makeItem({
        id: 'older',
        scenarioPath: 'scenario://older',
        updatedAt: '2026-03-09T09:00:00.000Z',
      }),
      makeItem({
        id: 'newer',
        scenarioPath: 'scenario://newer',
        updatedAt: '2026-03-09T12:00:00.000Z',
      }),
    ];

    const { result } = renderHook(() =>
      useReplayScenarioList({
        items,
        query: '',
        healthFilter: 'all',
        sortBy: 'recent',
        selectedPath: 'scenario://older',
      })
    );

    expect(result.current.selectedPinned).toBe(true);
    expect(result.current.displayItems.map(i => i.id)).toEqual(['older', 'newer']);
  });

  it('filters by query across name/path/url', () => {
    const items: ScenarioRecordItem[] = [
      makeItem({ id: 'name-hit', name: 'WB Login', scenarioPath: 'scenario://a' }),
      makeItem({
        id: 'url-hit',
        name: 'Something else',
        scenarioPath: 'scenario://b',
        startedUrl: 'https://example.com/replay',
      }),
    ];

    const { result } = renderHook(() =>
      useReplayScenarioList({
        items,
        query: 'example.com/replay',
        healthFilter: 'all',
        sortBy: 'recent',
        selectedPath: '',
      })
    );

    expect(result.current.filteredItems.map(i => i.id)).toEqual(['url-hit']);
  });

  it('filters by selected tags', () => {
    const items: ScenarioRecordItem[] = [
      makeItem({ id: 'auth', metadata: { tags: ['auth', 'smoke'] } }),
      makeItem({ id: 'checkout', metadata: { tags: ['checkout'] } }),
      makeItem({ id: 'auth2', metadata: { tags: ['auth', 'regression'] } }),
    ];

    const { result } = renderHook(() =>
      useReplayScenarioList({
        items,
        query: '',
        selectedTags: ['auth'],
        healthFilter: 'all',
        sortBy: 'recent',
        selectedPath: '',
      })
    );

    expect(result.current.filteredItems.map(i => i.id)).toEqual(['auth', 'auth2']);
  });
});

describe('deriveFriendlyScenarioName', () => {
  const deriveScenarioNameFromPath = (path: string) =>
    path.replace(/^.*[\\/]/, '').replace(/\.json$/i, '');

  it('keeps human-provided name', () => {
    const item = makeItem({ name: 'Авторизация WB', scenarioPath: 'scenario://raw_123' });
    const value = deriveFriendlyScenarioName(item, {
      deriveScenarioNameFromPath,
      defaultScenarioName: 'scenario',
      scenarioLabel: 'Сценарий',
    });
    expect(value).toBe('Авторизация WB');
  });

  it('falls back to path-derived name for raw names', () => {
    const item = makeItem({
      name: 'scenario_17420000.json',
      scenarioPath: 'scenario://wb_login_1',
    });
    const value = deriveFriendlyScenarioName(item, {
      deriveScenarioNameFromPath,
      defaultScenarioName: 'scenario',
      scenarioLabel: 'Сценарий',
    });
    expect(value).toBe('wb_login_1');
  });
});
