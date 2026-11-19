import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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
import { DevboxSettingsCard } from '@/components/devbox/DevboxSettingsCard';
import { devboxCallArgs, devboxCalls, devboxRouter, pageRoutes } from './devboxTestKit';

const invokeMock = safeInvoke as jest.Mock;

const STANDARD_PERMISSIONS = JSON.stringify({
  edit: 'ask',
  write: 'ask',
  apply_patch: 'ask',
  bash: 'ask',
  webfetch: 'allow',
});

const entries = [
  { key: 'INGRESS_MODE', value: 'relay', secret: false, readonly: false, section: 'ingress' },
  {
    key: 'RELAY_SUBDOMAIN',
    value: 'my-relay',
    secret: false,
    readonly: false,
    section: 'ingress',
  },
  {
    key: 'PUBLIC_URL',
    value: 'https://old.example.test',
    secret: false,
    readonly: false,
    section: 'ingress',
  },
  { key: 'TUNNEL_TOKEN', value: 'abcd...wxyz', secret: true, readonly: false, section: 'ingress' },
  {
    key: 'EGRESS_CONTAINER',
    value: 'rdm-egress',
    secret: false,
    readonly: false,
    section: 'egress',
  },
  {
    key: 'VLESS_SUB_URL',
    value: 'https://subs...',
    secret: true,
    readonly: false,
    section: 'egress',
  },
  {
    key: 'JOB_TIMEOUT_SECONDS',
    value: '1800',
    secret: false,
    readonly: false,
    section: 'runtime',
  },
  {
    key: 'OPENCODE_MCP_PERMISSIONS',
    value: STANDARD_PERMISSIONS,
    secret: false,
    readonly: true,
    section: 'managed',
  },
];

const connectionOk = { ok: true, url: 'https://my-relay.loca.lt', tools: 16, latency_ms: 120 };

function wire(routes: Record<string, unknown>) {
  invokeMock.mockImplementation(
    devboxRouter(
      pageRoutes({
        env_get: { entries },
        connection_check: connectionOk,
        ...routes,
      }),
    ),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  wire({ env_set: { valid: true, errors: [], restart: [] } });
});

describe('DevboxSettingsCard', () => {
  it('shows the relay input only and reports the live entry status', async () => {
    render(<DevboxSettingsCard />);

    await waitFor(() => {
      expect(screen.getByTestId('devbox-settings-input-RELAY_SUBDOMAIN')).toBeTruthy();
    });

    expect(screen.queryByTestId('devbox-settings-input-PUBLIC_URL')).toBeNull();
    expect(screen.getByTestId('devbox-settings-access-hint').textContent).toContain('Standard');

    await waitFor(() => {
      expect(screen.getByTestId('devbox-settings-status').textContent).toContain('16');
    });
  });

  it('switches to manual and shows the public URL input', async () => {
    render(<DevboxSettingsCard />);

    await waitFor(() => {
      expect(screen.getByTestId('devbox-settings-ingress')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Manual / own tunnel'));

    await waitFor(() => {
      expect(screen.getByTestId('devbox-settings-input-PUBLIC_URL')).toBeTruthy();
    });
    expect(screen.queryByTestId('devbox-settings-input-RELAY_SUBDOMAIN')).toBeNull();
    expect(screen.getByTestId('devbox-settings-input-PUBLIC_URL').getAttribute('placeholder')).toContain('my-vps');

    fireEvent.click(screen.getByTestId('devbox-settings-save'));

    await waitFor(() => {
      const calls = devboxCallArgs(invokeMock, 'env_set');
      expect(calls.length).toBe(1);
      expect(calls[0]).toEqual({ patch: { INGRESS_MODE: 'manual' } });
    });
  });

  it('re-runs the connection check when the window regains focus', async () => {
    render(<DevboxSettingsCard />);

    await waitFor(() => {
      expect(screen.getByTestId('devbox-settings-status').textContent).toContain('16');
    });
    const before = devboxCalls(invokeMock, 'connection_check').length;

    window.dispatchEvent(new Event('focus'));

    await waitFor(() => {
      expect(devboxCalls(invokeMock, 'connection_check').length).toBeGreaterThan(before);
    });
  });

  it('switches to cloudflare and saves only the changed mode', async () => {    render(<DevboxSettingsCard />);

    await waitFor(() => {
      expect(screen.getByTestId('devbox-settings-ingress')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Cloudflare'));

    await waitFor(() => {
      expect(screen.getByTestId('devbox-settings-input-PUBLIC_URL')).toBeTruthy();
    });
    expect(screen.queryByTestId('devbox-settings-input-RELAY_SUBDOMAIN')).toBeNull();

    fireEvent.click(screen.getByTestId('devbox-settings-save'));

    await waitFor(() => {
      const calls = devboxCallArgs(invokeMock, 'env_set');
      expect(calls.length).toBe(1);
      expect(calls[0]).toEqual({ patch: { INGRESS_MODE: 'cloudflare' } });
    });
  });

  it('keeps advanced collapsed until opened', async () => {
    render(<DevboxSettingsCard />);

    await waitFor(() => {
      expect(screen.getByTestId('devbox-settings-advanced-toggle')).toBeTruthy();
    });

    expect(screen.queryByTestId('devbox-settings-select-EGRESS_CONTAINER')).toBeNull();
    fireEvent.click(screen.getByTestId('devbox-settings-advanced-toggle'));
    await waitFor(() => {
      expect(screen.getByTestId('devbox-settings-select-EGRESS_CONTAINER')).toBeTruthy();
    });
  });

  it('saves the timeout and offers the restart actions', async () => {
    const onRestart = jest.fn();
    wire({ env_set: { valid: true, errors: [], restart: ['stack'] } });

    render(<DevboxSettingsCard onRestart={onRestart} />);

    await waitFor(() => {
      expect(screen.getByTestId('devbox-settings-input-JOB_TIMEOUT_SECONDS')).toBeTruthy();
    });

    fireEvent.change(screen.getByTestId('devbox-settings-input-JOB_TIMEOUT_SECONDS'), {
      target: { value: '600' },
    });
    fireEvent.click(screen.getByTestId('devbox-settings-save'));

    await waitFor(() => {
      const calls = devboxCallArgs(invokeMock, 'env_set');
      expect(calls[0]).toEqual({ patch: { JOB_TIMEOUT_SECONDS: '600' } });
    });

    await waitFor(() => {
      expect(screen.getByTestId('devbox-settings-restart-banner')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('devbox-settings-restart-stack'));
    expect(onRestart).toHaveBeenCalledWith('stack');
  });

  it('renders backend validation errors', async () => {
    wire({ env_set: { valid: false, errors: ['RELAY_SUBDOMAIN: expected a dns label'], restart: [] } });

    render(<DevboxSettingsCard />);

    await waitFor(() => {
      expect(screen.getByTestId('devbox-settings-input-RELAY_SUBDOMAIN')).toBeTruthy();
    });

    fireEvent.change(screen.getByTestId('devbox-settings-input-RELAY_SUBDOMAIN'), {
      target: { value: 'Bad Name' },
    });
    fireEvent.click(screen.getByTestId('devbox-settings-save'));

    await waitFor(() => {
      expect(screen.getByTestId('devbox-settings-errors').textContent).toContain('dns label');
    });
  });
});