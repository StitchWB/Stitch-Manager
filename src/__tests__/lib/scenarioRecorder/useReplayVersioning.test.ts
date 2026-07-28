import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useReplayVersioning } from '../../../lib/scenarioRecorder/useReplayVersioning';
import type { ScenarioRecordItem } from '../../../lib/backend/modules/pythonJobs';

jest.mock('../../../lib/backend/modules/pythonJobs', () => ({
  listScenarioRevisions: jest.fn(),
  rollbackRecordedScenario: jest.fn(),
}));

import {
  listScenarioRevisions,
  rollbackRecordedScenario,
} from '../../../lib/backend/modules/pythonJobs';

const listScenarioRevisionsMock = listScenarioRevisions as any;
const rollbackRecordedScenarioMock = rollbackRecordedScenario as any;

function makeScenario(activeVersion: number): ScenarioRecordItem {
  return {
    id: 's1',
    alias: 'a',
    name: 'n',
    scenarioPath: 'scenario://x',
    stepsCount: 1,
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-02T00:00:00Z',
    playCount: 0,
    favorite: false,
    missing: false,
    activeVersion,
  };
}

describe('useReplayVersioning', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads versions and marks active one', async () => {
    listScenarioRevisionsMock.mockResolvedValue([
      {
        id: 1,
        scenarioId: 's1',
        versionNo: 1,
        reason: null,
        snapshotJson: '{}',
        createdAt: '2026-03-01T10:00:00Z',
      },
      {
        id: 2,
        scenarioId: 's1',
        versionNo: 2,
        reason: null,
        snapshotJson: '{}',
        createdAt: '2026-03-02T10:00:00Z',
      },
    ]);

    const { result } = renderHook(() =>
      useReplayVersioning({
        isOpen: true,
        scenario: makeScenario(2),
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.versions).toHaveLength(2);
      expect(result.current.versions.find(v => v.versionNo === 2)?.isActive).toBe(true);
    });
  });

  it('rolls back selected version', async () => {
    rollbackRecordedScenarioMock.mockResolvedValue(makeScenario(1));

    const { result } = renderHook(() =>
      useReplayVersioning({
        isOpen: true,
        scenario: makeScenario(2),
      })
    );

    await act(async () => {
      const updated = await result.current.rollback(1);
      expect(updated?.activeVersion).toBe(1);
    });

    expect(rollbackRecordedScenario).toHaveBeenCalledWith({ scenarioId: 's1', versionNo: 1 });
  });

  it('resolves runnable data from selected revision snapshot', async () => {
    listScenarioRevisionsMock.mockResolvedValue([
      {
        id: 2,
        scenarioId: 's1',
        versionNo: 2,
        reason: null,
        snapshotJson: JSON.stringify({
          scenarioPath: 'scenario://v2',
          startedUrl: 'https://v2.example',
        }),
        createdAt: '2026-03-02T10:00:00Z',
      },
    ]);

    const { result } = renderHook(() =>
      useReplayVersioning({
        isOpen: true,
        scenario: makeScenario(2),
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const selected = result.current.selectVersion(2);
    expect(selected?.scenarioPath).toBe('scenario://v2');
    expect(selected?.startedUrl).toBe('https://v2.example');
  });
});
