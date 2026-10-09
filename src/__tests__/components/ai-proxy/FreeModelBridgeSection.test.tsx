/**
 * FreeModelBridgeSection contract test: lifecycle controls drive the
 * stitch-freemodel plugin commands and the connection test targets the
 * bridge port reported by the plugin status, never a hardcoded literal.
 */

import type { ReactNode } from 'react';
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

jest.mock('@/lib/i18n', () => ({ t: (k: string) => k }));
jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));
jest.mock('@/lib/backend/modules/aiProxy', () => ({
  getProxySettings: jest.fn(async () => ({}) as Record<string, unknown>),
  updateProxySettings: jest.fn(async (s: Record<string, unknown>) => s),
}));
jest.mock('@/lib/backend/modules/freeModelBridge', () => ({
  getFreeModelBridgeStatus: jest.fn(),
  startFreeModelBridge: jest.fn(),
  stopFreeModelBridge: jest.fn(),
}));
jest.mock('@/components/ui', () => ({
  GlassCard: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children?: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Input: (props: Record<string, unknown>) => <input {...(props as object)} />,
}));

import { FreeModelBridgeSection } from '@/components/ai-proxy/sections/FreeModelBridgeSection';
import {
  getFreeModelBridgeStatus,
  startFreeModelBridge,
  stopFreeModelBridge,
} from '@/lib/backend/modules/freeModelBridge';

const fetchMock = jest.fn(async () => ({
  ok: true,
  json: async () => ({ data: [{ id: 'FM-claude-sonnet-4-6' }] }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  (globalThis as any).fetch = fetchMock;
  (getFreeModelBridgeStatus as jest.Mock).mockResolvedValue({
    status: 'stopped',
    port: null,
    pid: null,
    uptimeSeconds: null,
  });
});

describe('FreeModelBridgeSection bridge controls', () => {
  it('queries the plugin status on mount and renders the stopped state', async () => {
    render(<FreeModelBridgeSection />);
    await waitFor(() => expect(getFreeModelBridgeStatus).toHaveBeenCalledTimes(1));
    expect(screen.getByText('aiHub.fmStatusStopped')).toBeTruthy();
  });

  it('starts the bridge via start_freemodel_bridge and shows the running port', async () => {
    (startFreeModelBridge as jest.Mock).mockResolvedValue({
      status: 'running',
      port: 4111,
      pid: 42,
      uptimeSeconds: 1,
    });
    render(<FreeModelBridgeSection />);
    await waitFor(() => expect(screen.getByText('common.start')).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByText('common.start'));
    });
    await waitFor(() => expect(startFreeModelBridge).toHaveBeenCalledTimes(1));
    expect(screen.getByText('aiHub.fmStatusRunning')).toBeTruthy();
    expect(screen.getByText('common.stop')).toBeTruthy();
  });

  it('stops the bridge via stop_freemodel_bridge', async () => {
    (getFreeModelBridgeStatus as jest.Mock).mockResolvedValue({
      status: 'running',
      port: 4111,
      pid: 42,
      uptimeSeconds: 10,
    });
    (stopFreeModelBridge as jest.Mock).mockResolvedValue({
      status: 'stopped',
      port: 4111,
      pid: null,
      uptimeSeconds: null,
    });
    render(<FreeModelBridgeSection />);
    await waitFor(() => expect(screen.getByText('common.stop')).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByText('common.stop'));
    });
    await waitFor(() => expect(stopFreeModelBridge).toHaveBeenCalledTimes(1));
    expect(screen.getByText('aiHub.fmStatusStopped')).toBeTruthy();
  });

  it('tests the bridge on the status-reported port, not a literal', async () => {
    (getFreeModelBridgeStatus as jest.Mock).mockResolvedValue({
      status: 'running',
      port: 4111,
      pid: 42,
      uptimeSeconds: 10,
    });
    render(<FreeModelBridgeSection />);
    await waitFor(() => expect(screen.getByText('apiKeys.testConnection')).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByText('apiKeys.testConnection'));
    });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'http://127.0.0.1:4111/v1/models',
        expect.objectContaining({ headers: expect.anything() }),
      ),
    );
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => u.includes('25583'))).toBe(false);
    expect(await screen.findByText('aiHub.fmModelsAvailable')).toBeTruthy();
  });

  it('refuses the connection test without a bridge port', async () => {
    render(<FreeModelBridgeSection />);
    await waitFor(() => expect(screen.getByText('apiKeys.testConnection')).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByText('apiKeys.testConnection'));
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await screen.findByText('aiHub.fmBridgeNotRunning')).toBeTruthy();
  });
});
