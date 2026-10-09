/**
 * Devbox logs viewer — logs({source,filter,limit}) param binding through the
 * segmented source control and the debounced filter input.
 *
 * Mocks: safeInvoke (routed by command name), sonner. i18n runs REAL.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

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
import { DevboxLogs } from '@/components/devbox/DevboxLogs';
import { devboxRouter, devboxCallArgs, pageRoutes } from './devboxTestKit';

const invokeMock = safeInvoke as jest.Mock;

const logsFixture = {
  sources: [
    { name: 'bridge', lines: ['bridge up', 'tool call read'] },
    { name: 'ingress', lines: ['route /p/8787'] },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  invokeMock.mockImplementation(devboxRouter(pageRoutes({ logs: logsFixture })));
});

afterEach(() => {
  jest.useRealTimers();
});

describe('Devbox logs viewer', () => {
  it('fetches logs with the limit and renders source blocks', async () => {
    render(<DevboxLogs />);

    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'logs')).toEqual([
        { source: undefined, filter: undefined, limit: 200 },
      ]);
    });
    expect(await screen.findByTestId('devbox-logs-source-bridge')).toBeTruthy();
    expect(screen.getByTestId('devbox-logs-source-bridge').textContent).toContain('bridge up');
  });

  it('selecting a source refetches logs with the source param', async () => {
    render(<DevboxLogs />);
    await screen.findByTestId('devbox-logs-source-bridge');

    const segment = screen.getAllByText('ingress')[0];
    await act(async () => {
      fireEvent.click(segment);
    });

    await waitFor(() => {
      const args = devboxCallArgs(invokeMock, 'logs');
      expect(args[args.length - 1]).toEqual({ source: 'ingress', filter: undefined, limit: 200 });
    });
  });

  it('debounces the filter input into the logs filter param', async () => {
    jest.useFakeTimers();
    render(<DevboxLogs />);

    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'logs').length).toBeGreaterThanOrEqual(1);
    });

    const filter = screen.getByTestId('devbox-logs-filter');
    await act(async () => {
      fireEvent.change(filter, { target: { value: 'tool call' } });
    });
    const beforeDebounce = devboxCallArgs(invokeMock, 'logs').length;

    await act(async () => {
      jest.advanceTimersByTime(500);
      await Promise.resolve();
    });

    await waitFor(() => {
      const args = devboxCallArgs(invokeMock, 'logs');
      expect(args.length).toBeGreaterThan(beforeDebounce);
      expect(args[args.length - 1]).toEqual({
        source: undefined,
        filter: 'tool call',
        limit: 200,
      });
    });
  });

  it('shows the empty state when no lines come back', async () => {
    invokeMock.mockImplementation(
      devboxRouter(pageRoutes({ logs: { sources: [] } })),
    );
    render(<DevboxLogs />);

    expect(await screen.findByText('No logs yet')).toBeTruthy();
  });
});
