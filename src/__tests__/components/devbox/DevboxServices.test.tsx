import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('@/lib/backend/core/invoke', () => ({
  safeInvoke: jest.fn(),
  safeInvokeWithRetry: jest.fn(),
  batchInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

import { safeInvoke } from '@/lib/backend/core/invoke';
import { t } from '@/lib/i18n';
import type { DevboxAccepted } from '@/lib/backend/modules/devbox';
import { DevboxServices, type DevboxServicesProps } from '@/components/devbox/DevboxServices';
import type { UseDevboxConnectResult } from '@/components/devbox/useDevboxConnect';
import { devboxCallArgs, devboxRouter, overviewFixture } from './devboxTestKit';

const invokeMock = safeInvoke as jest.Mock;

const profileModel = {
  project_dir: 'd:/work/midsai',
  mode: 'standard',
  toolchain: 'JDK 21',
  allowed_ports: [8787, 3000],
  port_ranges: [[8100, 8120]],
  port_deny: [5000],
  runner_commands: [{ name: 'build', cmd: ['dotnet', 'build', '--no-restore'], timeout: 600 }],
  exposed_mcps: [{ name: 'context7', mode: 'readonly', tool_allow: ['resolve-library-id'] }],
};

const candidatesPayload = {
  profile: 'midsai',
  error: null,
  candidates: [
    {
      name: 'context7',
      type: 'local',
      enabled: true,
      source: 'opencode.json',
      valid: true,
      error: null,
      command: ['python', '-m', 'context7'],
    },
    {
      name: 'stitch-manager',
      type: 'local',
      enabled: true,
      source: 'opencode.json',
      valid: true,
      error: null,
      command: ['python', '-m', 'stitch'],
    },
  ],
};

function connectFixture(overrides: Partial<UseDevboxConnectResult> = {}): UseDevboxConnectResult {
  const base = {
    activeProfile: 'midsai',
    profileModel,
    entries: [],
    resolvedUrl: 'https://devbox-abcd1234.loca.lt/p/8787/mcp',
    bridgeState: 'healthy',
    probeOk: true,
    probeStale: false,
    checking: false,
    connectionStale: false,
    handoffStale: false,
    effectiveMode: 'relay',
    fallbackActive: false,
    runCheck: jest.fn(),
    startStack: jest.fn(),
    reload: jest.fn(),
    tokenRows: [],
  };
  return { ...base, ...overrides } as unknown as UseDevboxConnectResult;
}

function renderServices(props: Partial<DevboxServicesProps> = {}) {
  const onOpenTab = jest.fn();
  const onConfigureMcp = jest.fn();
  const onChanged = jest.fn();
  const onAction = jest.fn((_action: Promise<DevboxAccepted>) => undefined);
  const connect = props.connect ?? connectFixture();
  render(
    <DevboxServices
      connect={connect}
      cards={overviewFixture.cards}
      gateway={overviewFixture.gateway}
      busy={false}
      pendingPermissions={2}
      onAction={onAction as unknown as (action: Promise<DevboxAccepted>) => void}
      onOpenTab={onOpenTab}
      onConfigureMcp={onConfigureMcp}
      onChanged={onChanged}
      {...props}
    />,
  );
  return { connect, onOpenTab, onConfigureMcp, onChanged, onAction };
}

beforeEach(() => {
  jest.clearAllMocks();
  invokeMock.mockImplementation(
    devboxRouter({
      mcp_candidates: candidatesPayload,
      profile_get: { json: JSON.stringify(profileModel), valid: true, errors: [] },
      profile_put: { valid: true, errors: [] },
    }),
  );
});

describe('DevboxServices focus rows', () => {
  it('renders the three always-visible connection rows', () => {
    renderServices();

    expect(screen.getByTestId('devbox-services-focus-bridge').textContent).toContain(
      t('devboxPage.overviewFocusBridgeTitle'),
    );
    expect(screen.getByTestId('devbox-services-focus-path').textContent).toContain(
      t('devboxPage.overviewFocusPathTitle'),
    );
    expect(screen.getByTestId('devbox-services-focus-session').textContent).toContain(
      t('devboxPage.overviewFocusSessionTitle'),
    );
    expect(screen.getByTestId('devbox-services-focus-bridge').textContent).toContain(
      t('devboxPage.agentToolsSummary'),
    );
    expect(screen.getByTestId('devbox-services-focus-session').textContent).toContain(
      t('devboxPage.overviewApprovalsCount', { count: 2 }),
    );
  });

  it('wires bridge restart, path probe and session queue actions', () => {
    const { connect, onOpenTab } = renderServices();

    fireEvent.click(screen.getByTestId('devbox-services-focus-bridge-action'));
    expect(connect.startStack).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('devbox-services-focus-path-action'));
    expect(connect.runCheck).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('devbox-services-focus-session-action'));
    expect(onOpenTab).toHaveBeenCalledWith('agent');
  });

  it('shows a stale probe as degraded, never as fresh green', () => {
    renderServices({ connect: connectFixture({ probeStale: true, probeOk: false }) });

    const path = screen.getByTestId('devbox-services-focus-path');
    expect(path.getAttribute('data-state')).toBe('degraded');
    expect(path.textContent).toContain(t('devboxPage.overviewProbeStale'));
  });
});

describe('DevboxServices capabilities', () => {
  it('lists profile runner commands', () => {
    renderServices();

    const runner = screen.getByTestId('devbox-services-runner-build');
    expect(runner.textContent).toContain('dotnet build --no-restore');
    expect(screen.getByTestId('devbox-services-runner').textContent).toContain(
      t('devboxPage.connectTokenHost'),
    );
  });

  it('keeps default-deny gateway rows visible but locked', () => {
    renderServices();

    for (const name of ['stitch-manager', 'lgm', 'ssh', 'playwright']) {
      const row = screen.getByTestId(`devbox-services-gateway-${name}`);
      expect(row.getAttribute('data-locked')).toBe('true');
      expect(row.textContent).toContain(t('devboxPage.servicesGatewayHardDeny'));
      expect(
        (screen.getByTestId(`devbox-services-gateway-${name}-toggle`).querySelector('input') as HTMLInputElement)
          .disabled,
      ).toBe(true);
      expect(
        (screen.getByTestId(`devbox-services-gateway-${name}-mode`) as HTMLSelectElement).disabled,
      ).toBe(true);
      expect(
        (screen.getByTestId(`devbox-services-gateway-${name}-allow`) as HTMLInputElement).disabled,
      ).toBe(true);
    }
  });

  it('loads candidates and saves the allowlisted gateway policy', async () => {
    renderServices();

    await waitFor(() => {
      expect(screen.getByTestId('devbox-services-gateway-context7')).toBeTruthy();
    });
    expect(devboxCallArgs(invokeMock, 'mcp_candidates')).toEqual([{ name: 'midsai' }]);

    fireEvent.click(screen.getByTestId('devbox-services-gateway-save'));

    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'profile_put')).toHaveLength(1);
    });
    const payload = JSON.parse(String(devboxCallArgs(invokeMock, 'profile_put')[0].json)) as {
      exposed_mcps: Array<{ name: string; mode: string; tool_allow: string[] }>;
    };
    expect(payload.exposed_mcps).toEqual([
      { name: 'context7', mode: 'readonly', tool_allow: ['resolve-library-id'] },
    ]);
  });

  it('copies the manifest URL with the INGRESS token hint', () => {
    renderServices();

    expect(screen.getByTestId('devbox-services-manifest').textContent).toContain(
      'https://devbox-abcd1234.loca.lt/p/9000/manifest.json',
    );
    expect(screen.getByTestId('devbox-services-manifest-copy')).toBeTruthy();
  });

  it('prefers PUBLIC_URL for the human-facing manifest link', () => {
    renderServices({
      connect: connectFixture({ savedPublicUrl: 'https://devbox.whitebite.ru' }),
    });

    expect(screen.getByTestId('devbox-services-manifest').textContent).toContain(
      'https://devbox.whitebite.ru/p/9000/manifest.json',
    );
  });

  it('links token management to Connect and never edits tokens here', () => {
    const { onOpenTab } = renderServices();

    fireEvent.click(screen.getByTestId('devbox-services-open-connect'));
    expect(onOpenTab).toHaveBeenCalledWith('connect');
    expect(screen.queryByTestId('devbox-connect-token-BRIDGE_TOKEN')).toBeNull();
  });
});

describe('DevboxServices port policy', () => {
  it('shows 8793 as hard-deny and refuses to add it', () => {
    renderServices();

    expect(screen.getByTestId('devbox-services-ports-denied').textContent).toContain('8793');
    expect(screen.getByTestId('devbox-services-ports-denied').textContent).toContain(
      t('devboxPage.servicesPortDenyHard'),
    );

    fireEvent.change(screen.getByTestId('devbox-services-port-input'), {
      target: { value: '8793' },
    });
    fireEvent.click(screen.getByTestId('devbox-services-port-add'));

    expect(screen.getByTestId('devbox-services-port-error').textContent).toBe(
      t('devboxPage.servicesPortsCockpitDenied'),
    );
    expect(devboxCallArgs(invokeMock, 'profile_put')).toHaveLength(0);
  });

  it('adds an allowed range through profile_put', async () => {
    renderServices();

    expect(screen.getByTestId('devbox-services-port-3000')).toBeTruthy();
    expect(screen.getByTestId('devbox-services-port-range-8100-8120')).toBeTruthy();

    fireEvent.change(screen.getByTestId('devbox-services-port-input'), {
      target: { value: '8200-8210' },
    });
    fireEvent.click(screen.getByTestId('devbox-services-port-add'));

    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'profile_put')).toHaveLength(1);
    });
    const payload = JSON.parse(String(devboxCallArgs(invokeMock, 'profile_put')[0].json)) as {
      allowed_ports: number[];
      port_ranges: Array<[number, number]>;
    };
    expect(payload.allowed_ports).toEqual([3000, 8787]);
    expect(payload.port_ranges).toEqual([
      [8100, 8120],
      [8200, 8210],
    ]);
  });

  it('removes a single port without destroying the range', async () => {
    renderServices();

    fireEvent.click(screen.getByTestId('devbox-services-port-remove-3000'));

    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'profile_put')).toHaveLength(1);
    });
    const payload = JSON.parse(String(devboxCallArgs(invokeMock, 'profile_put')[0].json)) as {
      allowed_ports: number[];
      port_ranges: Array<[number, number]>;
    };
    expect(payload.allowed_ports).toEqual([8787]);
    expect(payload.port_ranges).toEqual([[8100, 8120]]);
  });
});