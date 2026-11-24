import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

jest.mock('@/lib/backend/core/invoke', () => ({
  safeInvoke: jest.fn(),
  safeInvokeWithRetry: jest.fn(),
  batchInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

jest.mock('@/components/devbox/DevboxPrompt', () => ({
  DevboxPrompt: () => <div data-testid="devbox-prompt" />,
}));

import { safeInvoke } from '@/lib/backend/core/invoke';
import { t } from '@/lib/i18n';
import { formatTime } from '@/lib/utils';
import {
  devboxTime,
  type DevboxAccepted,
  type DevboxEventRow,
  type DevboxJobRow,
  type DevboxObserved,
  type DevboxPermissionRow,
} from '@/lib/backend/modules/devbox';
import { DevboxAgent, type DevboxAgentProps } from '@/components/devbox/DevboxAgent';
import { devboxModeLabel } from '@/components/devbox/labels';
import { DEVBOX_TOTAL_TOOLS, type UseDevboxConnectResult } from '@/components/devbox/useDevboxConnect';
import {
  connectionOkFixture,
  devboxCallArgs,
  devboxCalls,
  devboxRouter,
  idleActionStatus,
  overviewFixture,
  pageRoutes,
  pendingPermissionFixture,
  profilesFixture,
  runningJobFixture,
} from './devboxTestKit';

const invokeMock = safeInvoke as jest.Mock;
const BANNER_KEY = 'devbox.securityBannerDismissed';
const NOW_MS = 1791537000000;
const STARTED_SEC = 1791536987.76;

function observed<T>(rows: T[], bridge: 'up' | 'down' = 'up'): DevboxObserved<T> {
  return { rows, bridge };
}

function connectFixture(overrides: Partial<UseDevboxConnectResult> = {}): UseDevboxConnectResult {
  const base = {
    activeProfile: 'midsai',
    profileMode: 'standard',
    resolvedUrl: 'https://devbox-abcd1234.loca.lt',
    bridgeState: 'healthy',
    ingressState: 'healthy',
    handoffStale: false,
    connectionStale: false,
    probe: { result: connectionOkFixture, checkedAt: NOW_MS, signature: 'probe-signature' },
    probeStale: false,
    tools: 16,
    latency: 42,
  };
  return { ...base, ...overrides } as unknown as UseDevboxConnectResult;
}

function renderAgent(props: Partial<DevboxAgentProps> = {}) {
  const onAction = jest.fn((_action: Promise<DevboxAccepted>) => undefined);
  const onPermissionReply = jest.fn((_id: string, _decision: 'once' | 'reject') => undefined);
  render(
    <DevboxAgent
      connect={connectFixture()}
      profiles={profilesFixture}
      overviewCards={overviewFixture.cards}
      gateway={overviewFixture.gateway}
      actionStatus={idleActionStatus}
      jobs={observed<DevboxJobRow>([])}
      permissions={observed<DevboxPermissionRow>([])}
      events={[]}
      busy={false}
      onAction={onAction as unknown as (action: Promise<DevboxAccepted>) => void}
      onOpenTab={jest.fn()}
      onPermissionReply={onPermissionReply}
      {...props}
    />,
  );
  return { onAction, onPermissionReply };
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

describe('DevboxAgent session', () => {
  it('renders live session facts from connect and poll data', () => {
    renderAgent({
      jobs: observed([runningJobFixture(STARTED_SEC)]),
      permissions: observed([pendingPermissionFixture()]),
      events: [{ ts: STARTED_SEC, kind: 'tool_call', tool: 'bash', status: 'ok' }],
    });

    const session = screen.getByTestId('devbox-agent-session');
    expect(session.textContent).toContain('midsai');
    expect(session.textContent).toContain(devboxModeLabel('standard'));
    expect(session.textContent).toContain(t('devboxPage.stateHealthy'));
    expect(session.textContent).toContain('https://devbox-abcd1234.loca.lt');
    expect(session.textContent).toContain(t('devboxPage.stateDown'));
    expect(session.textContent).toContain(t('devboxPage.overviewLatencyValue', { ms: 42 }));
    expect(session.textContent).toContain(
      t('devboxPage.overviewProbeFresh', { at: formatTime(NOW_MS) }),
    );
    expect(screen.getByTestId('devbox-agent-session-status').textContent).toBe(
      t('devboxPage.agentSessionStatusAttention'),
    );
    expect(screen.getByTestId('devbox-prompt')).toBeTruthy();
  });

  it('marks the session stale when connection data is stale', () => {
    renderAgent({ connect: connectFixture({ connectionStale: true }) });

    expect(screen.getByTestId('devbox-agent-session-status').textContent).toBe(
      t('devboxPage.agentSessionStatusStale'),
    );
  });

  it('marks the session idle when the bridge is not healthy and no job is active', () => {
    renderAgent({ connect: connectFixture({ bridgeState: 'unknown' }) });

    expect(screen.getByTestId('devbox-agent-session-status').textContent).toBe(
      t('devboxPage.agentSessionStatusIdle'),
    );
  });

  it('marks the session online when the bridge is healthy', () => {
    renderAgent();

    expect(screen.getByTestId('devbox-agent-session-status').textContent).toBe(
      t('devboxPage.agentSessionStatusOnline'),
    );
  });
});

describe('DevboxAgent tool inventory', () => {
  it('renders the read-only 10 native + 6 control protocol inventory', () => {
    renderAgent();

    const agent = screen.getByTestId('devbox-agent');
    const toolRows = Array.from(
      agent.querySelectorAll('[data-testid^="devbox-agent-tool-"]'),
    );

    expect(screen.getByTestId('devbox-agent-tools-summary').textContent).toBe(
      t('devboxPage.agentToolsSummary'),
    );
    expect(toolRows).toHaveLength(16);
    for (const row of toolRows) {
      expect(row.querySelector('button')).toBeNull();
      expect(row.querySelector('input')).toBeNull();
    }
    expect(agent.textContent).toContain(t('devboxPage.agentToolsNative'));
    expect(agent.textContent).toContain(t('devboxPage.agentToolsControl'));
    expect(screen.getByTestId('devbox-agent-tool-bash').textContent).toBe('bash');
    expect(screen.getByTestId('devbox-agent-tool-opencode_permission_reply').textContent).toBe(
      'opencode_permission_reply',
    );
  });
});

describe('DevboxAgent permissions', () => {
  it('approve calls onPermissionReply with decision=once', () => {
    const { onPermissionReply } = renderAgent({
      permissions: observed([pendingPermissionFixture()]),
    });

    expect(screen.getByText('rm -rf build/')).toBeTruthy();
    fireEvent.click(screen.getByTestId('devbox-permission-approve-p1'));

    expect(onPermissionReply).toHaveBeenCalledWith('p1', 'once');
  });

  it('reject is confirm-gated and calls onPermissionReply with decision=reject', () => {
    const { onPermissionReply } = renderAgent({
      permissions: observed([pendingPermissionFixture()]),
    });

    const reject = screen.getByTestId('devbox-permission-reject-p1');
    fireEvent.click(reject);
    expect(onPermissionReply).not.toHaveBeenCalled();
    fireEvent.click(reject);

    expect(onPermissionReply).toHaveBeenCalledWith('p1', 'reject');
  });

  it('disables both permission buttons while the permissions bridge is down', () => {
    renderAgent({ permissions: observed([pendingPermissionFixture()], 'down') });

    expect(screen.getByTestId('devbox-permission-approve-p1')).toBeDisabled();
    expect(screen.getByTestId('devbox-permission-reject-p1')).toBeDisabled();
    expect(screen.getByTestId('devbox-agent-permissions-degraded')).toBeTruthy();
  });

  it('shows the empty queue state', () => {
    renderAgent();

    expect(screen.getByText(t('devboxPage.agentPermissionsEmpty'))).toBeTruthy();
  });
});

describe('DevboxAgent jobs', () => {
  it('renders a running job with a ticking elapsed timer and confirm-gated cancel', async () => {
    jest.useFakeTimers().setSystemTime(NOW_MS);
    renderAgent({ jobs: observed([runningJobFixture(STARTED_SEC)]) });

    expect(screen.getByTestId('devbox-agent-job-j1').textContent).toContain('bash');
    expect(screen.getByTestId('devbox-agent-job-status-j1').textContent).toBe(
      t('devboxPage.eventStatusRunning'),
    );
    expect(screen.getByTestId('devbox-agent-job-elapsed-j1').textContent).toBe(
      t('devboxPage.railElapsed', { elapsed: '00:12' }),
    );
    expect(screen.getByTestId('devbox-agent-job-progress-j1')).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId('devbox-agent-job-elapsed-j1').textContent).toBe(
      t('devboxPage.railElapsed', { elapsed: '00:13' }),
    );

    const cancel = screen.getByTestId('devbox-job-cancel-j1');
    fireEvent.click(cancel);
    expect(devboxCalls(invokeMock, 'job_cancel')).toHaveLength(0);

    fireEvent.click(cancel);
    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'job_cancel')).toEqual([{ jobId: 'j1' }]);
    });
  });

  it('shows queued jobs without cancel or fake progress', () => {
    renderAgent({
      jobs: observed([{ id: 'j2', tool: 'pytest', status: 'queued', startedAt: STARTED_SEC }]),
    });

    expect(screen.getByTestId('devbox-agent-job-status-j2').textContent).toBe(
      t('devboxPage.agentJobQueued'),
    );
    expect(screen.queryByTestId('devbox-job-cancel-j2')).toBeNull();
    expect(screen.queryByTestId('devbox-agent-job-progress-j2')).toBeNull();
  });

  it('marks a bridge-down jobs bundle', () => {
    renderAgent({ jobs: observed([], 'down') });

    expect(screen.getByTestId('devbox-agent-jobs-degraded')).toBeTruthy();
  });

  it('shows the empty jobs state', () => {
    renderAgent();

    expect(screen.getByText(t('devboxPage.agentJobsEmpty'))).toBeTruthy();
  });
});

describe('DevboxAgent recent actions', () => {
  const events: DevboxEventRow[] = Array.from({ length: 7 }, (_, i) => ({
    ts: 1791536980 + i,
    kind: 'tool_call',
    tool: `tool${i}`,
    status: 'ok',
  }));

  it('shows only the last six events newest-first', () => {
    renderAgent({ events });

    expect(screen.queryByText(/tool0/)).toBeNull();
    const cards = screen.getAllByTestId('devbox-agent-event-card');
    expect(cards).toHaveLength(6);
    expect(cards[0].textContent).toContain('tool6');
    expect(cards[5].textContent).toContain('tool1');
  });

  it('maps event tones without spinning awaiting-permission rows', () => {
    renderAgent({
      events: [
        { ts: 1791536980, kind: 'tool_call', tool: 'bash', status: 'ok' },
        { ts: 1791536981, kind: 'tool_call', tool: 'git', status: 'failed' },
        { ts: 1791536982, kind: 'job', tool: 'pytest', status: 'running' },
        { ts: 1791536983, kind: 'mcp_request', tool: 'bash', status: 'awaiting_permission' },
      ],
    });

    const icons = screen.getAllByTestId('devbox-agent-event-icon');
    expect(icons.map(icon => icon.getAttribute('data-tone'))).toEqual([
      'attention',
      'running',
      'failed',
      'ok',
    ]);
    expect(icons[0].getAttribute('class')).not.toContain('animate-spin');
  });

  it('shows the empty recent state', () => {
    renderAgent();

    expect(screen.getByText(t('devboxPage.agentRecentEmpty'))).toBeTruthy();
  });
});

describe('DevboxAgent security banner', () => {
  it('dismiss persists to localStorage and hides the banner on next render', () => {
    renderAgent();
    expect(screen.getByTestId('devbox-security-banner')).toBeTruthy();

    fireEvent.click(screen.getByTestId('devbox-security-banner-close'));
    expect(screen.queryByTestId('devbox-security-banner')).toBeNull();
    expect(localStorage.getItem(BANNER_KEY)).toBe('1');

    renderAgent();
    expect(screen.queryAllByTestId('devbox-security-banner')).toHaveLength(0);
  });
});
