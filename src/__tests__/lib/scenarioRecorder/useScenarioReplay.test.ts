import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useScenarioReplay } from '../../../lib/scenarioRecorder/useScenarioReplay';

jest.mock('../../../lib/backend/modules/pythonJobs', () => ({
  startPythonJob: jest.fn(),
  cancelPythonJob: jest.fn(),
  getPythonJobStatus: jest.fn(),
  sendPythonJobControl: jest.fn(),
  appendScenarioRun: jest.fn(),
}));

import { startPythonJob } from '../../../lib/backend/modules/pythonJobs';

const startPythonJobMock = startPythonJob as any;

describe('useScenarioReplay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    startPythonJobMock.mockResolvedValue({ jobId: 'job-1' });
  });

  it('passes --from-step when provided and > 1', async () => {
    const { result } = renderHook(() => useScenarioReplay());

    await act(async () => {
      await result.current.start({
        alias: 'p1',
        scenarioPath: 'scenario://x',
        fromStep: 5,
      });
    });

    await waitFor(() => {
      expect(startPythonJobMock).toHaveBeenCalled();
    });

    const args = startPythonJobMock.mock.calls[0]?.[0]?.args as string[];
    expect(args).toContain('--from-step');
    expect(args).toContain('5');
  });

  it('does not pass --from-step when fromStep <= 1', async () => {
    const { result } = renderHook(() => useScenarioReplay());

    await act(async () => {
      await result.current.start({
        alias: 'p1',
        scenarioPath: 'scenario://x',
        fromStep: 1,
      });
    });

    const args = startPythonJobMock.mock.calls[0]?.[0]?.args as string[];
    expect(args).not.toContain('--from-step');
  });
});
