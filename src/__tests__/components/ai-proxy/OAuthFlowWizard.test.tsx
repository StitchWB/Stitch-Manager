/**
 * OAuthFlowWizard tests.
 *
 * Verifies the plugin-owned OAuth flow driver:
 *   (a) renders the start button and queries the plugin's get_oauth_config.
 *   (b) start → calls plugin.{id}.auth_flow_start and opens the auth URL via
 *       the core open_url_in_browser command.
 *   (c) polls plugin.{id}.auth_flow_status until token_ready, then shows the
 *       success state and STOPS polling.
 *   (d) cancel during the pending phase calls plugin.{id}.auth_flow_cancel
 *       and returns to idle.
 *   (e) an oauth_not_configured rejection surfaces the dedicated hint.
 *
 * Mocks: safeInvoke (core invoke), openUrlInBrowser (aiProxy module),
 * i18n (t = identity), sonner toasts, and the ui barrel (Button/GlassCard).
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { safeInvoke } from '@/lib/backend/core/invoke';
import { openUrlInBrowser } from '@/lib/backend/modules/aiProxy';

jest.mock('@/lib/backend/core/invoke', () => ({
  setAuthExpiredHandler: jest.fn(),
  safeInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

jest.mock('@/lib/backend/modules/aiProxy', () => ({
  openUrlInBrowser: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

jest.mock('@/components/ui', () => ({
  Button: ({ children, onClick, disabled, variant: _v, size: _s, isLoading: _l, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
  GlassCard: ({ children }: any) => <div>{children}</div>,
  IconButton: ({ children, onClick, variant: _v, size: _s, ...rest }: any) => (
    <button onClick={onClick} {...rest}>
      {children}
    </button>
  ),
}));

// Import AFTER mocks are registered.
import { OAuthFlowWizard } from '@/components/ai-proxy/OAuthFlowWizard';

const PLUGIN_ID = 'stitch-antigravity';
const START_CMD = `plugin.${PLUGIN_ID}.auth_flow_start`;
const STATUS_CMD = `plugin.${PLUGIN_ID}.auth_flow_status`;
const CANCEL_CMD = `plugin.${PLUGIN_ID}.auth_flow_cancel`;
const CONFIG_CMD = `plugin.${PLUGIN_ID}.get_oauth_config`;

const safeInvokeMock = safeInvoke as jest.Mock;

function mockCommands(opts: {
  configured?: boolean;
  startError?: Error;
  statuses?: Array<{ phase: string; errorMessage?: string | null }>;
}) {
  const statuses = [...(opts.statuses ?? [])];
  safeInvokeMock.mockImplementation((cmd: unknown) => {
    if (cmd === CONFIG_CMD) {
      return Promise.resolve({
        providerId: 'antigravity',
        providerName: 'Antigravity',
        oauthProviderName: 'Google',
        configured: opts.configured ?? true,
      });
    }
    if (cmd === START_CMD) {
      if (opts.startError) return Promise.reject(opts.startError);
      return Promise.resolve({
        sessionId: 'sess-1',
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x',
        callbackPort: 49152,
        expiresAt: 0,
      });
    }
    if (cmd === STATUS_CMD) {
      return Promise.resolve(statuses.length ? statuses.shift() : { phase: 'pending' });
    }
    if (cmd === CANCEL_CMD) {
      return Promise.resolve({ cancelled: true });
    }
    return Promise.reject(new Error(`unexpected command ${String(cmd)}`));
  });
}

function callsFor(cmd: string): number {
  return safeInvokeMock.mock.calls.filter(c => c[0] === cmd).length;
}

describe('OAuthFlowWizard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('(a) renders the start button and fetches the oauth config', async () => {
    mockCommands({ configured: true });
    render(<OAuthFlowWizard pluginId={PLUGIN_ID} providerId="antigravity" />);

    expect(screen.getByTestId('oauth-flow-start')).toBeTruthy();
    await waitFor(() => expect(callsFor(CONFIG_CMD)).toBe(1));
  });

  it('(b) start invokes auth_flow_start and opens the auth URL', async () => {
    mockCommands({ statuses: [{ phase: 'pending' }] });
    render(
      <OAuthFlowWizard pluginId={PLUGIN_ID} providerId="antigravity" pollIntervalMs={10000} />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('oauth-flow-start'));
    });

    await waitFor(() => expect(callsFor(START_CMD)).toBe(1));
    expect(openUrlInBrowser).toHaveBeenCalledWith(
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=x',
    );
    // Poll interval is huge here: exactly one status call may be in flight.
    await screen.findByTestId('oauth-flow-cancel');
  });

  it('(c) stops polling on token_ready and shows success', async () => {
    mockCommands({
      statuses: [{ phase: 'pending' }, { phase: 'pending' }, { phase: 'token_ready' }],
    });
    render(
      <OAuthFlowWizard pluginId={PLUGIN_ID} providerId="antigravity" pollIntervalMs={5} />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('oauth-flow-start'));
    });

    await screen.findByTestId('oauth-flow-success');
    const statusCallsAtSuccess = callsFor(STATUS_CMD);
    expect(statusCallsAtSuccess).toBeGreaterThanOrEqual(3);

    // Polling has stopped: the count must not grow anymore.
    await new Promise(r => setTimeout(r, 50));
    expect(callsFor(STATUS_CMD)).toBe(statusCallsAtSuccess);
  });

  it('(d) cancel calls auth_flow_cancel and returns to idle', async () => {
    mockCommands({ statuses: [{ phase: 'pending' }] });
    render(
      <OAuthFlowWizard pluginId={PLUGIN_ID} providerId="antigravity" pollIntervalMs={10000} />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('oauth-flow-start'));
    });
    const cancelButton = await screen.findByTestId('oauth-flow-cancel');

    await act(async () => {
      fireEvent.click(cancelButton);
    });

    await waitFor(() => expect(callsFor(CANCEL_CMD)).toBe(1));
    expect(safeInvokeMock.mock.calls.find(c => c[0] === CANCEL_CMD)?.[1]).toEqual({
      sessionId: 'sess-1',
    });
    await screen.findByTestId('oauth-flow-start');
  });

  it('(e) oauth_not_configured rejection shows the not-configured hint', async () => {
    mockCommands({
      configured: false,
      startError: new Error(
        "Plugin 'stitch-antigravity' error: [-32603] oauth_not_configured",
      ),
    });
    render(<OAuthFlowWizard pluginId={PLUGIN_ID} providerId="antigravity" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('oauth-flow-start'));
    });

    await screen.findByTestId('oauth-flow-error');
    expect(screen.getByTestId('oauth-flow-error').textContent).toContain(
      'aiHub.oauthWizard.notConfigured',
    );
  });
});
