/**
 * Devbox MCP section — rows from the normalized gateway block (name, mode
 * label, tools count), the configure empty state, and hiding when the
 * gateway block is absent.
 *
 * Mocks: safeInvoke (routed by command name), sonner. i18n runs REAL.
 */

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
import type { DevboxOverviewGateway } from '@/lib/backend/modules/devbox';
import { DevboxMcpSection } from '@/components/devbox/DevboxMcpSection';
import { devboxCallArgs, devboxRouter, gatewayFixture, pageRoutes } from './devboxTestKit';

const invokeMock = safeInvoke as jest.Mock;

function renderSection(gateway: DevboxOverviewGateway | null) {
  const onConfigure = jest.fn();
  const onSaved = jest.fn();
  render(
    <DevboxMcpSection
      gateway={gateway}
      activeProfile="midsai"
      onConfigure={onConfigure}
      onSaved={onSaved}
    />,
  );
  return { onConfigure, onSaved };
}

beforeEach(() => {
  jest.clearAllMocks();
  invokeMock.mockImplementation(
    devboxRouter(
      pageRoutes({
        mcp_candidates: {
          profile: 'midsai',
          error: null,
          candidates: [
            {
              name: 'codegraph',
              type: 'local',
              enabled: true,
              source: 'opencode.json',
              valid: true,
              error: null,
              command: ['python', '-m', 'codegraph'],
            },
            {
              name: 'remote-demo',
              type: 'remote',
              enabled: true,
              source: 'opencode.json',
              valid: false,
              error: 'remote MCP not supported',
              url: 'https://example.test/mcp',
            },
          ],
        },
        profile_get: {
          json: JSON.stringify({ project_dir: '/tmp/demo' }),
          valid: true,
          errors: [],
          git_placeholder: false,
        },
        profile_put: { valid: true, errors: [] },
      }),
    ),
  );
});

describe('DevboxMcpSection', () => {
  it('renders a row per exposed MCP with name, mode label and tools count', () => {
    renderSection(gatewayFixture);

    expect(screen.getByTestId('devbox-mcp-section').textContent).toContain(
      'MCP servers for the agent',
    );
    const totp = screen.getByTestId('devbox-mcp-row-stitch-totp');
    expect(totp.textContent).toContain('stitch-totp');
    expect(screen.getByTestId('devbox-mcp-mode-stitch-totp').textContent).toBe('read-only');
    expect(screen.getByTestId('devbox-mcp-tools-stitch-totp').textContent).toBe('2');
    expect(screen.getByTestId('devbox-mcp-mode-stitch-mail').textContent).toBe('full');
    expect(screen.getByTestId('devbox-mcp-tools-stitch-mail').textContent).toBe('2');
    expect(screen.getByTestId('devbox-mcp-configure')).toBeTruthy();
  });

  it('opens the MCP picker and lists config candidates', async () => {
    const { onConfigure } = renderSection({ ...gatewayFixture, exposed_mcps: [] });

    expect(screen.getByText('No MCP servers exposed to the agent')).toBeTruthy();
    fireEvent.click(screen.getByTestId('devbox-mcp-configure'));

    await waitFor(() => {
      expect(screen.getByText('MCP servers for this project')).toBeTruthy();
    });
    expect(devboxCallArgs(invokeMock, 'mcp_candidates')).toEqual([{ name: 'midsai' }]);
    expect(screen.getByText('codegraph')).toBeTruthy();
    expect(screen.getByText('remote MCP not supported')).toBeTruthy();
    expect(onConfigure).not.toHaveBeenCalled();
  });

  it('shows the empty state when the gateway is disabled', () => {
    renderSection({ ...gatewayFixture, enabled: false });

    expect(screen.getByTestId('devbox-mcp-configure')).toBeTruthy();
    expect(screen.queryByTestId('devbox-mcp-row-stitch-totp')).toBeNull();
  });

  it('hides the whole section when the gateway block is null', () => {
    renderSection(null);

    expect(screen.queryByTestId('devbox-mcp-section')).toBeNull();
  });
});
