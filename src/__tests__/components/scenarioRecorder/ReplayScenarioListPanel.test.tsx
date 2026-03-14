import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { render } from '@testing-library/react';
import { ReplayScenarioListPanel } from '../../../components/scenarioRecorder/replay/ReplayScenarioListPanel';
import type { ScenarioRecordItem } from '../../../lib/tauri/modules/pythonJobs';

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
    healthScore: partial.healthScore ?? 90,
    missing: partial.missing ?? false,
    metadata: partial.metadata ?? null,
    activeVersion: partial.activeVersion,
  };
}

describe('ReplayScenarioListPanel auto-scroll', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    if (!('scrollIntoView' in HTMLElement.prototype)) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        writable: true,
        value: jest.fn(),
      });
    }
  });

  it('scrolls selected item into view when selection is outside viewport', () => {
    const scrollSpy = jest
      .spyOn(HTMLElement.prototype, 'scrollIntoView')
      .mockImplementation(() => undefined);

    const rectSpy = jest
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        const className = this.className || '';
        if (typeof className === 'string' && className.includes('max-h-64')) {
          return {
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: 300,
            bottom: 100,
            width: 300,
            height: 100,
            toJSON: () => ({}),
          } as DOMRect;
        }

        if (typeof className === 'string' && className.includes('border-indigo-500/50')) {
          return {
            x: 0,
            y: 0,
            top: 150,
            left: 0,
            right: 300,
            bottom: 180,
            width: 300,
            height: 30,
            toJSON: () => ({}),
          } as DOMRect;
        }

        return {
          x: 0,
          y: 0,
          top: 10,
          left: 0,
          right: 300,
          bottom: 30,
          width: 300,
          height: 20,
          toJSON: () => ({}),
        } as DOMRect;
      });

    const items = [
      makeItem({ id: 'one', scenarioPath: 'scenario://one', name: 'One' }),
      makeItem({ id: 'two', scenarioPath: 'scenario://two', name: 'Two' }),
    ];

    render(
      <ReplayScenarioListPanel
        alias="alias-1"
        items={items}
        loading={false}
        error={null}
        query=""
        onQueryChange={() => {}}
        sortBy="recent"
        onSortChange={() => {}}
        healthFilter="all"
        onHealthFilterChange={() => {}}
        compactMode={false}
        onCompactModeChange={() => {}}
        tagOptions={[]}
        selectedTags={[]}
        onSelectedTagsChange={() => {}}
        filteredItems={items}
        selectedPath="scenario://two"
        onSelectPath={() => {}}
        recentScenarioPaths={[]}
        scenarioPathEmpty={false}
        onRefresh={() => {}}
        onSeedCurrent={() => {}}
        onReindex={() => {}}
        reindexing={false}
        formatScenarioName={item => item.name}
      />
    );

    expect(scrollSpy).toHaveBeenCalled();

    scrollSpy.mockRestore();
    rectSpy.mockRestore();
  });
});
