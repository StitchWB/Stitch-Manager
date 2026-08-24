/**
 * Plugins page — global service-plugin metrics tests.
 *
 * Verifies that the global service-plugin cards surface metrics:
 *   (a) Inline counters (calls, errors) render from list_service_plugins
 *       status (always-available cheap snapshot).
 *   (b) Expand (Metrics toggle) fetches the namespaced route
 *       `plugin.{id}.metrics` via safeInvoke and renders avg latency +
 *       by_command rows.
 *   (c) Fetch failure renders inline error text (never crashes).
 *   (d) Refresh button re-fetches the metrics route.
 *
 * The service-plugins section is NOT auth-gated (only the developer
 * sandbox section is — see SandboxSection.tsx), so no guest-hiding test
 * applies here; this matches the existing section behavior.
 *
 * Mocks follow Plugins.serviceplugins.test.tsx: safeInvoke is mocked
 * (real servicePlugins module runs), so the cache +
 * useSyncExternalStore + invalidate path is exercised end-to-end.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Plugins from '../../pages/Plugins';
import { safeInvoke } from '@/lib/backend/core/invoke';
import {
  _resetForTests,
  type ServicePluginInfo,
  type ServicePluginMetrics,
} from '@/lib/backend/modules/servicePlugins';
import * as pluginGrantsModule from '../../lib/backend/modules/pluginGrants';
import * as authModule from '../../lib/backend/modules/auth';

// ── Module mocks ────────────────────────────────────────────────────────────

jest.mock('../../lib/backend/core/invoke', () => ({
  setAuthExpiredHandler: jest.fn(),
  safeInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

jest.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('../../components/layout/Header', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <div data-testid="header">{title}</div>,
}));

jest.mock('../../stores/app', () => ({
  useAppStore: (selector?: (s: { language: string }) => unknown) =>
    selector ? selector({ language: 'en' }) : { language: 'en' },
}));

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

jest.mock('../../components/ui/ConfirmDialogHost', () => ({
  ConfirmDialogHost: () => null,
  askConfirm: jest.fn(() => Promise.resolve(true)),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const runningPlugin: ServicePluginInfo = {
  id: 'echo',
  version: '1.2.3',
  status: {
    status: 'running',
    port: null,
    pid: 42,
    uptimeSeconds: 30,
    error: null,
    plugin_id: 'echo',
    restarts: 1,
    stopping: false,
    calls: 10,
    errors: 2,
    source: 'global',
  },
  ui: { kind: 'declarative', tabs: [] },
};

const metricsResponse: ServicePluginMetrics = {
  calls: 10,
  errors: 2,
  avg_latency_ms: 42.5,
  last_error: 'echo: boom',
  by_command: {
    ping: { calls: 6, errors: 0 },
    pong: { calls: 4, errors: 2 },
  },
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Plugins page — service plugin metrics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetForTests();
    // Default: list_service_plugins returns empty; metrics route 404s.
    (safeInvoke as jest.Mock).mockImplementation((cmd: string) => {
      if (cmd === 'list_service_plugins') return Promise.resolve([]);
      return Promise.resolve([]);
    });
    jest.spyOn(pluginGrantsModule, 'pluginGrantsRoleList').mockResolvedValue({
      roles: { user: [], vip: [], premium: [], elite: [], admin: ['*'] },
      plugins: [],
    });
    jest.spyOn(authModule, 'listUsers').mockResolvedValue([]);
  });

  it('(a) renders inline calls/errors counters from list_service_plugins status', async () => {
    (safeInvoke as jest.Mock).mockImplementation((cmd: string) => {
      if (cmd === 'list_service_plugins') return Promise.resolve([runningPlugin]);
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <Plugins />
      </MemoryRouter>,
    );

    // Card id appears.
    expect(await screen.findByText('echo')).toBeTruthy();

    // Inline counters (calls: 10, errors: 2) render alongside restarts.
    expect(screen.getByText(/admin\.plugins\.servicePlugin\.metrics\.calls/)).toBeTruthy();
    expect(screen.getByText(/admin\.plugins\.servicePlugin\.metrics\.errors/)).toBeTruthy();
    // Restarts counter still present.
    expect(screen.getByText(/admin\.plugins\.servicePluginRestarts/)).toBeTruthy();

    // Metrics toggle button is present.
    expect(screen.getByText('admin.plugins.servicePlugin.metrics.toggle')).toBeTruthy();
  });

  it('(b) expand fetches plugin.{id}.metrics and renders avg latency + by_command rows', async () => {
    (safeInvoke as jest.Mock).mockImplementation((cmd: string) => {
      if (cmd === 'list_service_plugins') return Promise.resolve([runningPlugin]);
      if (cmd === 'plugin.echo.metrics') return Promise.resolve(metricsResponse);
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <Plugins />
      </MemoryRouter>,
    );

    await screen.findByText('echo');

    // Click the Metrics toggle.
    await act(async () => {
      fireEvent.click(screen.getByText('admin.plugins.servicePlugin.metrics.toggle'));
    });

    // safeInvoke called with the namespaced metrics route.
    await waitFor(() => {
      expect(safeInvoke).toHaveBeenCalledWith('plugin.echo.metrics', {}, { noCache: true });
    });

    // Avg latency renders inside a compound span (label + value + unit),
    // so match by regex against the span's full text content.
    await waitFor(() => {
      expect(screen.getByText(/42\.5/)).toBeTruthy();
    });

    // by_command rows render (command names + their counters in cells).
    expect(screen.getByText('ping')).toBeTruthy();
    expect(screen.getByText('pong')).toBeTruthy();
    // 6 = ping calls, 4 = pong calls (each in its own <td>).
    expect(screen.getByText('6')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
  });

  it('(c) fetch failure renders inline error text (never crashes)', async () => {
    (safeInvoke as jest.Mock).mockImplementation((cmd: string) => {
      if (cmd === 'list_service_plugins') return Promise.resolve([runningPlugin]);
      if (cmd === 'plugin.echo.metrics') return Promise.reject(new Error('boom'));
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <Plugins />
      </MemoryRouter>,
    );

    await screen.findByText('echo');

    await act(async () => {
      fireEvent.click(screen.getByText('admin.plugins.servicePlugin.metrics.toggle'));
    });

    // Inline error text appears (i18n key resolves to itself).
    await waitFor(() => {
      expect(screen.getByText('admin.plugins.servicePlugin.metrics.loadFailed')).toBeTruthy();
    });
  });

  it('(d) refresh button re-fetches the metrics route', async () => {
    let metricsCalls = 0;
    (safeInvoke as jest.Mock).mockImplementation((cmd: string) => {
      if (cmd === 'list_service_plugins') return Promise.resolve([runningPlugin]);
      if (cmd === 'plugin.echo.metrics') {
        metricsCalls++;
        return Promise.resolve(metricsResponse);
      }
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <Plugins />
      </MemoryRouter>,
    );

    await screen.findByText('echo');

    // Expand the metrics panel.
    await act(async () => {
      fireEvent.click(screen.getByText('admin.plugins.servicePlugin.metrics.toggle'));
    });
    await waitFor(() => {
      expect(metricsCalls).toBe(1);
    });

    // Click the refresh button inside the panel.
    const refreshBtn = screen.getByText('admin.plugins.servicePlugin.metrics.refresh');
    await act(async () => {
      fireEvent.click(refreshBtn);
    });

    // Metrics route fetched again.
    await waitFor(() => {
      expect(metricsCalls).toBe(2);
    });
  });
});
