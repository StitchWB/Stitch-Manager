/**
 * NotebookLM plugin-only UI tests (plan todo 24).
 *
 * The built-in NotebookLM domain was removed; the page is now served
 * exclusively by the `stitch-notebooklm` service plugin.
 *
 * Verifies:
 *   (a) safeInvoke list returns plugin with declarative ui -> DeclarativePage
 *       rendered (DeclarativePage module mocked to a stub div to assert
 *       selection).
 *   (b) list rejects / no plugin -> EmptyState rendered with
 *       `notebooklm.pluginNotInstalled` title (plugin not installed).
 *   (c) uninstall (invalidate + refetch without plugin) -> EmptyState again
 *       without reload (assert via rerender).
 *
 * Mocks: invoke (safeInvoke), i18n (t = identity), DeclarativePage (stub),
 * Header, AiTopTabs, sonner. The real servicePlugins module runs — only
 * safeInvoke is mocked, so the cache + useSyncExternalStore + invalidate
 * path is exercised end-to-end.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NotebookLM from '../../pages/NotebookLM';
import { safeInvoke } from '@/lib/backend/core/invoke';
import {
  invalidate,
  _resetForTests,
  type ServicePluginInfo,
} from '@/lib/backend/modules/servicePlugins';

// ── Module mocks ────────────────────────────────────────────────────────────

jest.mock('@/lib/backend/core/invoke', () => ({
  setAuthExpiredHandler: jest.fn(),
  safeInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

jest.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('@/components/plugin-ui/DeclarativePage', () => ({
  __esModule: true,
  default: ({ pluginId }: { pluginId: string; schema: unknown }) => (
    <div data-testid="declarative-page-stub" data-plugin-id={pluginId} />
  ),
}));

jest.mock('@/components/layout/Header', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => (
    <div data-testid="header">{title}</div>
  ),
}));

jest.mock('@/components/ai-proxy/AiTopTabs', () => ({
  AiTopTabs: () => <div data-testid="ai-top-tabs" />,
}));

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const notebooklmPluginFixture: ServicePluginInfo = {
  id: 'stitch-notebooklm',
  version: '1.0.0',
  status: {
    status: 'running',
    port: null,
    pid: 123,
    uptimeSeconds: 5,
    error: null,
    plugin_id: 'stitch-notebooklm',
    restarts: 0,
    stopping: false,
  },
  ui: {
    kind: 'declarative',
    page: {
      title: 'notebooklm.pluginTitle',
      nodes: [{ kind: 'heading', text: 'Notebooks', level: 2 }],
    },
  },
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('NotebookLM plugin-only UI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetForTests();
    // Default: list_service_plugins returns empty (no plugin installed).
    (safeInvoke as jest.Mock).mockImplementation((cmd: string) => {
      if (cmd === 'list_service_plugins') return Promise.resolve([]);
      return Promise.resolve([]);
    });
  });

  it('(a) plugin with declarative ui -> DeclarativePage rendered', async () => {
    (safeInvoke as jest.Mock).mockResolvedValue([notebooklmPluginFixture]);

    render(
      <MemoryRouter>
        <NotebookLM />
      </MemoryRouter>,
    );

    // DeclarativePage stub appears.
    const stub = await screen.findByTestId('declarative-page-stub');
    expect(stub.getAttribute('data-plugin-id')).toBe('stitch-notebooklm');

    // EmptyState is NOT rendered.
    expect(screen.queryByText('notebooklm.pluginNotInstalled')).toBeNull();
  });

  it('(b) no plugin -> EmptyState with pluginNotInstalled message', async () => {
    (safeInvoke as jest.Mock).mockRejectedValue(new Error('backend down'));

    render(
      <MemoryRouter>
        <NotebookLM />
      </MemoryRouter>,
    );

    // Wait for fetch to settle (safeInvoke called, catch ran, cache = []).
    await waitFor(() => {
      expect(safeInvoke).toHaveBeenCalledWith('list_service_plugins');
    });

    // EmptyState is rendered with the plugin-not-installed title.
    expect(screen.getByText('notebooklm.pluginNotInstalled')).toBeTruthy();

    // DeclarativePage stub is NOT rendered.
    expect(screen.queryByTestId('declarative-page-stub')).toBeNull();
  });

  it('(c) uninstall (invalidate + refetch without plugin) -> EmptyState again', async () => {
    // First: plugin present -> DeclarativePage rendered.
    (safeInvoke as jest.Mock).mockResolvedValue([notebooklmPluginFixture]);

    const { rerender } = render(
      <MemoryRouter>
        <NotebookLM />
      </MemoryRouter>,
    );

    // Wait for DeclarativePage stub to appear.
    await screen.findByTestId('declarative-page-stub');
    expect(screen.queryByText('notebooklm.pluginNotInstalled')).toBeNull();

    // Uninstall: next list_service_plugins call returns [] (no plugin).
    (safeInvoke as jest.Mock).mockResolvedValue([]);

    // Invalidate cache — triggers a refetch that empties the cache.
    act(() => {
      invalidate();
    });

    // Wait for the refetch to settle (safeInvoke called twice: mount + invalidate).
    await waitFor(() => {
      expect(safeInvoke).toHaveBeenCalledTimes(2);
    });

    // Rerender to assert the switch (useSyncExternalStore already
    // triggered a re-render; rerender makes the assertion explicit).
    rerender(
      <MemoryRouter>
        <NotebookLM />
      </MemoryRouter>,
    );

    // EmptyState is now rendered.
    await waitFor(() => {
      expect(screen.getByText('notebooklm.pluginNotInstalled')).toBeTruthy();
    });
    expect(screen.queryByTestId('declarative-page-stub')).toBeNull();
  });
});
