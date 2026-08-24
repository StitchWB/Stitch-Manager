/**
 * Plugins page — per-user developer sandbox tests.
 *
 * Verifies:
 *   (a) Sandbox section renders for authenticated callers only (guests get
 *       nothing).
 *   (b) Install form validation — empty git URL is refused client-side.
 *   (c) Install success refreshes the sandbox list + success toast.
 *   (d) TOFU pin-mismatch refusal surfaces the error and a "force install"
 *       retry that re-submits with force:true.
 *   (e) Card actions call the right commands (restart; uninstall behind a
 *       confirm).
 *   (f) Playground execute POSTs the namespaced `plugin.{id}.{command}` route
 *       with the parsed JSON params and renders the response.
 *   (g) Playground refuses invalid JSON params client-side (no request).
 *
 * Mocks follow Plugins.installfrom.test.tsx / Plugins.serviceplugins.test.tsx:
 * safeInvoke is mocked (real sandboxPlugins module runs), plus the auth store
 * (to control the authenticated caller) and global fetch (the playground uses
 * a raw fetch to surface HTTP status codes, which safeInvoke would discard).
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Plugins from '../../pages/Plugins';
import { safeInvoke } from '@/lib/backend/core/invoke';
import { _resetForTests } from '@/lib/backend/modules/servicePlugins';
import type { SandboxPluginInfo } from '@/lib/backend/modules/sandboxPlugins';
import type { AuthUser } from '../../lib/backend/modules/auth';
import { useAuthStore } from '../../stores/auth';
import { askConfirm } from '../../components/ui/ConfirmDialogHost';
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
  default: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <div data-testid="header">
      {title}
      {actions}
    </div>
  ),
}));

jest.mock('../../stores/app', () => ({
  useAppStore: (selector?: (s: { language: string }) => unknown) =>
    selector ? selector({ language: 'en' }) : { language: 'en' },
}));

// The sandbox section gates on the auth store's `user`.
jest.mock('../../stores/auth', () => ({
  useAuthStore: jest.fn(),
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

// Simplified UI primitives for reliable test interaction.
jest.mock('../../components/ui/Input', () => ({
  Input: ({ label, error, hint, containerClassName, shellClassName, leftIcon, rightElement, prefixText, suffixText, ...props }: any) => (
    <div>
      {label && <label>{label}</label>}
      <input {...props} />
    </div>
  ),
}));

jest.mock('../../components/ui/Toggle', () => ({
  Toggle: ({ checked, onChange, label, ...rest }: any) => (
    <label>
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e: any) => onChange?.(e.target.checked)} {...rest} />
    </label>
  ),
}));

jest.mock('../../components/ui/Textarea', () => ({
  Textarea: ({ label, error, hint, containerClassName, shellClassName, ...props }: any) => (
    <div>
      {label && <label>{label}</label>}
      <textarea {...props} />
    </div>
  ),
}));

// ── Fixtures ────────────────────────────────────────────────────────────────

const AUTH_USER: AuthUser = { id: 1, username: 'dev', role: 'admin' };

const sandboxPlugin: SandboxPluginInfo = {
  id: 'myplug',
  version: '1.0.0',
  status: {
    status: 'running',
    calls: 5,
    errors: 1,
    restarts: 0,
    error: null,
    stopping: false,
    source: 'sandbox',
  },
  pinned_source: {
    sha: 'abcdef1234567890abcdef',
    url: 'https://github.com/foo/bar',
    installed_at: '2024-01-01T00:00:00+00:00',
  },
};

const useAuthStoreMock = useAuthStore as unknown as jest.Mock;

function setAuthUser(user: AuthUser | null): void {
  useAuthStoreMock.mockImplementation(
    (selector?: (s: { user: AuthUser | null }) => unknown) => {
      const state = { user };
      return selector ? selector(state) : state;
    },
  );
}

function defaultInvoke(): void {
  (safeInvoke as jest.Mock).mockImplementation((cmd: string) => {
    if (cmd === 'list_service_plugins') return Promise.resolve([]);
    if (cmd === 'sandbox_list') return Promise.resolve([]);
    return Promise.resolve([]);
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Plugins page — developer sandbox', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetForTests();
    defaultInvoke();
    jest.spyOn(pluginGrantsModule, 'pluginGrantsRoleList').mockResolvedValue({
      roles: { user: [], vip: [], premium: [], elite: [], admin: ['*'] },
      plugins: [],
    });
    jest.spyOn(authModule, 'listUsers').mockResolvedValue([]);
    // Fresh fetch stub per test (the playground issues a raw fetch).
    (globalThis as any).fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({}),
    }));
    setAuthUser(AUTH_USER);
  });

  it('(a) renders the sandbox section for authenticated users', async () => {
    render(
      <MemoryRouter>
        <Plugins />
      </MemoryRouter>,
    );
    expect(await screen.findByText('admin.plugins.sandbox.title')).toBeTruthy();
  });

  it('(a2) hides the sandbox section for guests', async () => {
    setAuthUser(null);
    render(
      <MemoryRouter>
        <Plugins />
      </MemoryRouter>,
    );
    await screen.findByTestId('header');
    await waitFor(() => {
      expect(screen.queryByText('admin.plugins.sandbox.title')).toBeNull();
    });
  });

  it('(b) refuses install with an empty git url (inline error, no backend call)', async () => {
    render(
      <MemoryRouter>
        <Plugins />
      </MemoryRouter>,
    );
    await screen.findByText('admin.plugins.sandbox.title');

    await act(async () => {
      fireEvent.click(screen.getByText('admin.plugins.sandbox.install.submit'));
    });

    await waitFor(() => {
      expect(screen.getByText('admin.plugins.sandbox.install.urlRequired')).toBeTruthy();
    });
    expect(safeInvoke).not.toHaveBeenCalledWith('sandbox_install', expect.anything());
  });

  it('(c) install success refreshes the sandbox list + success toast', async () => {
    let sandboxListCalls = 0;
    (safeInvoke as jest.Mock).mockImplementation((cmd: string) => {
      if (cmd === 'list_service_plugins') return Promise.resolve([]);
      if (cmd === 'sandbox_list') {
        sandboxListCalls++;
        return Promise.resolve([]);
      }
      if (cmd === 'sandbox_install') {
        return Promise.resolve({
          success: true,
          plugin_id: 'myplug',
          version: '1.0.0',
          pinned_sha: 'abcdef1234567890',
        });
      }
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <Plugins />
      </MemoryRouter>,
    );
    await screen.findByText('admin.plugins.sandbox.title');
    const initialCalls = sandboxListCalls;

    fireEvent.change(screen.getByPlaceholderText('https://github.com/user/plugin'), {
      target: { value: 'https://github.com/foo/bar' },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('admin.plugins.sandbox.install.submit'));
    });

    await waitFor(() => {
      expect(safeInvoke).toHaveBeenCalledWith(
        'sandbox_install',
        expect.objectContaining({ url: 'https://github.com/foo/bar' }),
      );
    });
    await waitFor(() => {
      expect(sandboxListCalls).toBeGreaterThan(initialCalls);
    });
    await waitFor(() => {
      expect((require('sonner') as { toast: { success: jest.Mock } }).toast.success)
        .toHaveBeenCalledWith('admin.plugins.sandbox.install.success');
    });
  });

  it('(d) pin-mismatch error shows a force-install retry with force:true', async () => {
    (safeInvoke as jest.Mock).mockImplementation((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'list_service_plugins') return Promise.resolve([]);
      if (cmd === 'sandbox_list') return Promise.resolve([]);
      if (cmd === 'sandbox_install') {
        if (args?.force === true) {
          return Promise.resolve({
            success: true,
            plugin_id: 'myplug',
            version: '1.0.0',
            pinned_sha: 'fedcba654321',
          });
        }
        return Promise.resolve({
          success: false,
          error:
            'pin mismatch for myplug: recorded sha abcdef123456…, ' +
            'new sha fedcba654321… — pass force=True to accept the change',
          reason: 'pin_mismatch',
        });
      }
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <Plugins />
      </MemoryRouter>,
    );
    await screen.findByText('admin.plugins.sandbox.title');

    fireEvent.change(screen.getByPlaceholderText('https://github.com/user/plugin'), {
      target: { value: 'https://github.com/foo/bar' },
    });
    await act(async () => {
      fireEvent.click(screen.getByText('admin.plugins.sandbox.install.submit'));
    });

    // The backend error (naming both shas) is surfaced inline.
    await waitFor(() => {
      expect(screen.getByText(/pin mismatch/)).toBeTruthy();
    });

    // Force-install path appears and re-submits with force:true.
    const forceBtn = await screen.findByText('admin.plugins.sandbox.install.forceInstall');
    await act(async () => {
      fireEvent.click(forceBtn);
    });
    await waitFor(() => {
      expect(safeInvoke).toHaveBeenCalledWith(
        'sandbox_install',
        expect.objectContaining({ force: true }),
      );
    });
  });

  it('(e) restart button calls sandbox_restart with the plugin id', async () => {
    (safeInvoke as jest.Mock).mockImplementation((cmd: string) => {
      if (cmd === 'list_service_plugins') return Promise.resolve([]);
      if (cmd === 'sandbox_list') return Promise.resolve([sandboxPlugin]);
      if (cmd === 'sandbox_restart') return Promise.resolve({ status: 'running' });
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <Plugins />
      </MemoryRouter>,
    );
    await screen.findByText('myplug');

    await act(async () => {
      fireEvent.click(screen.getByText('admin.plugins.sandbox.actions.restart'));
    });

    await waitFor(() => {
      expect(safeInvoke).toHaveBeenCalledWith('sandbox_restart', { plugin_id: 'myplug' });
    });
  });

  it('(e2) uninstall confirms then calls sandbox_uninstall', async () => {
    (safeInvoke as jest.Mock).mockImplementation((cmd: string) => {
      if (cmd === 'list_service_plugins') return Promise.resolve([]);
      if (cmd === 'sandbox_list') return Promise.resolve([sandboxPlugin]);
      if (cmd === 'sandbox_uninstall') return Promise.resolve({ success: true });
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <Plugins />
      </MemoryRouter>,
    );
    await screen.findByText('myplug');

    await act(async () => {
      fireEvent.click(screen.getByText('admin.plugins.sandbox.actions.uninstall'));
    });

    await waitFor(() => {
      expect(askConfirm).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(safeInvoke).toHaveBeenCalledWith('sandbox_uninstall', { plugin_id: 'myplug' });
    });
  });

  it('(f) playground execute POSTs the namespaced command with parsed JSON and renders the response', async () => {
    (safeInvoke as jest.Mock).mockImplementation((cmd: string) => {
      if (cmd === 'list_service_plugins') return Promise.resolve([]);
      if (cmd === 'sandbox_list') return Promise.resolve([sandboxPlugin]);
      return Promise.resolve([]);
    });
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ result: 'pong' }),
    }));
    (globalThis as any).fetch = fetchMock;

    render(
      <MemoryRouter>
        <Plugins />
      </MemoryRouter>,
    );
    await screen.findByText('myplug');

    // Open the playground.
    await act(async () => {
      fireEvent.click(screen.getByText('admin.plugins.sandbox.actions.playground'));
    });

    fireEvent.change(screen.getByPlaceholderText('echo'), { target: { value: 'ping' } });
    fireEvent.change(screen.getByPlaceholderText('{}'), { target: { value: '{"msg":"hi"}' } });

    await act(async () => {
      fireEvent.click(screen.getByText('admin.plugins.sandbox.playground.execute'));
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/plugin.myplug.ping'),
        expect.objectContaining({ body: JSON.stringify({ msg: 'hi' }) }),
      );
    });

    await waitFor(() => {
      const pres = Array.from(document.querySelectorAll('pre'));
      expect(pres.some(p => (p.textContent ?? '').includes('pong'))).toBe(true);
    });
  });

  it('(f2) playground renders the error body with its HTTP status code on a non-ok response', async () => {
    (safeInvoke as jest.Mock).mockImplementation((cmd: string) => {
      if (cmd === 'list_service_plugins') return Promise.resolve([]);
      if (cmd === 'sandbox_list') return Promise.resolve([sandboxPlugin]);
      return Promise.resolve([]);
    });
    const fetchMock = jest.fn(async () => ({
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ detail: 'Unknown plugin command' }),
    }));
    (globalThis as any).fetch = fetchMock;

    render(
      <MemoryRouter>
        <Plugins />
      </MemoryRouter>,
    );
    await screen.findByText('myplug');

    await act(async () => {
      fireEvent.click(screen.getByText('admin.plugins.sandbox.actions.playground'));
    });

    // Params default to "{}" (valid); only the command is set.
    fireEvent.change(screen.getByPlaceholderText('echo'), { target: { value: 'nope' } });

    await act(async () => {
      fireEvent.click(screen.getByText('admin.plugins.sandbox.playground.execute'));
    });

    await waitFor(() => {
      expect(screen.getByText('404')).toBeTruthy();
    });
    await waitFor(() => {
      const pres = Array.from(document.querySelectorAll('pre'));
      expect(pres.some(p => (p.textContent ?? '').includes('Unknown plugin command'))).toBe(true);
    });
  });

  it('(g) playground refuses invalid JSON params client-side (no request)', async () => {
    (safeInvoke as jest.Mock).mockImplementation((cmd: string) => {
      if (cmd === 'list_service_plugins') return Promise.resolve([]);
      if (cmd === 'sandbox_list') return Promise.resolve([sandboxPlugin]);
      return Promise.resolve([]);
    });
    const fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;

    render(
      <MemoryRouter>
        <Plugins />
      </MemoryRouter>,
    );
    await screen.findByText('myplug');

    await act(async () => {
      fireEvent.click(screen.getByText('admin.plugins.sandbox.actions.playground'));
    });

    fireEvent.change(screen.getByPlaceholderText('echo'), { target: { value: 'ping' } });
    fireEvent.change(screen.getByPlaceholderText('{}'), { target: { value: '{not valid json' } });

    await act(async () => {
      fireEvent.click(screen.getByText('admin.plugins.sandbox.playground.execute'));
    });

    await waitFor(() => {
      expect(screen.getByText('admin.plugins.sandbox.playground.invalidJson')).toBeTruthy();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
