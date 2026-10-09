/**
 * Devbox jobs live table — job_cancel is confirm-gated and dispatches {jobId}.
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
import { DevboxJobs } from '@/components/devbox/DevboxJobs';
import { devboxRouter, devboxCalls, devboxCallArgs, pageRoutes } from './devboxTestKit';

const invokeMock = safeInvoke as jest.Mock;

const jobsFixture = [
  { id: 'j1', tool: 'bash', status: 'running', startedAt: 1791536987.76, sessionId: 'ses_1' },
];

beforeEach(() => {
  jest.clearAllMocks();
  invokeMock.mockImplementation(
    devboxRouter(
      pageRoutes({ jobs_live: jobsFixture, job_cancel: { accepted: true, actionId: 'act-j1' } }),
    ),
  );
});

describe('Devbox jobs live', () => {
  it('renders live rows and polls jobs_live', async () => {
    render(<DevboxJobs />);

    expect(await screen.findByText('ses_1')).toBeTruthy();
    expect(devboxCalls(invokeMock, 'jobs_live').length).toBeGreaterThanOrEqual(1);
  });

  it('cancel is confirm-gated and dispatches job_cancel with the jobId', async () => {
    render(<DevboxJobs />);
    await screen.findByText('ses_1');

    const cancel = screen.getByTestId('devbox-job-cancel-j1');
    fireEvent.click(cancel);
    expect(devboxCalls(invokeMock, 'job_cancel')).toHaveLength(0);

    fireEvent.click(cancel);
    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'job_cancel')).toEqual([{ jobId: 'j1' }]);
    });
  });

  it('shows the empty state when no jobs are live', async () => {
    invokeMock.mockImplementation(devboxRouter(pageRoutes()));
    render(<DevboxJobs />);

    expect(await screen.findByText('No active jobs')).toBeTruthy();
  });
});
