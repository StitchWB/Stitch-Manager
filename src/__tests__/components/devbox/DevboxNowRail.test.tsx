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
import { t } from '@/lib/i18n';
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
  const onPermissionReply = jest.fn((_id: string, _decision: 'once' | 'reject') => undefined);
  const onGoInfra = jest.fn(() => undefined);
  render(
    <DevboxNowRail
      jobs={observed<DevboxJobRow>([])}
      permissions={observed<DevboxPermissionRow>([])}
      events={[]}
      busy={false}
      onAction={onAction as unknown as (action: Promise<DevboxAccepted>) => void}
      onPermissionReply={onPermissionReply}
      onGoInfra={onGoInfra}
      {...props}
    />,
  );
  return { onAction, onPermissionReply, onGoInfra };
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  invokeMock.mockImplementation(
    devboxRouter(
      pageRoutes({
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

  it('shows the 4-step quick guide when there is no job, no permissions and no events', () => {
    renderRail();

    expect(screen.queryByTestId('devbox-rail-active-job')).toBeNull();
    const onboarding = screen.getByTestId('devbox-rail-onboarding');
    expect(onboarding.textContent).toContain(t('devboxPage.railOnboard1'));
    expect(onboarding.textContent).toContain(t('devboxPage.railOnboard2'));
    expect(onboarding.textContent).toContain(t('devboxPage.railOnboard3'));
    expect(onboarding.textContent).toContain(t('devboxPage.railOnboard4'));
    expect(onboarding.children).toHaveLength(4);
    expect(screen.queryByText('Agent is idle')).toBeNull();
  });

  it('falls back to the idle card when events exist but no job is running', () => {
    renderRail({ events: [{ ts: 1791536980, kind: 'note', status: 'weird' }] });

    expect(screen.queryByTestId('devbox-rail-onboarding')).toBeNull();
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
  it('approve calls onPermissionReply with the row id and decision=once', () => {
    const { onPermissionReply } = renderRail({
      permissions: observed([pendingPermissionFixture()]),
    });

    expect(screen.getByText('rm -rf build/')).toBeTruthy();
    fireEvent.click(screen.getByTestId('devbox-permission-approve-p1'));

    expect(onPermissionReply).toHaveBeenCalledWith('p1', 'once');
  });

  it('reject is confirm-gated and calls onPermissionReply with decision=reject', () => {
    const { onPermissionReply } = renderRail({
      permissions: observed([pendingPermissionFixture()]),
    });

    const reject = screen.getByTestId('devbox-permission-reject-p1');
    fireEvent.click(reject);
    expect(onPermissionReply).not.toHaveBeenCalled();
    fireEvent.click(reject);

    expect(onPermissionReply).toHaveBeenCalledWith('p1', 'reject');
  });

  it('disables both permission buttons while the permissions bridge is down', () => {
    renderRail({ permissions: observed([pendingPermissionFixture()], 'down') });

    expect(screen.getByTestId('devbox-permission-approve-p1')).toBeDisabled();
    expect(screen.getByTestId('devbox-permission-reject-p1')).toBeDisabled();
    expect(screen.getByTestId('devbox-rail-permissions-degraded')).toBeTruthy();
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

  it('renders the disclaimer at the top, directly under the bridge summary', () => {
    renderRail({ events: [{ ts: 1791536980, kind: 'tool_call', tool: 'bash', status: 'ok' }] });

    const banner = screen.getByTestId('devbox-security-banner');
    const summary = screen.getByTestId('devbox-rail-bridge-summary');
    expect(banner.previousElementSibling).toBe(summary);
    expect(screen.getByTestId('devbox-rail-recent')).toBeTruthy();
  });
});

describe('DevboxNowRail recent activity', () => {
  const events: DevboxEventRow[] = Array.from({ length: 7 }, (_, i) => ({
    ts: 1791536980 + i,
    kind: 'tool_call',
    tool: `tool${i}`,
    status: 'ok',
  }));

  it('shows only the last 5 events newest-first and switches to infra on the link', () => {
    const { onGoInfra } = renderRail({ events });

    expect(screen.queryByText(/tool1/)).toBeNull();
    expect(screen.getByText(/tool2/)).toBeTruthy();
    expect(screen.getByText(/tool6/)).toBeTruthy();

    const cards = screen.getAllByTestId('devbox-rail-event-card');
    expect(cards).toHaveLength(5);
    expect(cards[0].textContent).toContain('tool6');
    expect(cards[4].textContent).toContain('tool2');

    fireEvent.click(screen.getByTestId('devbox-rail-go-infra'));
    expect(onGoInfra).toHaveBeenCalledTimes(1);
  });

  it('renders timeline rows as compact py-1 lines with a status icon and time per event', () => {
    renderRail({
      events: [
        { ts: 1791536980, kind: 'tool_call', tool: 'bash', status: 'ok' },
        { ts: 1791536981, kind: 'tool_call', tool: 'git', status: 'failed' },
        { ts: 1791536982, kind: 'job', tool: 'pytest', status: 'running' },
        { ts: 1791536983, kind: 'note', status: 'weird' },
      ],
    });

    const icons = screen.getAllByTestId('devbox-rail-event-icon');
    expect(icons.map(icon => icon.getAttribute('data-tone'))).toEqual([
      'other',
      'running',
      'failed',
      'ok',
    ]);

    const cards = screen.getAllByTestId('devbox-rail-event-card');
    expect(cards).toHaveLength(4);
    expect(cards[0].className).toContain('py-1');
    expect(cards[0].className).toContain('text-2xs');
    expect(cards[0].className).not.toContain('rounded-lg');
    expect(cards[0].className).not.toContain('border');

    for (const card of cards) {
      expect(card.className).toContain('relative');
      expect(card.className).toContain('after:absolute');
      expect(card.className).toContain('after:left-[5px]');
      expect(card.className).toContain('after:top-[10px]');
      expect(card.className).toContain('after:h-full');
      expect(card.className).toContain('after:w-px');
      expect(card.className).toContain('after:bg-white/10');
    }
    expect(cards[cards.length - 1].className).toContain('last:after:hidden');

    const rows = screen.getByTestId('devbox-rail-recent');
    expect(rows.className).not.toContain('before:');
    expect(rows.textContent).toContain('bash · ok');
    expect(rows.textContent).toContain('git · failed');
    expect(rows.textContent).toContain('note · weird');
    expect(rows.querySelector('.font-mono')).toBeNull();
  });
});

describe('DevboxNowRail bridge summary', () => {
  it('counts only event rows carrying a tool name', () => {
    renderRail({
      events: [
        { ts: 1791536980, kind: 'tool_call', tool: 'bash', status: 'ok' },
        { ts: 1791536981, kind: 'tool_call', tool: 'git', status: 'failed' },
        { ts: 1791536982, kind: 'note', status: 'weird' },
        { ts: 1791536983, kind: 'tool_call', tool: '', status: 'ok' },
      ],
    });

    expect(screen.getByTestId('devbox-rail-bridge-summary').textContent).toBe(
      t('devboxPage.railBridgeSummary', {
        state: t('devboxPage.railBridgeUp'),
        count: 2,
      }),
    );
  });

  it('reports the bridge as down when an observed bundle is degraded', () => {
    renderRail({ jobs: observed([], 'down') });

    expect(screen.getByTestId('devbox-rail-bridge-summary').textContent).toContain(
      t('devboxPage.railBridgeDown'),
    );
  });
});
