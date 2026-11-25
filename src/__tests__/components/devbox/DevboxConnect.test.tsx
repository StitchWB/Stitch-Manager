import { describe, it, expect, jest, beforeEach } from '@jest/globals';
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
import { DevboxConnect } from '@/components/devbox/DevboxConnect';
import { useDevboxConnect } from '@/components/devbox/useDevboxConnect';
import type {
  DevboxAccepted,
  DevboxActionStatus,
  DevboxConnectionCheckResult,
  DevboxVitalCard,
} from '@/lib/backend/modules/devbox';
import {
  bootstrapCommands,
  connectProfileModel,
  connectRoutes,
  connectionFailFixture,
  connectionOkFixture,
  devboxCallArgs,
  devboxCalls,
  devboxRouter,
  healthyCardsFixture,
  idleActionStatus,
  revealedHandoffFixture,
  rotatedTokensStatus,
  stoppedCardsFixture,
  type DevboxRoutes,
} from './devboxTestKit';

const invokeMock = safeInvoke as jest.Mock;
const copyMock = copyToClipboard as unknown as jest.Mock;
const onAction = jest.fn();
const onChanged = jest.fn();

interface ConnectHarnessProps {
  activeProfile?: string;
  cards?: DevboxVitalCard[] | null;
  actionStatus?: DevboxActionStatus | null;
  busy?: boolean;
}

function ConnectHarness({
  activeProfile = 'midsai',
  cards = healthyCardsFixture,
  actionStatus = idleActionStatus,
  busy = false,
}: ConnectHarnessProps) {
  const connect = useDevboxConnect({
    activeProfile,
    cards,
    actionStatus,
    busy,
    onAction: onAction as unknown as (action: Promise<DevboxAccepted>) => void,
    onChanged,
  });
  return <DevboxConnect connect={connect} busy={busy} />;
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

async function renderConnect(props: ConnectHarnessProps = {}) {
  const utils = render(<ConnectHarness {...props} />);
  await waitFor(() => {
    expect(devboxCalls(invokeMock, 'env_get').length).toBeGreaterThan(0);
    expect(devboxCalls(invokeMock, 'connection_check').length).toBeGreaterThan(0);
    expect(devboxCalls(invokeMock, 'handoff_block').length).toBeGreaterThan(0);
    expect(devboxCalls(invokeMock, 'agent_prompt').length).toBeGreaterThan(0);
  });
  await waitFor(() => expect(screen.getByTestId('devbox-connect-handoff-block')).toBeTruthy());
  await flush();
  return utils;
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  mockRoutes();
});

describe('DevboxConnect initial state', () => {
  it('loads env, profile, probe, handoff and connection from RPCs', async () => {
    await renderConnect();

    expect(devboxCallArgs(invokeMock, 'env_get')).toContainEqual({});
    expect(devboxCallArgs(invokeMock, 'profile_get')).toContainEqual({ name: 'midsai' });
    expect(devboxCallArgs(invokeMock, 'connection_check')).toContainEqual({});
    expect(devboxCallArgs(invokeMock, 'handoff_block')).toContainEqual({ reveal: false });
    expect(devboxCallArgs(invokeMock, 'agent_prompt')).toContainEqual({
      reveal: false,
      client: 'universal',
    });

    const publicUrl = screen.getByTestId('devbox-connect-input-PUBLIC_URL') as HTMLInputElement;
    expect(publicUrl.value).toBe('https://fallback.example.test');
    expect(screen.getByTestId('devbox-connect-status').textContent).toContain('16 tools active');
    expect(screen.getByTestId('devbox-connect-access-standard').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('devbox-connect-handoff-block').textContent).toContain('bridge...masked');
    expect(screen.getByTestId('devbox-connect-token-value-BRIDGE_TOKEN').textContent).toBe('bridge...masked');
  });

  it('disables access controls without an active project', async () => {
    await renderConnect({ activeProfile: '' });

    expect(screen.getByTestId('devbox-connect-access-readonly')).toBeDisabled();
    expect(screen.getByText('Select an active project to change access.')).toBeTruthy();
    expect(devboxCalls(invokeMock, 'profile_get')).toHaveLength(0);
  });
});

describe('DevboxConnect ingress configuration', () => {
  it('saves only mode-relevant editable fields', async () => {
    await renderConnect();

    fireEvent.click(screen.getByTestId('devbox-connect-mode-relay'));
    await waitFor(() => expect(screen.getByTestId('devbox-connect-input-RELAY_SUBDOMAIN')).toBeTruthy());
    expect(screen.queryByTestId('devbox-connect-input-PUBLIC_URL')).toBeNull();

    fireEvent.change(screen.getByTestId('devbox-connect-input-RELAY_SUBDOMAIN'), {
      target: { value: 'devbox-test' },
    });
    fireEvent.click(screen.getByTestId('devbox-connect-save'));

    await waitFor(() =>
      expect(devboxCallArgs(invokeMock, 'env_set')).toEqual([
        { patch: { INGRESS_MODE: 'relay', RELAY_SUBDOMAIN: 'devbox-test' } },
      ]),
    );
    await waitFor(() => expect(screen.getByTestId('devbox-connect-saved')).toBeTruthy());
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('shows Cloudflare fields and warns when incomplete', async () => {
    await renderConnect();

    fireEvent.click(screen.getByTestId('devbox-connect-mode-cloudflare'));
    await waitFor(() => expect(screen.getByTestId('devbox-connect-input-TUNNEL_TOKEN')).toBeTruthy());
    expect(screen.queryByTestId('devbox-connect-input-RELAY_SUBDOMAIN')).toBeNull();
    expect(screen.queryByText('Tunnel not configured — fill in the domain and token.')).toBeNull();

    fireEvent.change(screen.getByTestId('devbox-connect-input-PUBLIC_URL'), { target: { value: '' } });
    expect(await screen.findByText('Tunnel not configured — fill in the domain and token.')).toBeTruthy();
  });

  it('warns when the manifest route is down behind a healthy bridge', async () => {
    mockRoutes({
      connection_check: {
        ...connectionOkFixture,
        manifest_status: 404,
        public_url: 'https://devbox.example.test',
        public_status: 530,
      },
    });
    await renderConnect();

    const status = screen.getByTestId('devbox-connect-status');
    expect(status.textContent).toContain('16 tools active');
    expect(status.textContent).toContain('Endpoint registry unreachable: HTTP 404');
    expect(status.textContent).toContain('PUBLIC_URL dead: HTTP 530');
  });

  it('recommends Manual when probe fails and PUBLIC_URL exists', async () => {
    mockRoutes({ connection_check: connectionFailFixture });
    await renderConnect();

    const apply = await screen.findByTestId('devbox-connect-apply-recommendation');
    expect(apply.textContent).toContain('Manual');
    expect(screen.getByTestId('devbox-connect-status').textContent).toContain('bridge unreachable');

    fireEvent.click(apply);
    await waitFor(() =>
      expect(screen.getByTestId('devbox-connect-mode-manual').getAttribute('aria-checked')).toBe('true'),
    );
    expect(screen.getByTestId('devbox-connect-input-PUBLIC_URL')).toBeTruthy();
  });

  it('keeps the probe fresh on draft edits and re-checks after save', async () => {
    await renderConnect();
    await waitFor(() =>
      expect(screen.getByTestId('devbox-connect-status').textContent).toContain('16 tools active'),
    );

    fireEvent.change(screen.getByTestId('devbox-connect-input-PUBLIC_URL'), {
      target: { value: 'https://changed.example.test' },
    });

    expect(screen.getByTestId('devbox-connect-status').textContent).not.toContain('probe stale');

    const checksBefore = devboxCalls(invokeMock, 'connection_check').length;
    fireEvent.click(screen.getByTestId('devbox-connect-save'));
    await waitFor(() =>
      expect(devboxCalls(invokeMock, 'connection_check').length).toBeGreaterThan(checksBefore),
    );
    await waitFor(() =>
      expect(screen.getByTestId('devbox-connect-status').textContent).toContain(
        '16 tools active',
      ),
    );
    expect(screen.queryByTestId('devbox-connect-apply-recommendation')).toBeNull();
  });

  it('re-runs the check when the saved config changes while a check is in flight', async () => {
    let resolveFirst!: (value: DevboxConnectionCheckResult) => void;
    const checkMock = jest
      .fn()
      .mockImplementationOnce(() => new Promise(resolve => {
        resolveFirst = resolve;
      }))
      .mockImplementation(() => Promise.resolve(connectionOkFixture));
    mockRoutes({ connection_check: checkMock });
    render(<ConnectHarness />);
    await waitFor(() => expect(devboxCalls(invokeMock, 'connection_check').length).toBe(1));

    fireEvent.change(screen.getByTestId('devbox-connect-input-PUBLIC_URL'), {
      target: { value: 'https://changed.example.test' },
    });
    fireEvent.click(screen.getByTestId('devbox-connect-save'));
    await waitFor(() => expect(screen.getByTestId('devbox-connect-saved')).toBeTruthy());

    await act(async () => {
      resolveFirst(connectionOkFixture);
    });
    await waitFor(() =>
      expect(devboxCalls(invokeMock, 'connection_check').length).toBeGreaterThanOrEqual(2),
    );
    await waitFor(() =>
      expect(screen.getByTestId('devbox-connect-status').textContent).toContain('16 tools active'),
    );
  });

  it('offers restart actions after a successful save', async () => {
    mockRoutes({ env_set: { valid: true, errors: [], restart: ['ingress', 'stack'] } });
    await renderConnect();

    fireEvent.click(screen.getByTestId('devbox-connect-mode-manual'));
    fireEvent.change(screen.getByTestId('devbox-connect-input-PUBLIC_URL'), {
      target: { value: 'https://manual.example.test' },
    });
    fireEvent.click(screen.getByTestId('devbox-connect-save'));

    await waitFor(() => expect(screen.getByTestId('devbox-connect-restart')).toBeTruthy());
    fireEvent.click(screen.getByTestId('devbox-connect-restart-ingress'));
    await waitFor(() =>
      expect(devboxCallArgs(invokeMock, 'ingress_control')).toEqual([{ action: 'up' }]),
    );

    fireEvent.click(screen.getByTestId('devbox-connect-restart-stack'));
    await waitFor(() =>
      expect(devboxCallArgs(invokeMock, 'stack_start')).toEqual([{ name: 'midsai', preview: false }]),
    );
  });

  it('blocks relay save without subdomain and surfaces server errors', async () => {
    mockRoutes({ env_set: { valid: false, errors: ['PUBLIC_URL invalid'], restart: [] } });
    await renderConnect();

    fireEvent.click(screen.getByTestId('devbox-connect-mode-relay'));
    fireEvent.change(screen.getByTestId('devbox-connect-input-RELAY_SUBDOMAIN'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByTestId('devbox-connect-save'));

    await waitFor(() =>
      expect(screen.getByTestId('devbox-connect-errors').textContent).toContain('Subdomain is required'),
    );
    expect(devboxCalls(invokeMock, 'env_set')).toHaveLength(0);

    fireEvent.click(screen.getByTestId('devbox-connect-mode-manual'));
    fireEvent.change(screen.getByTestId('devbox-connect-input-PUBLIC_URL'), {
      target: { value: 'not-a-url' },
    });
    fireEvent.click(screen.getByTestId('devbox-connect-save'));

    await waitFor(() =>
      expect(screen.getByTestId('devbox-connect-errors').textContent).toContain('PUBLIC_URL invalid'),
    );
    expect(screen.queryByTestId('devbox-connect-saved')).toBeNull();
  });

  it('gives every ingress mode card a help trigger whose tooltip states what/when/need', async () => {
    await renderConnect();

    const expected = [
      {
        mode: 'auto',
        title: 'Auto',
        what: "doesn't create a tunnel",
        when: 'when: no preference',
        need: 'Nothing. Optionally paste a PUBLIC_URL as fallback.',
      },
      {
        mode: 'cloudflare',
        title: 'Cloudflare tunnel',
        what: 'tunnel · created here',
        when: 'when: you need a stable URL',
        need: 'A domain + tunnel token from Cloudflare Zero Trust, and Docker running.',
      },
      {
        mode: 'relay',
        title: 'Localtunnel',
        what: 'tunnel · created here',
        when: 'when: you just want to try',
        need: 'Just Docker. The subdomain can stay as generated.',
      },
      {
        mode: 'manual',
        title: 'Manual',
        what: 'your tunnel · ready address',
        when: 'when: ssh -R / nginx / ngrok',
        need: 'A PUBLIC_URL without a trailing slash, and port 8799 forwarded outward.',
      },
    ];

    for (const help of expected) {
      const trigger = screen.getByTestId(`devbox-connect-mode-help-${help.mode}`);
      expect(trigger.tagName).toBe('BUTTON');
      expect(trigger.getAttribute('aria-label')).toContain(help.title);
      expect(trigger.closest(`[data-testid="devbox-connect-mode-${help.mode}"]`)).toBeNull();

      const wrapper = trigger.parentElement as HTMLElement;
      fireEvent.mouseEnter(wrapper);
      const content = await screen.findByTestId(`devbox-connect-mode-help-content-${help.mode}`);
      expect(content.textContent).toContain(help.what);
      expect(content.textContent).toContain(help.when);
      expect(content.textContent).toContain(help.need);
      fireEvent.mouseLeave(wrapper);
      await waitFor(() =>
        expect(screen.queryByTestId(`devbox-connect-mode-help-content-${help.mode}`)).toBeNull(),
      );
    }
  });
});

describe('DevboxConnect access and reliability', () => {
  it('writes access mode into active profile JSON', async () => {
    await renderConnect();

    fireEvent.click(screen.getByTestId('devbox-connect-access-readonly'));

    await waitFor(() =>
      expect(devboxCallArgs(invokeMock, 'profile_put')).toEqual([
        {
          name: 'midsai',
          json: JSON.stringify({ ...connectProfileModel, mode: 'readonly' }, null, 2),
        },
      ]),
    );
    await waitFor(() =>
      expect(screen.getByTestId('devbox-connect-access-readonly').getAttribute('aria-checked')).toBe('true'),
    );
    expect(screen.getByTestId('devbox-connect-access-derived').textContent).toContain('profile.mode = readonly');
    expect(screen.getByTestId('devbox-connect-access-permissions').textContent).toContain('deny');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('toggles watchdog and queues cockpit open', async () => {
    await renderConnect();

    const watchdog = screen
      .getByTestId('devbox-connect-watchdog')
      .querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(watchdog.checked).toBe(true);

    fireEvent.click(watchdog);
    await waitFor(() =>
      expect(devboxCallArgs(invokeMock, 'watchdog_control')).toEqual([{ action: 'stop' }]),
    );
    expect(onAction).toHaveBeenCalledTimes(1);

    expect(screen.getByTestId('devbox-connect-cockpit').textContent).toContain('127.0.0.1:8793');
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    fireEvent.click(screen.getByTestId('devbox-connect-cockpit-open'));
    await waitFor(() => expect(devboxCallArgs(invokeMock, 'cockpit_open')).toEqual([{}]));
    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        'http://127.0.0.1:8793/?t=test-token',
        '_blank',
        'noopener,noreferrer',
      ),
    );
    openSpy.mockRestore();
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('starts watchdog when it is disabled', async () => {
    await renderConnect({ cards: stoppedCardsFixture });

    const watchdog = screen
      .getByTestId('devbox-connect-watchdog')
      .querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(watchdog.checked).toBe(false);

    fireEvent.click(watchdog);
    await waitFor(() =>
      expect(devboxCallArgs(invokeMock, 'watchdog_control')).toEqual([{ action: 'start' }]),
    );
  });

  it('shows advanced policy data from profile and env', async () => {
    await renderConnect();

    fireEvent.click(screen.getByText('Advanced · egress, tokens, policies'));

    await waitFor(() => expect(screen.getByTestId('devbox-connect-deny-mounts').textContent).toBe('/secret'));
    expect(screen.getByTestId('devbox-connect-permissions').textContent).toContain('"edit": "ask"');

    const vless = screen.getByTestId('devbox-connect-input-VLESS_SUB_URL') as HTMLInputElement;
    expect(vless.type).toBe('password');
    fireEvent.click(screen.getByTestId('devbox-connect-toggle-VLESS_SUB_URL'));
    await waitFor(() =>
      expect((screen.getByTestId('devbox-connect-input-VLESS_SUB_URL') as HTMLInputElement).type).toBe('text'),
    );
  });
});

describe('DevboxConnect handoff and chat connection', () => {
  it('reveals canonical handoff, copies it, and masks again after rotation', async () => {
    const utils = await renderConnect();

    fireEvent.click(screen.getByTestId('devbox-connect-handoff-reveal'));
    await waitFor(() =>
      expect(screen.getByTestId('devbox-connect-handoff-block').textContent).toContain('bridge-secret-1'),
    );
    expect(devboxCallArgs(invokeMock, 'handoff_block')).toContainEqual({ reveal: true });

    fireEvent.click(screen.getByTestId('devbox-connect-handoff-copy'));
    await waitFor(() =>
      expect(copyMock).toHaveBeenCalledWith(revealedHandoffFixture.block, {
        sensitive: true,
        successMessage: 'ARENA.md block copied — send it to the agent',
      }),
    );

    const first = rotatedTokensStatus(1791537000);
    const second: DevboxActionStatus = {
      busy: false,
      current: null,
      recent: [{ ...first.recent[0], id: 'act-tokens-2', finishedAt: 1791537010 }],
    };

    utils.rerender(<ConnectHarness actionStatus={first} />);
    await flush();
    utils.rerender(<ConnectHarness actionStatus={second} />);

    await waitFor(() =>
      expect(screen.getByTestId('devbox-connect-handoff-block').textContent).toContain('bridge...masked'),
    );
    await waitFor(() =>
      expect(screen.getByTestId('devbox-connect-token-value-BRIDGE_TOKEN').textContent).toBe('bridge...masked'),
    );
  });

  it('extracts bootstrap from exact heading and copies revealed commands', async () => {
    await renderConnect();

    const bootstrap = await screen.findByTestId('devbox-connect-bootstrap');
    expect(bootstrap.textContent).toContain('./mcp check');
    expect(bootstrap.textContent).toContain('10 native + 6 control');

    fireEvent.click(screen.getByTestId('devbox-connect-bootstrap-copy'));

    await waitFor(() =>
      expect(devboxCallArgs(invokeMock, 'agent_prompt')).toContainEqual({
        reveal: true,
        client: 'universal',
      }),
    );
    await waitFor(() =>
      expect(copyMock).toHaveBeenCalledWith(bootstrapCommands, {
        sensitive: true,
        successMessage: 'Bootstrap commands copied',
      }),
    );
  });

  it('builds bearer chat config and reveals endpoint tokens on copy', async () => {
    await renderConnect();

    fireEvent.click(screen.getByTestId('devbox-connect-location-chat'));

    const config = await screen.findByTestId('devbox-connect-chat-config');
    expect(config.textContent).toContain('"devbox"');
    expect(config.textContent).toContain('"devbox-gateway"');
    expect(config.textContent).toContain('https://devbox-abcd1234.loca.lt/p/8787/mcp');
    expect(config.textContent).toContain('Bearer bridge...masked');
    expect(screen.getByTestId('devbox-connect-endpoint-bridge').textContent).toContain('••••••••');
    expect(await screen.findByText('Bridge: mutations need permissions')).toBeTruthy();

    const before = devboxCalls(invokeMock, 'connection_check').length;
    fireEvent.click(screen.getByTestId('devbox-connect-check-tools'));
    await waitFor(() => expect(devboxCalls(invokeMock, 'connection_check').length).toBeGreaterThan(before));

    fireEvent.click(screen.getByTestId('devbox-connect-chat-copy'));
    await waitFor(() =>
      expect(copyMock).toHaveBeenCalledWith(expect.stringContaining('Bearer bridge-secret-1'), {
        sensitive: true,
        successMessage: 'MCP config copied',
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('devbox-connect-endpoint-bridge').textContent).toContain('bridge-secret-1'),
    );
  });

  it('maps token rows, reveals values, copies one token, and rotates all', async () => {
    await renderConnect();

    expect(screen.getByTestId('devbox-connect-token-BRIDGE_TOKEN').textContent).toContain(
      'MCP bridge · 10 native + 6 control',
    );
    expect(screen.getByTestId('devbox-connect-token-value-INGRESS_TOKEN').textContent).toBe('ingress...masked');

    fireEvent.click(screen.getByTestId('devbox-connect-tokens-reveal'));
    await waitFor(() =>
      expect(screen.getByTestId('devbox-connect-token-value-BRIDGE_TOKEN').textContent).toBe('bridge-secret-1'),
    );
    expect(screen.getByTestId('devbox-connect-token-value-GATEWAY_TOKEN').textContent).toBe('gateway-secret-4');

    fireEvent.click(screen.getByTestId('devbox-connect-token-copy-HOST_TOKEN'));
    await waitFor(() =>
      expect(copyMock).toHaveBeenCalledWith('host-secret-2', {
        sensitive: true,
        successMessage: 'Copied',
      }),
    );

    const rotate = screen.getByTestId('devbox-connect-rotate-tokens');
    fireEvent.click(rotate);
    expect(devboxCalls(invokeMock, 'issue_tokens')).toHaveLength(0);
    fireEvent.click(rotate);
    await waitFor(() => expect(devboxCallArgs(invokeMock, 'issue_tokens')).toEqual([{}]));
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
