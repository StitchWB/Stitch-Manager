/**
 * Devbox permissions pending table — props-driven from the batched poll;
 * approve once / reject dispatch permission_reply with the frozen decision
 * params; honesty caption present.
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
import type { DevboxObserved, DevboxPermissionRow } from '@/lib/backend/modules/devbox';
import {
  DevboxPermissions,
  type DevboxPermissionsProps,
} from '@/components/devbox/DevboxPermissions';
import { devboxRouter, devboxCalls, devboxCallArgs, pageRoutes } from './devboxTestKit';

const invokeMock = safeInvoke as jest.Mock;

const pendingFixture: DevboxPermissionRow[] = [
  { id: 'p1', tool: 'bash', summary: 'rm -rf build/', startedAt: 1791536987.76 },
];

function renderPermissions(props: Partial<DevboxPermissionsProps> = {}) {
  const onRetry = jest.fn(() => undefined);
  const data: DevboxObserved<DevboxPermissionRow> = { rows: pendingFixture, bridge: 'up' };
  render(<DevboxPermissions data={data} error={null} onRetry={onRetry} {...props} />);
  return onRetry;
}

beforeEach(() => {
  jest.clearAllMocks();
  invokeMock.mockImplementation(
    devboxRouter(pageRoutes({ permission_reply: { accepted: true, actionId: 'act-p1' } })),
  );
});

describe('Devbox permissions pending', () => {
  it('renders pending rows with the observation honesty caption', () => {
    renderPermissions();

    expect(screen.getByText('bash')).toBeTruthy();
    expect(screen.getByText('rm -rf build/')).toBeTruthy();
    expect(screen.getByTestId('devbox-security-summary')).toBeTruthy();
    expect(screen.getByTestId('devbox-security-link')).toBeTruthy();
  });

  it('approve once dispatches permission_reply with decision=once', async () => {
    renderPermissions();

    fireEvent.click(screen.getByTestId('devbox-permission-approve-p1'));

    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'permission_reply')).toEqual([
        { permissionId: 'p1', decision: 'once' },
      ]);
    });
  });

  it('reject is confirm-gated and dispatches permission_reply with decision=reject', async () => {
    renderPermissions();

    const reject = screen.getByTestId('devbox-permission-reject-p1');
    fireEvent.click(reject);
    expect(devboxCalls(invokeMock, 'permission_reply')).toHaveLength(0);
    fireEvent.click(reject);

    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'permission_reply')).toEqual([
        { permissionId: 'p1', decision: 'reject' },
      ]);
    });
  });

  it('shows the empty state when nothing is pending', () => {
    renderPermissions({ data: { rows: [], bridge: 'up' } });

    expect(screen.getByText('No pending permission requests')).toBeTruthy();
  });

  it('marks a bridge-down bundle and retries through the shared callback', () => {
    const onRetry = renderPermissions({ data: { rows: [], bridge: 'down' } });

    const degraded = screen.getByTestId('devbox-permissions-degraded');
    expect(degraded).toBeTruthy();
    fireEvent.click(degraded.querySelector('button')!);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the shared poll error in the section header with retry', () => {
    const onRetry = renderPermissions({ error: 'poll exploded' });

    const error = screen.getByTestId('devbox-permissions-error');
    expect(error.textContent).toContain('poll exploded');
    fireEvent.click(error.querySelector('button')!);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
