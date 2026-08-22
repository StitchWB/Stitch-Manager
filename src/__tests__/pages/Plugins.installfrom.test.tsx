/**
 * Plugins page — install-from-source dialog tests.
 *
 * Verifies:
 *   (a) Dialog renders when the "Install from source" button is clicked:
 *       title, url input, mode select, submit button visible.
 *   (b) Repo mode (default): submit builds exact payload
 *       {url, ref, trust} — trust defaults to false.
 *   (c) Release mode: submit builds exact payload
 *       {url, release, expected_sha256} — sha256 included only when provided.
 *   (d) Success path: safeInvoke resolves → invalidateServicePlugins called
 *       (list_service_plugins refetched) + success toast with id/version.
 *   (e) Error path: safeInvoke rejects → error toast with message.
 *
 * Mocks: invoke (safeInvoke), i18n (t = identity), Header, sonner, app store,
 * and UI primitives (Modal/Input/Select/Toggle) simplified to native elements.
 * The real servicePlugins module runs — only safeInvoke is mocked, so the
 * cache + useSyncExternalStore + invalidate path is exercised end-to-end.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Plugins from '../../pages/Plugins';
import { safeInvoke } from '@/lib/backend/core/invoke';
import { _resetForTests } from '@/lib/backend/modules/servicePlugins';
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
jest.mock('../../components/ui/Modal', () => ({
  Modal: ({ children, isOpen, title, footer }: any) =>
    isOpen ? <div><h3>{title}</h3>{children}{footer}</div> : null,
}));

jest.mock('../../components/ui/Input', () => ({
  Input: ({ label, error, hint, containerClassName, shellClassName, leftIcon, rightElement, prefixText, suffixText, ...props }: any) => (
    <div>
      {label && <label>{label}</label>}
      <input {...props} />
    </div>
  ),
}));

jest.mock('../../components/ui/Select', () => ({
  Select: ({ value, onValueChange, options, label, ...rest }: any) => (
    <div>
      {label && <label>{label}</label>}
      <select value={value} onChange={(e: any) => onValueChange?.(e.target.value)} {...rest}>
        {options?.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
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

// ── Helpers ──────────────────────────────────────────────────────────────────

async function openDialog() {
  await waitFor(() => {
    expect(screen.getByTestId('header')).toBeTruthy();
  });
  await act(async () => {
    fireEvent.click(screen.getByText('admin.plugins.installFromSource.title'));
  });
}

function fillInput(placeholder: string, value: string) {
  const input = screen.getByPlaceholderText(placeholder);
  fireEvent.change(input, { target: { value } });
}

async function submit() {
  await act(async () => {
    fireEvent.click(screen.getByText('admin.plugins.installFromSource.submit'));
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Plugins page — install from source dialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetForTests();
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

  it('(a) renders dialog with title, url input, mode select, submit button', async () => {
    render(
      <MemoryRouter>
        <Plugins />
      </MemoryRouter>,
    );

    await openDialog();

    // Modal title (rendered as <h3>).
    expect(screen.getByRole('heading', { name: 'admin.plugins.installFromSource.title' })).toBeTruthy();
    // URL input.
    expect(screen.getByPlaceholderText('https://github.com/user/plugin')).toBeTruthy();
    // Mode select (native <select> with repo as default value).
    expect(screen.getByDisplayValue('repo@ref')).toBeTruthy();
    // Submit button.
    expect(screen.getByText('admin.plugins.installFromSource.submit')).toBeTruthy();
  });

  it('(b) repo mode: submit builds exact payload {url, ref, trust}', async () => {
    render(
      <MemoryRouter>
        <Plugins />
      </MemoryRouter>,
    );

    await openDialog();

    fillInput('https://github.com/user/plugin', 'https://github.com/foo/bar');
    fillInput('main', 'main');

    await submit();

    await waitFor(() => {
      expect(safeInvoke).toHaveBeenCalledWith('install_plugin_from_source', {
        url: 'https://github.com/foo/bar',
        ref: 'main',
        trust: false,
      });
    });
  });

  it('(c) release mode: submit builds exact payload {url, release, expected_sha256}', async () => {
    render(
      <MemoryRouter>
        <Plugins />
      </MemoryRouter>,
    );

    await openDialog();

    // Switch to release mode.
    const modeSelect = screen.getByDisplayValue('repo@ref');
    await act(async () => {
      fireEvent.change(modeSelect, { target: { value: 'release' } });
    });

    fillInput('https://github.com/user/plugin', 'https://github.com/foo/bar');
    fillInput('v1.0.0', 'v1.0.0');
    fillInput('e3b0c44298fc1c14...', 'abc123');

    await submit();

    await waitFor(() => {
      expect(safeInvoke).toHaveBeenCalledWith('install_plugin_from_source', {
        url: 'https://github.com/foo/bar',
        release: 'v1.0.0',
        expected_sha256: 'abc123',
      });
    });
  });

  it('(d) success path: invalidates servicePlugins cache + success toast', async () => {
    let listCallCount = 0;
    (safeInvoke as jest.Mock).mockImplementation((cmd: string) => {
      if (cmd === 'list_service_plugins') {
        listCallCount++;
        return Promise.resolve([]);
      }
      if (cmd === 'install_plugin_from_source') {
        return Promise.resolve({ id: 'test-plugin', version: '1.0.0' });
      }
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <Plugins />
      </MemoryRouter>,
    );

    await openDialog();

    const initialCount = listCallCount;

    fillInput('https://github.com/user/plugin', 'https://github.com/foo/bar');
    fillInput('main', 'main');

    await submit();

    // Cache invalidated → list_service_plugins fetched again.
    await waitFor(() => {
      expect(listCallCount).toBeGreaterThan(initialCount);
    });

    // Success toast (t is identity-mocked, so the key string is passed
    // directly; the real t() would interpolate {id}/{version}).
    await waitFor(() => {
      expect((require('sonner') as { toast: { success: jest.Mock } }).toast.success)
        .toHaveBeenCalledWith('admin.plugins.installFromSource.success');
    });
  });

  it('(e) error path: shows error toast with message', async () => {
    (safeInvoke as jest.Mock).mockImplementation((cmd: string) => {
      if (cmd === 'list_service_plugins') return Promise.resolve([]);
      if (cmd === 'install_plugin_from_source') {
        return Promise.reject(new Error('clone failed'));
      }
      return Promise.resolve([]);
    });

    render(
      <MemoryRouter>
        <Plugins />
      </MemoryRouter>,
    );

    await openDialog();

    fillInput('https://github.com/user/plugin', 'https://github.com/foo/bar');
    fillInput('main', 'main');

    await submit();

    await waitFor(() => {
      expect((require('sonner') as { toast: { error: jest.Mock } }).toast.error)
        .toHaveBeenCalledWith(expect.stringContaining('admin.plugins.installFromSource.failed'));
    });
  });
});
