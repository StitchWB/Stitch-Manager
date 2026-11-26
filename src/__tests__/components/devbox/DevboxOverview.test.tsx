import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';

jest.mock('@/lib/backend/core/invoke', () => ({
  safeInvoke: jest.fn(),
  safeInvokeWithRetry: jest.fn(),
  batchInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));

jest.mock('@/components/ui/ConfirmDialogHost', () => ({
  askConfirm: jest.fn(() => Promise.resolve(true)),
}));

jest.mock('@/hooks/useCopyToClipboard', () => {
  const copy = jest.fn(async () => undefined);
  return {
    __esModule: true,
    useCopyToClipboard: () => ({ copy, copied: false }),
    copyToClipboard: copy,
  };
});

import { safeInvoke } from '@/lib/backend/core/invoke';
import { copyToClipboard } from '@/hooks/useCopyToClipboard';
import { t } from '@/lib/i18n';
import { DevboxOverview } from '@/components/devbox/DevboxOverview';
import { useDevboxConnect, type DevboxTab } from '@/components/devbox/useDevboxConnect';
import type {
  DevboxAccepted,
  DevboxActionStatus,
  DevboxEventRow,
  DevboxObserved,
  DevboxOverviewGateway,
  DevboxPermissionRow,
  DevboxVitalCard,
} from '@/lib/backend/modules/devbox';
import {
  bridgeDownCardsFixture,
  connectRoutes,
  connectionFailFixture,
  connectionManualFixture,
  devboxCallArgs,
  devboxCalls,
  devboxRouter,
  envEntriesWithoutPublic,
  eventsFixture,
  gatewayFixture,
  healthyCardsFixture,
  idleActionStatus,
  ingressDownCardsFixture,
  noConnectionPromptFixture,
  observedPermissionsFixture,
  stoppedCardsFixture,
  type DevboxRoutes,
} from './devboxTestKit';

const invokeMock = safeInvoke as jest.Mock;
const copyMock = copyToClipboard as unknown as jest.Mock;
const onAction = jest.fn();
const onChanged = jest.fn();
const onOpenTab = jest.fn();
const onConfigureMcp = jest.fn();
const onRefresh = jest.fn();

interface OverviewHarnessProps {
  activeProfile?: string;
  cards?: DevboxVitalCard[] | null;
  actionStatus?: DevboxActionStatus | null;
  gateway?: DevboxOverviewGateway | null;
  permissions?: DevboxObserved<DevboxPermissionRow> | null;
  events?: DevboxEventRow[];
  busy?: boolean;
  pollError?: string | null;
}

function OverviewHarness({
  activeProfile = 'midsai',
  cards = healthyCardsFixture,
  actionStatus = idleActionStatus,
  gateway = gatewayFixture,
  permissions = observedPermissionsFixture,
  events = eventsFixture,
  busy = false,
  pollError = null,
}: OverviewHarnessProps) {
  const connect = useDevboxConnect({
    activeProfile,
    cards,
    actionStatus,
    busy,
    onAction: onAction as unknown as (action: Promise<DevboxAccepted>) => void,
    onChanged,
  });
  return (
    <DevboxOverview
      connect={connect}
      gateway={gateway}
      permissions={permissions}
      events={events}
      busy={busy}
      pollError={pollError}
      onOpenTab={onOpenTab as unknown as (tab: DevboxTab) => void}
      onConfigureMcp={onConfigureMcp as unknown as () => void}
      onRefresh={onRefresh}
    />
  );
}

function mockRoutes(overrides: DevboxRoutes = {}) {
  invokeMock.mockImplementation(devboxRouter(connectRoutes(overrides)));
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) {
      await Promise.resolve();
    }
  });
}

async function renderOverview(props: OverviewHarnessProps = {}) {
  const utils = render(<OverviewHarness {...props} />);
  await waitFor(() => {
    expect(devboxCalls(invokeMock, 'env_get').length).toBeGreaterThan(0);
    expect(devboxCalls(invokeMock, 'connection_check').length).toBeGreaterThan(0);
    expect(devboxCalls(invokeMock, 'handoff_block').length).toBeGreaterThan(0);
    expect(devboxCalls(invokeMock, 'agent_prompt').length).toBeGreaterThan(0);
  });
  await flush();
  return utils;
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  mockRoutes();
});

describe('DevboxOverview hero variants', () => {
  it('shows ready hero and real metrics when stack, bridge and probe are healthy', async () => {
    await renderOverview();

    await waitFor(() =>
      expect(screen.getByTestId('devbox-overview-hero-title').textContent).toBe('Ready to connect'),
    );
    expect(screen.getByTestId('devbox-overview-hero-state').textContent).toBe('Ready');
    expect(screen.getByTestId('devbox-overview-endpoint-url').textContent).toBe(
      'https://devbox-abcd1234.loca.lt/p/8787/mcp',
    );
    expect(screen.getByTestId('devbox-overview-tools').textContent).toContain('16 / 16 tools');
    expect(screen.getByTestId('devbox-overview-latency').textContent).toContain('42 ms');
    expect(screen.getByTestId('devbox-overview-mode').textContent).toContain('Localtunnel');
    expect(screen.getByTestId('devbox-overview-pill-bridge').textContent).toContain(
      '10 native + 6 control ready',
    );
    expect(screen.getByTestId('devbox-overview-pill-path').textContent).toContain('online');
    expect(screen.getByTestId('devbox-overview-pill-session').textContent).toContain('ready');

    const before = devboxCalls(invokeMock, 'connection_check').length;
    fireEvent.click(screen.getByTestId('devbox-overview-hero-action'));
    await waitFor(() =>
      expect(devboxCalls(invokeMock, 'connection_check').length).toBeGreaterThan(before),
    );
  });

  it('shows stack hero and starts stack', async () => {
    await renderOverview({ cards: stoppedCardsFixture });

    await waitFor(() =>
      expect(screen.getByTestId('devbox-overview-hero-title').textContent).toBe('Stack stopped'),
    );
    expect(screen.getByTestId('devbox-overview-hero-state').textContent).toBe('Stopped');
    expect(screen.getByTestId('devbox-overview-start-stack')).toBeTruthy();

    fireEvent.click(screen.getByTestId('devbox-overview-hero-action'));
    await waitFor(() =>
      expect(devboxCallArgs(invokeMock, 'stack_start')).toEqual([{ name: 'midsai', preview: false }]),
    );
  });

  it('shows bridge hero and zero tools when bridge is down', async () => {
    mockRoutes({ connection_check: connectionFailFixture });
    await renderOverview({ cards: bridgeDownCardsFixture });

    await waitFor(() =>
      expect(screen.getByTestId('devbox-overview-hero-title').textContent).toBe('Code bridge stopped'),
    );
    expect(screen.getByTestId('devbox-overview-tools').textContent).toContain('0 / 16 tools');
    expect(screen.getByTestId('devbox-overview-pill-bridge').textContent).toContain('stopped');
    expect(screen.getByTestId('devbox-overview-pill-path').textContent).toContain('unverified');

    fireEvent.click(screen.getByTestId('devbox-overview-hero-action'));
    await waitFor(() =>
      expect(devboxCallArgs(invokeMock, 'stack_start')).toEqual([{ name: 'midsai', preview: false }]),
    );
  });

  it('shows blocked hero when no public endpoint can be resolved', async () => {
    mockRoutes({
      env_get: { entries: envEntriesWithoutPublic() },
      agent_prompt: noConnectionPromptFixture,
      connection_check: connectionFailFixture,
    });
    await renderOverview();

    await waitFor(() =>
      expect(screen.getByTestId('devbox-overview-hero-title').textContent).toBe('Tunnel not configured'),
    );
    expect(screen.getByTestId('devbox-overview-hero-state').textContent).toBe('Setup needed');
    expect(screen.getByTestId('devbox-overview-endpoint-url').textContent).toBe('not configured');
    expect(screen.getByTestId('devbox-overview-hero-sub').textContent).toContain('not configured');
    expect(screen.getByTestId('devbox-overview-copy-endpoint')).toBeDisabled();

    fireEvent.click(screen.getByTestId('devbox-overview-hero-action'));
    expect(onOpenTab).toHaveBeenCalledWith('connect');
  });

  it('shows fallback hero with PUBLIC_URL when auto probe resolves manual', async () => {
    mockRoutes({ connection_check: connectionManualFixture });
    await renderOverview();

    await waitFor(() =>
      expect(screen.getByTestId('devbox-overview-hero-title').textContent).toBe('Fallback active'),
    );
    expect(screen.getByTestId('devbox-overview-hero-state').textContent).toBe('Limited');
    expect(screen.getByTestId('devbox-overview-hero-sub').textContent).toContain(
      'https://fallback.example.test',
    );
    expect(screen.getByTestId('devbox-overview-mode').textContent).toContain('Manual');

    fireEvent.click(screen.getByTestId('devbox-overview-hero-action'));
    expect(onOpenTab).toHaveBeenCalledWith('connect');
  });

  it('shows plugin hero instead of stack when the backend is unreachable', async () => {
    await renderOverview({ cards: null, pollError: 'RPC timeout' });

    await waitFor(() =>
      expect(screen.getByTestId('devbox-overview-hero-title').textContent).toBe(
        'Devbox plugin is not responding',
      ),
    );
    expect(screen.getByTestId('devbox-overview-hero-state').textContent).toBe('No data');
    expect(screen.getByTestId('devbox-overview-hero-alert').textContent).toContain('RPC timeout');

    fireEvent.click(screen.getByTestId('devbox-overview-hero-action'));
    expect(onRefresh).toHaveBeenCalled();
    expect(devboxCallArgs(invokeMock, 'stack_start')).toEqual([]);
  });

  it('disables start actions without active project', async () => {
    await renderOverview({ activeProfile: '', cards: stoppedCardsFixture });

    await waitFor(() =>
      expect(screen.getByTestId('devbox-overview-hero-title').textContent).toBe('Stack stopped'),
    );
    expect(screen.getByTestId('devbox-overview-hero-action')).toBeDisabled();
    expect(screen.getByTestId('devbox-overview-start-stack')).toBeDisabled();
  });

  it('disables hero action while busy', async () => {
    await renderOverview({ busy: true });

    await waitFor(() =>
      expect(screen.getByTestId('devbox-overview-hero-title').textContent).toBe('Ready to connect'),
    );
    expect(screen.getByTestId('devbox-overview-hero-action')).toBeDisabled();
  });
});

describe('DevboxOverview activity and navigation', () => {
  it('renders activity counts and routes quick actions', async () => {
    await renderOverview();

    const activity = await screen.findByTestId('devbox-overview-activity-list');
    expect(activity.textContent).toContain('bash');
    expect(activity.textContent).toContain('Permission request: edit');
    expect(screen.getByTestId('devbox-overview-quick-agent').textContent).toContain('1');
    expect(screen.getByTestId('devbox-overview-quick-mcp').textContent).toContain('2 published');

    fireEvent.click(screen.getByTestId('devbox-overview-all-events'));
    expect(onOpenTab).toHaveBeenCalledWith('logs');

    fireEvent.click(screen.getByTestId('devbox-overview-open-services'));
    expect(onOpenTab).toHaveBeenCalledWith('services');

    fireEvent.click(screen.getByTestId('devbox-overview-show-handoff'));
    expect(onOpenTab).toHaveBeenCalledWith('connect');

    fireEvent.click(within(screen.getByTestId('devbox-overview-quick-agent')).getByText('Open →'));
    expect(onOpenTab).toHaveBeenCalledWith('agent');

    fireEvent.click(within(screen.getByTestId('devbox-overview-quick-mcp')).getByText('Configure →'));
    expect(onConfigureMcp).toHaveBeenCalledTimes(1);

    fireEvent.click(within(screen.getByTestId('devbox-overview-quick-tokens')).getByText('Open →'));
    expect(onOpenTab).toHaveBeenCalledWith('connect');
  });

  it('shows the three next steps', async () => {
    await renderOverview();

    expect(await screen.findByTestId('devbox-overview-next-1')).toBeTruthy();
    expect(screen.getByTestId('devbox-overview-next-2').textContent).toContain('Send it to the agent');
    expect(screen.getByTestId('devbox-overview-next-3').textContent).toContain('Approve requests');
  });

  it('routes stack actions, probe check and agent quick link', async () => {
    await renderOverview();

    await waitFor(() =>
      expect(screen.getByTestId('devbox-overview-hero-title').textContent).toBe('Ready to connect'),
    );

    fireEvent.click(screen.getByTestId('devbox-overview-restart-stack'));
    await waitFor(() =>
      expect(devboxCallArgs(invokeMock, 'stack_start')).toEqual([{ name: 'midsai', preview: false }]),
    );

    const before = devboxCalls(invokeMock, 'connection_check').length;
    fireEvent.click(screen.getByTestId('devbox-overview-check'));
    await waitFor(() =>
      expect(devboxCalls(invokeMock, 'connection_check').length).toBeGreaterThan(before),
    );

    fireEvent.click(within(screen.getByTestId('devbox-overview-quick-agent')).getByText('Open →'));
    expect(onOpenTab).toHaveBeenCalledWith('agent');
  });

  it('copies resolved endpoint', async () => {
    await renderOverview();

    await waitFor(() =>
      expect(screen.getByTestId('devbox-overview-endpoint-url').textContent).toBe(
        'https://devbox-abcd1234.loca.lt/p/8787/mcp',
      ),
    );

    fireEvent.click(screen.getByTestId('devbox-overview-copy-endpoint'));
    await waitFor(() =>
      expect(copyMock).toHaveBeenCalledWith('https://devbox-abcd1234.loca.lt/p/8787/mcp', {
        successMessage: 'Copy address',
      }),
    );
  });

  it('restarts healthy stack and stops it only after confirmation', async () => {
    await renderOverview();

    await waitFor(() => expect(screen.getByTestId('devbox-overview-restart-stack')).toBeTruthy());

    fireEvent.click(screen.getByTestId('devbox-overview-restart-stack'));
    await waitFor(() =>
      expect(devboxCallArgs(invokeMock, 'stack_start')).toEqual([{ name: 'midsai', preview: false }]),
    );

    fireEvent.click(screen.getByTestId('devbox-overview-stop-stack'));
    expect(devboxCalls(invokeMock, 'stack_down')).toEqual([]);
    expect(screen.getByTestId('devbox-overview-stop-stack').textContent).toBe(t('common.sure'));

    fireEvent.click(screen.getByTestId('devbox-overview-stop-stack'));
    await waitFor(() => expect(devboxCallArgs(invokeMock, 'stack_down')).toEqual([{}]));
  });
});

describe('DevboxOverview status matrix', () => {
  it('blames the public path, not the bridge, when the probe fails on a healthy stack', async () => {
    mockRoutes({ connection_check: connectionFailFixture });
    await renderOverview();

    await waitFor(() =>
      expect(screen.getByTestId('devbox-overview-hero-title').textContent).toBe(
        'Public path is failing',
      ),
    );
    expect(screen.getByTestId('devbox-overview-hero-state').textContent).toBe('Needs attention');
    expect(screen.getByTestId('devbox-overview-pill-bridge').textContent).toContain(
      '10 native + 6 control ready',
    );
    expect(screen.getByTestId('devbox-overview-pill-path').textContent).toContain('unverified');
    expect(screen.getByTestId('devbox-overview-hero-alert').textContent).toContain(
      'bridge unreachable',
    );

    const before = devboxCalls(invokeMock, 'connection_check').length;
    fireEvent.click(screen.getByTestId('devbox-overview-hero-action'));
    await waitFor(() =>
      expect(devboxCalls(invokeMock, 'connection_check').length).toBeGreaterThan(before),
    );
  });

  it('blames the path when the ingress card is down even if the probe passes', async () => {
    await renderOverview({ cards: ingressDownCardsFixture });

    await waitFor(() =>
      expect(screen.getByTestId('devbox-overview-hero-title').textContent).toBe(
        'Public path is failing',
      ),
    );
    expect(screen.getByTestId('devbox-overview-pill-bridge').textContent).toContain(
      '10 native + 6 control ready',
    );
    expect(screen.getByTestId('devbox-overview-pill-path').textContent).toContain('stopped');
  });

  it('keeps bridge blame only when the bridge card itself is down', async () => {
    mockRoutes({ connection_check: connectionFailFixture });
    await renderOverview({ cards: bridgeDownCardsFixture });

    await waitFor(() =>
      expect(screen.getByTestId('devbox-overview-hero-title').textContent).toBe('Code bridge stopped'),
    );
    expect(screen.getByTestId('devbox-overview-pill-path').textContent).toContain('unverified');
  });

  it('labels the endpoint as the agent address, not a generic public address', async () => {
    await renderOverview();
    await waitFor(() =>
      expect(screen.getByTestId('devbox-overview-endpoint').textContent).toContain(
        'Agent address',
      ),
    );
  });
});
