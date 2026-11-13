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
import { devboxCallArgs, devboxRouter, pageRoutes } from './devboxTestKit';

const invokeMock = safeInvoke as jest.Mock;

const sampleEntries = [
  {
    key: 'INGRESS_MODE',
    value: 'cloudflare',
    secret: false,
    readonly: false,
    section: 'ingress',
  },
  {
    key: 'RELAY_SUBDOMAIN',
    value: 'my-relay',
    secret: false,
    readonly: false,
    section: 'ingress',
  },
  {
    key: 'TUNNEL_TOKEN',
    value: 'abcd...wxyz',
    secret: true,
    readonly: false,
    section: 'ingress',
  },
  {
    key: 'EGRESS_CONTAINER',
    value: 'rdm-egress',
    secret: false,
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
    value: 'auto-allow',
    secret: false,
    readonly: true,
    section: 'managed',
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  invokeMock.mockImplementation(
    devboxRouter(
      pageRoutes({
        env_get: { entries: sampleEntries },
        env_set: { valid: true, errors: [], restart: ['ingress', 'stack'] },
      }),
    ),
  );
});

describe('DevboxSettingsCard', () => {
  it('loads and renders entries grouped by section, masks secrets, and marks readonly fields disabled', async () => {
    render(<DevboxSettingsCard />);

    await waitFor(() => {
      expect(screen.getByTestId('devbox-settings')).toBeTruthy();
    });

    expect(screen.getByTestId('devbox-settings-group-ingress')).toBeTruthy();
    expect(screen.getByTestId('devbox-settings-group-egress')).toBeTruthy();
    expect(screen.getByTestId('devbox-settings-group-runtime')).toBeTruthy();
    expect(screen.getByTestId('devbox-settings-group-managed')).toBeTruthy();

    const ingressInput = screen.getByTestId(
      'devbox-settings-input-INGRESS_MODE',
    ) as HTMLInputElement;
    expect(ingressInput.value).toBe('cloudflare');
    expect(ingressInput.disabled).toBe(false);

    const secretInput = screen.getByTestId(
      'devbox-settings-input-TUNNEL_TOKEN',
    ) as HTMLInputElement;
    expect(secretInput.type).toBe('password');
    expect(secretInput.value).toBe('abcd...wxyz');

    const toggleBtn = screen.getByTestId('devbox-settings-toggle-TUNNEL_TOKEN');
    fireEvent.click(toggleBtn);
    expect(secretInput.type).toBe('text');
    fireEvent.click(toggleBtn);
    expect(secretInput.type).toBe('password');

    const readonlyInput = screen.getByTestId(
      'devbox-settings-input-OPENCODE_MCP_PERMISSIONS',
    ) as HTMLInputElement;
    expect(readonlyInput.disabled).toBe(true);
    expect(screen.getByTestId('devbox-settings-readonly-OPENCODE_MCP_PERMISSIONS')).toBeTruthy();

    const saveBtn = screen.getByTestId('devbox-settings-save') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it('enables save on changes, sends only changed patch to env_set, and triggers restart callbacks', async () => {
    const onRestart = jest.fn();
    const onSaved = jest.fn();

    render(<DevboxSettingsCard onRestart={onRestart} onSaved={onSaved} />);

    await waitFor(() => {
      expect(screen.getByTestId('devbox-settings-input-RELAY_SUBDOMAIN')).toBeTruthy();
    });

    const relayInput = screen.getByTestId('devbox-settings-input-RELAY_SUBDOMAIN');
    fireEvent.change(relayInput, { target: { value: 'new-subdomain' } });

    const saveBtn = screen.getByTestId('devbox-settings-save') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);

    fireEvent.click(saveBtn);

    await waitFor(() => {
      const calls = devboxCallArgs(invokeMock, 'env_set');
      expect(calls.length).toBe(1);
      expect(calls[0]).toEqual({
        patch: {
          RELAY_SUBDOMAIN: 'new-subdomain',
        },
      });
    });

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('devbox-settings-saved-badge')).toBeTruthy();
      expect(screen.getByTestId('devbox-settings-restart-banner')).toBeTruthy();
    });

    const restartIngressBtn = screen.getByTestId('devbox-settings-restart-ingress');
    fireEvent.click(restartIngressBtn);
    expect(onRestart).toHaveBeenCalledWith('ingress');

    const restartStackBtn = screen.getByTestId('devbox-settings-restart-stack');
    fireEvent.click(restartStackBtn);
    expect(onRestart).toHaveBeenCalledWith('stack');
  });

  it('displays backend validation errors when env_set fails', async () => {
    invokeMock.mockImplementation(
      devboxRouter(
        pageRoutes({
          env_get: { entries: sampleEntries },
          env_set: { valid: false, errors: ['Invalid subdomain format', 'Invalid token'], restart: [] },
        }),
      ),
    );

    render(<DevboxSettingsCard />);

    await waitFor(() => {
      expect(screen.getByTestId('devbox-settings-input-RELAY_SUBDOMAIN')).toBeTruthy();
    });

    const relayInput = screen.getByTestId('devbox-settings-input-RELAY_SUBDOMAIN');
    fireEvent.change(relayInput, { target: { value: 'bad subdomain!' } });

    fireEvent.click(screen.getByTestId('devbox-settings-save'));

    await waitFor(() => {
      const errorsBox = screen.getByTestId('devbox-settings-errors');
      expect(errorsBox.textContent).toContain('Invalid subdomain format');
      expect(errorsBox.textContent).toContain('Invalid token');
    });
  });
});
