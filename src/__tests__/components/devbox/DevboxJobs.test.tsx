/**
 * Devbox jobs live table — props-driven from the batched poll; job_cancel is
 * confirm-gated and dispatches {jobId}.
 *
 * Mocks: safeInvoke (routed by command name), sonner. i18n runs REAL.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

jest.mock('@/lib/backend/core/invoke', () => ({
  safeInvoke: jest.fn(),
  safeInvokeWithRetry: jest.fn(),
  batchInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));

import { safeInvoke } from '@/lib/backend/core/invoke';
import type { DevboxJobRow, DevboxObserved } from '@/lib/backend/modules/devbox';
import { DevboxJobs, type DevboxJobsProps } from '@/components/devbox/DevboxJobs';
import { devboxRouter, devboxCalls, devboxCallArgs, pageRoutes } from './devboxTestKit';

const invokeMock = safeInvoke as jest.Mock;

const jobsFixture: DevboxJobRow[] = [
  { id: 'j1', tool: 'bash', status: 'running', startedAt: 1791536987.76, sessionId: 'ses_1' },
];

function renderJobs(props: Partial<DevboxJobsProps> = {}) {
  const onRetry = jest.fn(() => undefined);
  const data: DevboxObserved<DevboxJobRow> = { rows: jobsFixture, bridge: 'up' };
  render(<DevboxJobs data={data} error={null} onRetry={onRetry} {...props} />);
  return onRetry;
}

beforeEach(() => {
  jest.clearAllMocks();
  invokeMock.mockImplementation(
    devboxRouter(pageRoutes({ job_cancel: { accepted: true, actionId: 'act-j1' } })),
  );
});

describe('Devbox jobs live', () => {
  it('renders the rows passed from the poll bundle', () => {
    renderJobs();

    expect(screen.getByText('ses_1')).toBeTruthy();
    expect(screen.getByText('bash')).toBeTruthy();
  });

  it('cancel is confirm-gated and dispatches job_cancel with the jobId', async () => {
    renderJobs();

    const cancel = screen.getByTestId('devbox-job-cancel-j1');
    fireEvent.click(cancel);
    expect(devboxCalls(invokeMock, 'job_cancel')).toHaveLength(0);

    fireEvent.click(cancel);
    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'job_cancel')).toEqual([{ jobId: 'j1' }]);
    });
  });

  it('shows the empty state when no jobs are live', () => {
    renderJobs({ data: { rows: [], bridge: 'up' } });

    expect(screen.getByText('No active jobs')).toBeTruthy();
  });

  it('marks a bridge-down bundle and retries through the shared callback', () => {
    const onRetry = renderJobs({ data: { rows: [], bridge: 'down' } });

    const degraded = screen.getByTestId('devbox-jobs-degraded');
    expect(degraded).toBeTruthy();
    fireEvent.click(degraded.querySelector('button')!);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the shared poll error in the section header with retry', () => {
    const onRetry = renderJobs({ error: 'poll exploded' });

    const error = screen.getByTestId('devbox-jobs-error');
    expect(error.textContent).toContain('poll exploded');
    fireEvent.click(error.querySelector('button')!);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
