/**
 * Devbox permissions pending table — approve once / reject dispatch
 * permission_reply with the frozen decision params; honesty caption present.
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
import { DevboxPermissions } from '@/components/devbox/DevboxPermissions';
import { devboxRouter, devboxCallArgs, pageRoutes } from './devboxTestKit';

const invokeMock = safeInvoke as jest.Mock;

const pendingFixture = [
  { id: 'p1', tool: 'bash', summary: 'rm -rf build/', startedAt: 1791536987.76 },
];

beforeEach(() => {
  jest.clearAllMocks();
  invokeMock.mockImplementation(
    devboxRouter(
      pageRoutes({
        permissions_pending: pendingFixture,
        permission_reply: { accepted: true, actionId: 'act-p1' },
      }),
    ),
  );
});

describe('Devbox permissions pending', () => {
  it('renders pending rows with the observation honesty caption', async () => {
    render(<DevboxPermissions />);

    expect(await screen.findByText('bash')).toBeTruthy();
    expect(screen.getByText('rm -rf build/')).toBeTruthy();
    expect(screen.getByTestId('devbox-security-summary')).toBeTruthy();
    expect(screen.getByTestId('devbox-security-link')).toBeTruthy();
  });

  it('approve once dispatches permission_reply with decision=once', async () => {
    render(<DevboxPermissions />);
    await screen.findByText('bash');

    fireEvent.click(screen.getByTestId('devbox-permission-approve-p1'));

    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'permission_reply')).toEqual([
        { permissionId: 'p1', decision: 'once' },
      ]);
    });
  });

  it('reject dispatches permission_reply with decision=reject', async () => {
    render(<DevboxPermissions />);
    await screen.findByText('bash');

    fireEvent.click(screen.getByTestId('devbox-permission-reject-p1'));

    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'permission_reply')).toEqual([
        { permissionId: 'p1', decision: 'reject' },
      ]);
    });
  });

  it('shows the empty state when nothing is pending', async () => {
    invokeMock.mockImplementation(devboxRouter(pageRoutes()));
    render(<DevboxPermissions />);

    expect(await screen.findByText('No pending permission requests')).toBeTruthy();
  });
});
