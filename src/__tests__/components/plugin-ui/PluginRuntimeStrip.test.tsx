/**
 * PluginRuntimeStrip + PluginPageHost runtime-controls tests.
 *
 * Strip:
 *   (a) running badge for a running plugin
 *   (b) danger badge + error excerpt for an error plugin
 *   (c) stopping flag → warning badge
 *   (d) enabled===false → "disabled" warning badge wins over status
 *   (e) admin toggle calls set_service_plugin_enabled with correct params
 *   (f) admin restart calls restart_service_plugin; spinner while pending
 *   (g) invoke rejection → error toast
 *   (h) non-admin (auth enabled, role=user): no controls, badge visible
 *   (i) desktop (auth disabled): controls visible
 *   (j) onChanged NOT fired on disable
 *   (k) onChanged fired on enable only when result is running
 *   (l) error-status result surfaces inline error, no onChanged
 *
 * Host:
 *   (m) disabled plugin → banner, declarative tree NOT mounted (no plugin.* invokes)
 *   (n) enabled plugin → tree mounts
 *
 * Mocks: invoke (safeInvoke), i18n (t = identity), toast, auth store.
 * The real servicePlugins module runs against the mocked safeInvoke so the
 * await-fetch-before-resolve cache path is exercised end-to-end.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { PluginRuntimeStrip } from '@/components/plugins/ServicePluginRuntimeControls';
import { PluginPageHost } from '@/components/plugin-ui/DeclarativePage';
import { safeInvoke } from '@/lib/backend/core/invoke';
import { appToast } from '@/lib/observability/toast';
import {
  _resetForTests,
  type ServicePluginInfo,
  type ServicePluginStatus,
} from '@/lib/backend/modules/servicePlugins';

// ── Auth store mock (mutable per-test) ──────────────────────────────────────

let mockAuthState: { user: { role: string; preview_role?: string | null } | null; enabled: boolean } = {
  user: { role: 'admin' },
  enabled: true,
};

jest.mock('@/stores/auth', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector(mockAuthState),
  effectiveRole: (user: { role: string; preview_role?: string | null } | null) =>
    (user ? (user.preview_role ?? user.role) : null),
}));

jest.mock('@/lib/backend/core/invoke', () => ({
  setAuthExpiredHandler: jest.fn(),
  safeInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

jest.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('@/lib/observability/toast', () => ({
  appToast: {
    error: jest.fn(),
    success: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
  },
}));

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeStatus(over: Partial<ServicePluginStatus> = {}): ServicePluginStatus {
  return {
    status: 'running',
    port: 4123,
    pid: 42,
    uptimeSeconds: 30,
    error: null,
    plugin_id: 'echo',
    restarts: 0,
    stopping: false,
    ...over,
  };
}

function makePlugin(over: Partial<ServicePluginInfo> = {}): ServicePluginInfo {
  return {
    id: 'echo',
    version: '1.0.0',
    enabled: true,
    status: makeStatus(),
    ui: { kind: 'declarative', page: { title: 'Echo', nodes: [] } },
    ...over,
  };
}

function enabledResult(plugin: ServicePluginInfo, enabled = true, statusOver: Partial<ServicePluginStatus> = {}) {
  return {
    id: plugin.id,
    enabled,
    status: { ...plugin.status, ...statusOver },
  };
}

function setupInvokes(plugins: ServicePluginInfo[], extra?: (cmd: string, args?: Record<string, unknown>) => unknown) {
  (safeInvoke as jest.Mock).mockImplementation((cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'list_service_plugins') return Promise.resolve(plugins);
    if (extra) {
      const r = extra(cmd, args);
      if (r !== undefined) return r;
    }
    return Promise.resolve(null);
  });
}

// ── Strip tests ─────────────────────────────────────────────────────────────

describe('PluginRuntimeStrip', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetForTests();
    mockAuthState = { user: { role: 'admin' }, enabled: true };
  });

  it('(a) running plugin shows the running badge + pid/uptime/restarts', () => {
    render(<PluginRuntimeStrip plugin={makePlugin()} />);
    expect(screen.getByText('admin.plugins.servicePluginRunning')).toBeTruthy();
    expect(screen.getByText(/pluginUi\.runtime\.pid/)).toBeTruthy();
    expect(screen.getByText(/30s/)).toBeTruthy();
    expect(screen.getByText(/pluginUi\.runtime\.restarts/)).toBeTruthy();
  });

  it('(b) error plugin shows danger badge + error excerpt', () => {
    const plugin = makePlugin({ status: makeStatus({ status: 'error', pid: null, error: 'boom: exited 1' }) });
    render(<PluginRuntimeStrip plugin={plugin} />);
    expect(screen.getByText('admin.plugins.servicePluginDead')).toBeTruthy();
    expect(screen.getByText('boom: exited 1')).toBeTruthy();
  });

  it('(c) stopping flag shows the warning restarting badge', () => {
    const plugin = makePlugin({ status: makeStatus({ stopping: true }) });
    render(<PluginRuntimeStrip plugin={plugin} />);
    expect(screen.getByText('admin.plugins.servicePluginRestarting')).toBeTruthy();
  });

  it('(d) enabled===false → disabled badge wins over a running status', () => {
    const plugin = makePlugin({ enabled: false });
    render(<PluginRuntimeStrip plugin={plugin} />);
    expect(screen.getByText('pluginUi.runtime.disabled')).toBeTruthy();
    expect(screen.queryByText('admin.plugins.servicePluginRunning')).toBeNull();
  });

  it('(e) admin toggle off calls set_service_plugin_enabled(id, false); no onChanged on disable', async () => {
    const plugin = makePlugin();
    setupInvokes([plugin], cmd =>
      cmd === 'set_service_plugin_enabled' ? Promise.resolve(enabledResult(plugin, false, { status: 'stopped' })) : undefined,
    );
    const onChanged = jest.fn();
    render(<PluginRuntimeStrip plugin={plugin} onChanged={onChanged} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox'));
    });

    await waitFor(() => {
      expect(safeInvoke).toHaveBeenCalledWith('set_service_plugin_enabled', {
        plugin_id: 'echo',
        enabled: false,
      });
    });
    // Cache refetch awaited before resolution.
    await waitFor(() => {
      expect(safeInvoke).toHaveBeenCalledWith('list_service_plugins');
    });
    expect(onChanged).not.toHaveBeenCalled();
    expect(appToast.success).toHaveBeenCalledWith('pluginUi.runtime.disabledToast', 'plugins');
  });

  it('(f) restart button calls restart_service_plugin; spinner shows while pending', async () => {
    const plugin = makePlugin();
    let resolveRestart: ((v: unknown) => void) | null = null;
    setupInvokes([plugin], cmd => {
      if (cmd === 'restart_service_plugin') {
        return new Promise(resolve => {
          resolveRestart = resolve;
        });
      }
      return undefined;
    });
    const { container } = render(<PluginRuntimeStrip plugin={makePlugin()} />);

    fireEvent.click(screen.getByText('pluginUi.runtime.restart'));

    // While pending: spinning icon.
    await waitFor(() => {
      expect(container.querySelector('.animate-spin')).toBeTruthy();
    });

    await act(async () => {
      resolveRestart?.(enabledResult(plugin, true));
    });

    await waitFor(() => {
      expect(safeInvoke).toHaveBeenCalledWith('restart_service_plugin', { plugin_id: 'echo' });
    });
    await waitFor(() => {
      expect(container.querySelector('.animate-spin')).toBeNull();
    });
  });

  it('(g) invoke rejection → error toast, no crash', async () => {
    setupInvokes([], cmd =>
      cmd === 'restart_service_plugin' ? Promise.reject(new Error('500')) : undefined,
    );
    render(<PluginRuntimeStrip plugin={makePlugin()} />);

    await act(async () => {
      fireEvent.click(screen.getByText('pluginUi.runtime.restart'));
    });

    await waitFor(() => {
      expect(appToast.error).toHaveBeenCalledWith('pluginUi.runtime.actionFailedToast', 'plugins');
    });
  });

  it('(h) non-admin sees the badge but no controls', () => {
    mockAuthState = { user: { role: 'user' }, enabled: true };
    render(<PluginRuntimeStrip plugin={makePlugin()} />);
    expect(screen.getByText('admin.plugins.servicePluginRunning')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText('pluginUi.runtime.restart')).toBeNull();
  });

  it('(i) desktop (auth disabled) shows controls', () => {
    mockAuthState = { user: null, enabled: false };
    render(<PluginRuntimeStrip plugin={makePlugin()} />);
    expect(screen.getByRole('checkbox')).toBeTruthy();
    expect(screen.getByText('pluginUi.runtime.restart')).toBeTruthy();
  });

  it('(k) enable toggle on fires onChanged only when result is running', async () => {
    const plugin = makePlugin({ enabled: false, status: makeStatus({ status: 'stopped', pid: null }) });
    setupInvokes([plugin], cmd =>
      cmd === 'set_service_plugin_enabled'
        ? Promise.resolve(enabledResult(plugin, true, { status: 'running', pid: 42 }))
        : undefined,
    );
    const onChanged = jest.fn();
    render(<PluginRuntimeStrip plugin={plugin} onChanged={onChanged} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox'));
    });

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
    expect(appToast.success).toHaveBeenCalledWith('pluginUi.runtime.enabledToast', 'plugins');
  });

  it('(k2) enable result NOT running → no onChanged', async () => {
    const plugin = makePlugin({ enabled: false, status: makeStatus({ status: 'stopped', pid: null }) });
    setupInvokes([plugin], cmd =>
      cmd === 'set_service_plugin_enabled'
        ? Promise.resolve(enabledResult(plugin, true, { status: 'stopped' }))
        : undefined,
    );
    const onChanged = jest.fn();
    render(<PluginRuntimeStrip plugin={plugin} onChanged={onChanged} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox'));
    });

    await waitFor(() => {
      expect(safeInvoke).toHaveBeenCalledWith('set_service_plugin_enabled', expect.anything());
    });
    await waitFor(() => {
      expect(appToast.success).toHaveBeenCalled();
    });
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('(l) error-status result surfaces inline error, no onChanged', async () => {
    const plugin = makePlugin({ enabled: false, status: makeStatus({ status: 'stopped', pid: null, error: null }) });
    setupInvokes([plugin], cmd =>
      cmd === 'set_service_plugin_enabled'
        ? Promise.resolve(enabledResult(plugin, true, { status: 'error', error: 'init handshake failed' }))
        : undefined,
    );
    const onChanged = jest.fn();
    render(<PluginRuntimeStrip plugin={plugin} onChanged={onChanged} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('runtime-strip-error').textContent).toContain('init handshake failed');
    });
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('(l2) restart success toast + onChanged when running', async () => {
    const plugin = makePlugin();
    setupInvokes([plugin], cmd =>
      cmd === 'restart_service_plugin' ? Promise.resolve(enabledResult(plugin, true)) : undefined,
    );
    const onChanged = jest.fn();
    render(<PluginRuntimeStrip plugin={plugin} onChanged={onChanged} />);

    await act(async () => {
      fireEvent.click(screen.getByText('pluginUi.runtime.restart'));
    });

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
    expect(appToast.success).toHaveBeenCalledWith('pluginUi.runtime.restartedToast', 'plugins');
  });
});

// ── Host tests ──────────────────────────────────────────────────────────────

function renderHost(id: string): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[`/plugins/${id}`]}>
      <Routes>
        <Route path="/plugins/:id" element={<PluginPageHost />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PluginPageHost runtime controls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetForTests();
    mockAuthState = { user: { role: 'admin' }, enabled: true };
  });

  const schemaWithSource = {
    title: 'Echo',
    nodes: [
      { kind: 'markdown', id: 'md', source: { command: 'content' }, textKey: 'text' },
    ],
  };

  it('(m) disabled plugin → banner, tree NOT mounted, no plugin.* invokes', async () => {
    const plugin = makePlugin({
      enabled: false,
      status: makeStatus({ status: 'stopped', pid: null }),
      ui: { kind: 'declarative', page: schemaWithSource },
    });
    setupInvokes([plugin]);

    renderHost('echo');

    expect(await screen.findByText('pluginUi.runtime.disabledBannerTitle')).toBeTruthy();
    expect(screen.getByText('pluginUi.runtime.disabledBannerDescription')).toBeTruthy();
    // Runtime strip is still rendered above the banner.
    expect(screen.getByTestId('plugin-runtime-strip')).toBeTruthy();
    // Admins get an inline Enable button.
    expect(screen.getByText('pluginUi.runtime.enable')).toBeTruthy();

    // The declarative tree never mounted: no namespaced plugin command fired.
    const pluginCalls = (safeInvoke as jest.Mock).mock.calls.filter(
      ([cmd]) => typeof cmd === 'string' && cmd.startsWith('plugin.'),
    );
    expect(pluginCalls).toHaveLength(0);
  });

  it('(n) enabled plugin → declarative tree mounts and fires source commands', async () => {
    const plugin = makePlugin({
      ui: { kind: 'declarative', page: schemaWithSource },
    });
    setupInvokes([plugin], cmd =>
      cmd === 'plugin.echo.content' ? Promise.resolve({ text: 'hello' }) : undefined,
    );

    renderHost('echo');

    await waitFor(() => {
      expect(
        (safeInvoke as jest.Mock).mock.calls.some(([cmd]) => cmd === 'plugin.echo.content'),
      ).toBe(true);
    });
    expect(screen.queryByText('pluginUi.runtime.disabledBannerTitle')).toBeNull();
    expect(screen.getByTestId('plugin-runtime-strip')).toBeTruthy();
  });

  it('(o) unknown plugin id → not-installed empty state after first fetch', async () => {
    setupInvokes([]);
    renderHost('nope');
    expect(await screen.findByText('pluginUi.pluginNotInstalled')).toBeTruthy();
  });
});
