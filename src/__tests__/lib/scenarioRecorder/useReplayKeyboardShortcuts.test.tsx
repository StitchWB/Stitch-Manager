import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { ScenarioRecordItem } from '../../../lib/backend/modules/pythonJobs';
import {
  useReplayListNavigation,
  useReplayStartHotkey,
} from '../../../lib/scenarioRecorder/useReplayKeyboardShortcuts';

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

function StartHotkeyHarness(props: { isOpen: boolean; canStart: boolean; onStart: () => void }) {
  useReplayStartHotkey(props);
  return (
    <div>
      <input aria-label="name" />
      <textarea aria-label="notes" />
    </div>
  );
}

function ListNavHarness(props: {
  isOpen: boolean;
  items: ScenarioRecordItem[];
  initialSelectedPath: string;
  onSelectPath?: (value: string) => void;
}) {
  const [selected, setSelected] = useState(props.initialSelectedPath);
  useReplayListNavigation({
    isOpen: props.isOpen,
    items: props.items,
    selectedPath: selected,
    onSelectPath: value => {
      setSelected(value);
      props.onSelectPath?.(value);
    },
  });

  return (
    <div>
      <span data-testid="selected-path">{selected}</span>
      <input aria-label="query" />
    </div>
  );
}

describe('useReplayStartHotkey', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('triggers on Ctrl+Enter when open and start allowed', () => {
    const onStart = jest.fn();
    render(<StartHotkeyHarness isOpen canStart onStart={onStart} />);

    act(() => {
      fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true });
    });

    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('does not trigger when event comes from input field', () => {
    const onStart = jest.fn();
    const { getByLabelText } = render(<StartHotkeyHarness isOpen canStart onStart={onStart} />);

    const input = getByLabelText('name');
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    });

    expect(onStart).not.toHaveBeenCalled();
  });
});

describe('useReplayListNavigation', () => {
  const items = [
    makeItem({ id: 'one', scenarioPath: 'scenario://one' }),
    makeItem({ id: 'two', scenarioPath: 'scenario://two' }),
  ];

  it('moves selection with ArrowDown/ArrowUp', async () => {
    const { getByTestId } = render(
      <ListNavHarness isOpen items={items} initialSelectedPath="scenario://one" />
    );

    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowDown' });
    });
    await waitFor(() => {
      expect(getByTestId('selected-path').textContent).toBe('scenario://two');
    });

    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowUp' });
    });
    await waitFor(() => {
      expect(getByTestId('selected-path').textContent).toBe('scenario://one');
    });
  });

  it('ignores Arrow keys when focused in input field', () => {
    const onSelectPath = jest.fn();
    const { getByLabelText, getByTestId } = render(
      <ListNavHarness
        isOpen
        items={items}
        initialSelectedPath="scenario://one"
        onSelectPath={onSelectPath}
      />
    );

    const input = getByLabelText('query');
    act(() => {
      fireEvent.keyDown(input, { key: 'ArrowDown' });
    });

    expect(onSelectPath).not.toHaveBeenCalled();
    expect(getByTestId('selected-path').textContent).toBe('scenario://one');
  });

  it('selects first item on Enter when nothing selected', async () => {
    const { getByTestId } = render(<ListNavHarness isOpen items={items} initialSelectedPath="" />);

    act(() => {
      fireEvent.keyDown(window, { key: 'Enter' });
    });

    await waitFor(() => {
      expect(getByTestId('selected-path').textContent).toBe('scenario://one');
    });
  });
});
