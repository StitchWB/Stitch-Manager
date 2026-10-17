/**
 * Devbox now-rail — active job card with live elapsed timer, permission alert
 * approve/reject through the page onAction, one-time security banner persisted
 * in localStorage, recent events tail and the go-infra link.
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
import type {
  DevboxAccepted,
  DevboxEventRow,
  DevboxJobRow,
  DevboxObserved,
  DevboxPermissionRow,
} from '@/lib/backend/modules/devbox';
import { DevboxNowRail, type DevboxNowRailProps } from '@/components/devbox/DevboxNowRail';
import {
  devboxRouter,
  devboxCalls,
  devboxCallArgs,
  pageRoutes,
  pendingPermissionFixture,
  runningJobFixture,
} from './devboxTestKit';

const invokeMock = safeInvoke as jest.Mock;
const BANNER_KEY = 'devbox.securityBannerDismissed';
const NOW_MS = 1791537000000;
const STARTED_SEC = 1791536987.76;

function observed<T>(rows: T[], bridge: 'up' | 'down' = 'up'): DevboxObserved<T> {
  return { rows, bridge };
}

function renderRail(props: Partial<DevboxNowRailProps> = {}) {
  const onAction = jest.fn((_action: Promise<DevboxAccepted>) => undefined);
  const onGoInfra = jest.fn(() => undefined);
  render(
    <DevboxNowRail
      jobs={observed<DevboxJobRow>([])}
      permissions={observed<DevboxPermissionRow>([])}
      events={[]}
      busy={false}
      onAction={onAction as unknown as (action: Promise<DevboxAccepted>) => void}
      onGoInfra={onGoInfra}
      {...props}
    />,
  );
  return { onAction, onGoInfra };
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  invokeMock.mockImplementation(
    devboxRouter(
      pageRoutes({
        permission_reply: { accepted: true, actionId: 'act-p1' },
        job_cancel: { accepted: true, actionId: 'act-j1' },
      }),
    ),
  );
});

afterEach(() => {
  jest.useRealTimers();
});

describe('DevboxNowRail active job', () => {
  it('renders the running job with a ticking elapsed timer', () => {
    jest.useFakeTimers().setSystemTime(NOW_MS);
    renderRail({ jobs: observed([runningJobFixture(STARTED_SEC)]) });

    expect(screen.getByTestId('devbox-rail-active-job')).toBeTruthy();
    expect(screen.getByText('bash')).toBeTruthy();
    expect(screen.getByTestId('devbox-rail-elapsed').textContent).toBe('Elapsed 00:12');
    expect(screen.getByTestId('devbox-rail-progress')).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId('devbox-rail-elapsed').textContent).toBe('Elapsed 00:13');
  });

  it('shows the idle state when nothing is running', () => {
    renderRail();

    expect(screen.queryByTestId('devbox-rail-active-job')).toBeNull();
    expect(screen.getByText('Agent is idle')).toBeTruthy();
  });

  it('cancel is confirm-gated and dispatches job_cancel with the jobId', async () => {
    renderRail({ jobs: observed([runningJobFixture(STARTED_SEC)]) });

    const cancel = screen.getByTestId('devbox-job-cancel-j1');
    fireEvent.click(cancel);
    expect(devboxCalls(invokeMock, 'job_cancel')).toHaveLength(0);

    fireEvent.click(cancel);
    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'job_cancel')).toEqual([{ jobId: 'j1' }]);
    });
  });

  it('marks a bridge-down jobs bundle', () => {
    renderRail({ jobs: observed([], 'down') });

    expect(screen.getByTestId('devbox-rail-jobs-degraded')).toBeTruthy();
  });
});

describe('DevboxNowRail permissions', () => {
  it('approve dispatches permission_reply with decision=once through onAction', async () => {
    const { onAction } = renderRail({ permissions: observed([pendingPermissionFixture()]) });

    expect(screen.getByText('rm -rf build/')).toBeTruthy();
    fireEvent.click(screen.getByTestId('devbox-permission-approve-p1'));

    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'permission_reply')).toEqual([
        { permissionId: 'p1', decision: 'once' },
      ]);
    });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('reject is confirm-gated and dispatches decision=reject', async () => {
    renderRail({ permissions: observed([pendingPermissionFixture()]) });

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
});

describe('DevboxNowRail security banner', () => {
  it('dismiss persists to localStorage and hides the banner on next render', () => {
    renderRail();
    expect(screen.getByTestId('devbox-security-banner')).toBeTruthy();

    fireEvent.click(screen.getByTestId('devbox-security-banner-close'));
    expect(screen.queryByTestId('devbox-security-banner')).toBeNull();
    expect(localStorage.getItem(BANNER_KEY)).toBe('1');

    renderRail();
    const banners = screen.queryAllByTestId('devbox-security-banner');
    expect(banners).toHaveLength(0);
  });
});

describe('DevboxNowRail recent activity', () => {
  const events: DevboxEventRow[] = Array.from({ length: 7 }, (_, i) => ({
    ts: 1791536980 + i,
    kind: 'tool_call',
    tool: `tool${i}`,
    status: 'ok',
  }));

  it('shows only the last 5 events and switches to infra on the link', () => {
    const { onGoInfra } = renderRail({ events });

    expect(screen.queryByText(/tool1/)).toBeNull();
    expect(screen.getByText(/tool2/)).toBeTruthy();
    expect(screen.getByText(/tool6/)).toBeTruthy();

    fireEvent.click(screen.getByTestId('devbox-rail-go-infra'));
    expect(onGoInfra).toHaveBeenCalledTimes(1);
  });
});
