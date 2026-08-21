/**
 * AiTopTabs plugin-contributed tabs tests.
 *
 * Verifies:
 *   (a) A plugin with ui.tabs renders a dynamic tab after builtin tabs;
 *       clicking it navigates to /ai/plugin/{pluginId}.
 *   (b) safeInvoke rejection → only builtin tabs, no crash.
 *   (c) invalidate() triggers a refetch (safeInvoke called twice).
 *
 * Mocks: invoke (safeInvoke), i18n (t = identity), @/components/ui
 * (TabButton/Badge stubs), stores (app/auth/groups). The real
 * servicePlugins module runs — only safeInvoke is mocked, so the cache +
 * useSyncExternalStore + invalidate path is exercised end-to-end.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { useEffect } from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AiTopTabs } from '@/components/ai-proxy/AiTopTabs';
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

jest.mock('@/components/ui', () => ({
  TabButton: ({ label, onClick, active, icon }: any) => (
    <button
      type="button"
      data-testid="tab-button"
      onClick={onClick}
      aria-pressed={active}
    >
      {icon}
      <span>{label}</span>
    </button>
  ),
  Badge: ({ children }: any) => <span>{children}</span>,
}));

jest.mock('@/stores/app', () => ({
  useAppStore: (selector?: (s: any) => any) =>
    selector ? selector({ language: 'en' }) : { language: 'en' },
}));

jest.mock('@/stores/auth', () => ({
  useAuthStore: (selector?: (s: any) => any) =>
    selector ? selector({ enabled: false }) : { enabled: false },
}));

jest.mock('@/stores/groups', () => ({
  useGroupsStore: (selector?: (s: any) => any) =>
    selector ? selector({ invites: [] }) : { invites: [] },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Captures the current router pathname into a module-level variable. */
let navigatedPath = '/ai';

function LocationSpy() {
  const loc = useLocation();
  useEffect(() => {
    navigatedPath = loc.pathname;
  }, [loc.pathname]);
  return null;
}

const pluginFixture: ServicePluginInfo[] = [
  {
    id: 'echo',
    version: '1.0.0',
    status: 'running',
    ui: {
      kind: 'declarative',
      tabs: [{ id: 'main', label: 'Echo', icon: 'Puzzle' }],
    },
  },
];

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AiTopTabs plugin-contributed tabs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetForTests();
    navigatedPath = '/ai';
    (safeInvoke as jest.Mock).mockResolvedValue([]);
  });

  it('(a) renders a plugin tab and navigates to /ai/plugin/{id} on click', async () => {
    (safeInvoke as jest.Mock).mockResolvedValue(pluginFixture);

    render(
      <MemoryRouter initialEntries={['/ai']}>
        <LocationSpy />
        <AiTopTabs />
      </MemoryRouter>,
    );

    // Wait for fetchServicePlugins to resolve and the plugin tab to appear.
    const echoTab = await screen.findByText('Echo');
    expect(echoTab).toBeTruthy();

    // Builtin tabs are still present first.
    expect(screen.getByText('Overview')).toBeTruthy();

    await act(async () => {
      fireEvent.click(echoTab);
    });

    await waitFor(() => {
      expect(navigatedPath).toBe('/ai/plugin/echo');
    });
  });

  it('(b) safeInvoke rejects → only builtin tabs, no crash', async () => {
    (safeInvoke as jest.Mock).mockRejectedValue(new Error('backend down'));

    render(
      <MemoryRouter initialEntries={['/ai']}>
        <AiTopTabs />
      </MemoryRouter>,
    );

    // Wait for the fetch to settle (safeInvoke called, catch ran).
    await waitFor(() => {
      expect(safeInvoke).toHaveBeenCalledWith('list_service_plugins');
    });

    // Builtin tab is present; no plugin tab.
    expect(screen.getByText('Overview')).toBeTruthy();
    expect(screen.queryByText('Echo')).toBeNull();
  });

  it('(c) invalidate() triggers a refetch (safeInvoke called twice)', async () => {
    (safeInvoke as jest.Mock).mockResolvedValue(pluginFixture);

    render(
      <MemoryRouter initialEntries={['/ai']}>
        <AiTopTabs />
      </MemoryRouter>,
    );

    // Wait for the mount-fetch to settle.
    await screen.findByText('Echo');
    expect(safeInvoke).toHaveBeenCalledTimes(1);

    // Invalidate the cache — should trigger a second fetch.
    act(() => {
      invalidate();
    });

    await waitFor(() => {
      expect(safeInvoke).toHaveBeenCalledTimes(2);
    });
    expect(safeInvoke).toHaveBeenLastCalledWith('list_service_plugins');
  });
});
