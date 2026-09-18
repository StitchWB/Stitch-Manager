/**
 * AiHubLayout rail navigation tests.
 *
 * Verifies:
 *   (a) The rail renders the grouped sections (sources/processing/usage)
 *       with their builtin items.
 *   (b) Active item marking follows the pathname (aria-current="page").
 *   (c) A plugin with ui.tabs renders the plugins group; clicking the tab
 *       navigates to /ai/plugin/{pluginId}.
 *   (d) Below md the rail collapses to icon-only: asserted via classes
 *       (w-12 / md:w-48, hidden md:inline labels) and Tooltip wrapping.
 *
 * Mocks: invoke (safeInvoke), i18n (t = identity), @/components/ui
 * (Badge/Tooltip stubs), stores (app/auth), useMediaQuery. The real
 * servicePlugins module runs — only safeInvoke is mocked, so the cache +
 * useSyncExternalStore path is exercised end-to-end.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { useEffect } from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AiHubLayout } from '@/components/ai-proxy/AiHubLayout';
import { safeInvoke } from '@/lib/backend/core/invoke';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import {
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
  Badge: ({ children }: any) => <span>{children}</span>,
  Tooltip: ({ children, content }: any) => (
    <div data-testid="tooltip-wrapper" data-content={content}>
      {children}
    </div>
  ),
}));

jest.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: jest.fn(() => false),
}));

jest.mock('@/stores/app', () => ({
  useAppStore: (selector?: (s: any) => any) =>
    selector ? selector({ language: 'en' }) : { language: 'en' },
}));

jest.mock('@/stores/auth', () => ({
  useAuthStore: (selector?: (s: any) => any) =>
    selector ? selector({ enabled: false }) : { enabled: false },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

let navigatedPath = '/ai';

function LocationSpy() {
  const loc = useLocation();
  useEffect(() => {
    navigatedPath = loc.pathname;
  }, [loc.pathname]);
  return null;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationSpy />
      <Routes>
        <Route element={<AiHubLayout />}>
          <Route path="/ai" element={<div data-testid="page-content" />} />
          <Route path="/ai/routing" element={<div data-testid="page-content" />} />
          <Route path="/ai/plugin/:id" element={<div data-testid="page-content" />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const pluginFixture: ServicePluginInfo[] = [
  {
    id: 'echo',
    version: '1.0.0',
    status: {
      status: 'running',
      port: null,
      pid: 123,
      uptimeSeconds: 5,
      error: null,
      plugin_id: 'echo',
      restarts: 0,
      stopping: false,
    },
    ui: {
      kind: 'declarative',
      tabs: [{ id: 'main', label: 'Echo', icon: 'Puzzle' }],
    },
  },
];

// ── Tests ────────────────────────────────────────────────────────────────────

describe('AiHubLayout rail navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetForTests();
    navigatedPath = '/ai';
    (safeInvoke as jest.Mock).mockResolvedValue([]);
    (useMediaQuery as jest.Mock).mockReturnValue(false);
  });

  it('(a) renders the grouped rail sections with builtin items', async () => {
    renderAt('/ai');

    expect(screen.getByTestId('ai-hub-rail')).toBeTruthy();
    expect(screen.getByTestId('ai-hub-group-header-sources')).toBeTruthy();
    expect(screen.getByTestId('ai-hub-group-header-processing')).toBeTruthy();
    expect(screen.getByTestId('ai-hub-group-header-usage')).toBeTruthy();

    // t is identity → keyed labels render as their keys.
    expect(screen.getByText('aiHub.tabs.providers')).toBeTruthy();
    expect(screen.getByText('Gateway')).toBeTruthy();
    expect(screen.getByText('aiHub.tabs.antigravity')).toBeTruthy();
    expect(screen.getByText('aiHub.tabs.routing')).toBeTruthy();
    expect(screen.getByText('Connections')).toBeTruthy();
    expect(screen.getByText('aiHub.tabs.monitor')).toBeTruthy();
    expect(screen.getByText('aiHub.tabs.chat')).toBeTruthy();
    expect(screen.getByText('aiHub.tabs.tools')).toBeTruthy();
    expect(screen.getByText('aiHub.tabs.notebooklm')).toBeTruthy();
    expect(screen.getByText('Overview')).toBeTruthy();

    // No plugins → no plugins group.
    expect(screen.queryByTestId('ai-hub-group-plugins')).toBeNull();
    expect(screen.getByTestId('page-content')).toBeTruthy();
  });

  it('(b) marks the active item from the pathname', () => {
    renderAt('/ai/routing');

    const routing = screen.getByTestId('ai-hub-rail-item-routing');
    expect(routing.getAttribute('aria-current')).toBe('page');

    const providers = screen.getByTestId('ai-hub-rail-item-providers');
    expect(providers.getAttribute('aria-current')).toBeNull();
    expect(screen.getByTestId('ai-hub-rail-item-overview').getAttribute('aria-current')).toBeNull();
  });

  it('(c) renders the plugins group and navigates to /ai/plugin/{id}', async () => {
    (safeInvoke as jest.Mock).mockResolvedValue(pluginFixture);

    renderAt('/ai');

    const echoTab = await screen.findByText('Echo');
    expect(screen.getByTestId('ai-hub-group-plugins')).toBeTruthy();
    expect(screen.getByTestId('ai-hub-group-header-plugins')).toBeTruthy();

    await act(async () => {
      fireEvent.click(echoTab);
    });

    await waitFor(() => {
      expect(navigatedPath).toBe('/ai/plugin/echo');
    });
  });

  it('(d) collapses to icon-only below md (class-based)', () => {
    (useMediaQuery as jest.Mock).mockReturnValue(false);
    renderAt('/ai');

    const rail = screen.getByTestId('ai-hub-rail');
    expect(rail.className).toContain('w-12');
    expect(rail.className).toContain('md:w-48');

    // Labels remain in the DOM but are CSS-hidden below md.
    const label = screen.getByText('Gateway');
    expect(label.className).toContain('hidden');
    expect(label.className).toContain('md:inline');

    // Group headers hidden below md.
    const header = screen.getByTestId('ai-hub-group-header-sources');
    expect(header.className).toContain('hidden');
    expect(header.className).toContain('md:block');

    // Icon-only mode wraps items in Tooltip and drops the title attribute.
    expect(screen.getAllByTestId('tooltip-wrapper').length).toBeGreaterThan(0);
    expect(screen.getByTestId('ai-hub-rail-item-routing').getAttribute('title')).toBeNull();
  });

  it('(d2) at md and up items expose title and no tooltip wrapper', () => {
    (useMediaQuery as jest.Mock).mockReturnValue(true);
    renderAt('/ai');

    expect(screen.queryByTestId('tooltip-wrapper')).toBeNull();
    expect(screen.getByTestId('ai-hub-rail-item-routing').getAttribute('title')).toBe(
      'aiHub.tabs.routing',
    );
  });
});
