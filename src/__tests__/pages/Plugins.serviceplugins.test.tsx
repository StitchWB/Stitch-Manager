/**
 * Plugins page — service-plugin section tests.
 *
 * Verifies:
 *   (a) Service plugin cards render from list_service_plugins data
 *       (id, version, status badge, restarts, uptime).
 *   (b) Dead plugin (status="error") shows a danger badge.
 *   (c) Restart button calls safeInvoke('restart_service_plugin', {plugin_id})
 *       and invalidates the servicePlugins cache (refetch).
 *   (d) Logs button calls safeInvoke('get_service_plugin_logs', ...) and
 *       shows the returned lines; empty array → "Logs unavailable".
 *
 * Mocks: invoke (safeInvoke), i18n (t = identity), Header, sonner, app store.
 * The real servicePlugins module runs — only safeInvoke is mocked, so the
 * cache + useSyncExternalStore + invalidate path is exercised end-to-end.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Plugins from '../../pages/Plugins';
import { safeInvoke } from '@/lib/backend/core/invoke';
import {
  _resetForTests,
  type ServicePluginInfo,
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
    restarts: 0,
    stopping: false,
  },
  ui: { kind: 'declarative', tabs: [] },
};

const deadPlugin: ServicePluginInfo = {
  id: 'broken',
  version: '0.1.0',
  status: {
    status: 'error',
    port: null,
    pid: null,
    uptimeSeconds: null,
    error: 'process exited with code 1',
    plugin_id: 'broken',
    restarts: 1,
    stopping: false,
  },
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Plugins page — service plugins section', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetForTests();
    // Default: list_service_plugins returns empty (so the role matrix
    // still loads without service plugin cards).
    (safeInvoke as jest.Mock).mockImplementation((cmd: string) => {
      if (cmd === 'list_service_plugins') return Promise.resolve([]);
      return Promise.resolve([]);
    });
    // Role matrix + users load fine.
    jest.spyOn(pluginGrantsModule, 'pluginGrantsRoleList').mockResolvedValue({
      roles: { user: [], vip: [], premium: [], elite: [], admin: ['*'] },
      plugins: [],
    });
    jest.spyOn(authModule, 'listUsers').mockResolvedValue([]);
  });

  it('(a) renders service plugin cards with id, version, status badge, restarts, uptime', async () => {
    (safeInvoke as jest.Mock).mockImplementation((cmd: string) => {
      if (cmd === 'list_service_plugins') return Promise.resolve([runningPlugin]);
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <Plugins />
      </MemoryRouter>,
    );

    // Card id + version appear.
    expect(await screen.findByText('echo')).toBeTruthy();
    expect(screen.getByText('v1.2.3')).toBeTruthy();

    // Running badge (i18n key resolves to itself since t = identity).
    expect(screen.getByText('admin.plugins.servicePluginRunning')).toBeTruthy();

    // Restarts + uptime labels.
    expect(screen.getByText(/admin\.plugins\.servicePluginRestarts/)).toBeTruthy();
    expect(screen.getByText(/admin\.plugins\.servicePluginUptime/)).toBeTruthy();

    // Restart + Logs buttons.
    expect(screen.getByText('admin.plugins.servicePluginRestart')).toBeTruthy();
    expect(screen.getByText('admin.plugins.servicePluginLogs')).toBeTruthy();
  });

  it('(b) dead plugin shows danger badge', async () => {
    (safeInvoke as jest.Mock).mockImplementation((cmd: string) => {
      if (cmd === 'list_service_plugins') return Promise.resolve([deadPlugin]);
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <Plugins />
      </MemoryRouter>,
    );

    // Dead badge label appears.
    expect(await screen.findByText('admin.plugins.servicePluginDead')).toBeTruthy();
    // Error text is surfaced.
    expect(screen.getByText('process exited with code 1')).toBeTruthy();
  });

  it('(c) restart button calls safeInvoke and invalidates cache (refetch)', async () => {
    let callCount = 0;
    (safeInvoke as jest.Mock).mockImplementation((cmd: string) => {
      if (cmd === 'list_service_plugins') {
        callCount++;
        return Promise.resolve([runningPlugin]);
      }
      if (cmd === 'restart_service_plugin') return Promise.resolve({ status: 'running' });
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <Plugins />
      </MemoryRouter>,
    );

    // Wait for mount fetch.
    await screen.findByText('echo');
    expect(callCount).toBe(1);

    // Click restart.
    const restartBtn = screen.getByText('admin.plugins.servicePluginRestart');
    await act(async () => {
      fireEvent.click(restartBtn);
    });

    // safeInvoke called with restart_service_plugin + plugin_id.
    await waitFor(() => {
      expect(safeInvoke).toHaveBeenCalledWith('restart_service_plugin', { plugin_id: 'echo' });
    });

    // Cache invalidated → list_service_plugins fetched again.
    await waitFor(() => {
      expect(callCount).toBeGreaterThanOrEqual(2);
    });

    // Success toast.
    await waitFor(() => {
      expect((require('sonner') as { toast: { success: jest.Mock } }).toast.success)
        .toHaveBeenCalledWith('admin.plugins.servicePluginRestarted');
    });
  });

  it('(d) logs button fetches and shows log lines; empty → unavailable', async () => {
    (safeInvoke as jest.Mock).mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'list_service_plugins') return Promise.resolve([runningPlugin]);
      if (cmd === 'get_service_plugin_logs') {
        // Return lines only for the first call; empty for the second test case.
        if (args?.plugin_id === 'echo') {
          return Promise.resolve(['[INFO] started', '[ERROR] something']);
        }
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <Plugins />
      </MemoryRouter>,
    );

    await screen.findByText('echo');

    // Click logs button.
    await act(async () => {
      fireEvent.click(screen.getByText('admin.plugins.servicePluginLogs'));
    });

    // Log lines appear (rendered in a <pre> joined by newlines).
    await waitFor(() => {
      const pre = document.querySelector('pre');
      expect(pre).toBeTruthy();
      expect(pre!.textContent).toContain('[INFO] started');
      expect(pre!.textContent).toContain('[ERROR] something');
    });
  });

  it('(d2) logs empty → shows unavailable message', async () => {
    (safeInvoke as jest.Mock).mockImplementation((cmd: string) => {
      if (cmd === 'list_service_plugins') return Promise.resolve([runningPlugin]);
      if (cmd === 'get_service_plugin_logs') return Promise.resolve([]);
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <Plugins />
      </MemoryRouter>,
    );

    await screen.findByText('echo');

    await act(async () => {
      fireEvent.click(screen.getByText('admin.plugins.servicePluginLogs'));
    });

    await waitFor(() => {
      expect(screen.getByText('admin.plugins.servicePluginLogsUnavailable')).toBeTruthy();
    });
  });

  it('shows empty state when no service plugins installed', async () => {
    (safeInvoke as jest.Mock).mockImplementation((cmd: string) => {
      if (cmd === 'list_service_plugins') return Promise.resolve([]);
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <Plugins />
      </MemoryRouter>,
    );

    expect(await screen.findByText('admin.plugins.servicePluginNoPlugins')).toBeTruthy();
  });
});
