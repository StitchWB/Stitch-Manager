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
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
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
let navigatedSearch = '';

function LocationSpy() {
  const loc = useLocation();
  useEffect(() => {
    navigatedPath = loc.pathname;
    navigatedSearch = loc.search;
  }, [loc.pathname, loc.search]);
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
          <Route path="/ai/antigravity" element={<div data-testid="page-content" />} />
          <Route path="/ai/devbox" element={<div data-testid="page-content" />} />
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
    navigatedSearch = '';
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
    expect(screen.queryByText('Gateway')).toBeNull();
    // The antigravity tab is plugin-contributed (stitch-antigravity), not a
    // builtin rail item.
    expect(screen.queryByText('aiHub.tabs.antigravity')).toBeNull();
    expect(screen.getByText('aiHub.tabs.routing')).toBeTruthy();
    expect(screen.getByText('aiHub.tabs.connections')).toBeTruthy();
    expect(screen.getByText('aiHub.tabs.monitor')).toBeTruthy();
    expect(screen.getByText('aiHub.tabs.chat')).toBeTruthy();
    // rail item + breadcrumb page label both render the overview key at /ai
    expect(screen.getAllByText('aiHub.tabs.overview').length).toBeGreaterThan(0);

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

  it('(c2) renders the stitch-antigravity plugin tab and navigates to its plugin page', async () => {
    (safeInvoke as jest.Mock).mockResolvedValue([
      {
        id: 'stitch-antigravity',
        version: '0.1.0',
        status: {
          status: 'running',
          port: null,
          pid: 42,
          uptimeSeconds: 5,
          error: null,
          plugin_id: 'stitch-antigravity',
          restarts: 0,
          stopping: false,
        },
        ui: {
          kind: 'declarative',
          tabs: [{ id: 'antigravity', label: 'stitch-antigravity.tab', icon: 'Orbit' }],
        },
      },
    ] satisfies ServicePluginInfo[]);

    renderAt('/ai');

    const tab = await screen.findByTestId('ai-hub-rail-item-plugin:stitch-antigravity:antigravity');
    expect(screen.getByTestId('ai-hub-group-plugins')).toBeTruthy();

    await act(async () => {
      fireEvent.click(tab);
    });

    await waitFor(() => {
      expect(navigatedPath).toBe('/ai/plugin/stitch-antigravity');
    });
  });

  it('(d) collapses to icon-only below md (class-based)', () => {
    (useMediaQuery as jest.Mock).mockReturnValue(false);
    renderAt('/ai');

    const rail = screen.getByTestId('ai-hub-rail');
    expect(rail.className).toContain('w-12');
    expect(rail.className).toContain('md:w-48');

    // Labels remain in the DOM but are CSS-hidden below md.
    const label = screen.getByText('aiHub.tabs.providers');
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

// ── F11: rail kind filter + core_page host-route mapping ────────────────────

function corePagePlugin(id: string, tabId: string, label: string): ServicePluginInfo {
  return {
    id,
    version: '1.0.0',
    status: {
      status: 'running',
      port: null,
      pid: 1,
      uptimeSeconds: 1,
      error: null,
      plugin_id: id,
      restarts: 0,
      stopping: false,
    },
    ui: {
      kind: 'core_page',
      tabs: [{ id: tabId, label }],
    },
  };
}

describe('AiHubLayout plugin rail kind filter (F11)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetForTests();
    navigatedPath = '/ai';
    navigatedSearch = '';
    (safeInvoke as jest.Mock).mockResolvedValue([]);
    (useMediaQuery as jest.Mock).mockReturnValue(false);
  });

  it('(i) core_page plugin tabs navigate to their real /ai host routes', async () => {
    // One plugin per render: navigating away from /ai unmounts the rail.
    const cases = [
      ['stitch-opencode', 'opencode', '/ai/opencode-config'],
      ['stitch-devbox', 'devbox', '/ai/devbox'],
    ] as const;
    for (const [pluginId, tabId, route] of cases) {
      _resetForTests();
      navigatedPath = '/ai';
      (safeInvoke as jest.Mock).mockResolvedValue([
        corePagePlugin(pluginId, tabId, tabId),
      ]);

      const view = renderAt('/ai');
      const tab = await screen.findByTestId(
        `ai-hub-rail-item-plugin:${pluginId}:${tabId}`,
      );
      await act(async () => {
        fireEvent.click(tab);
      });
      await waitFor(() => {
        expect(navigatedPath).toBe(route);
      });
      view.unmount();
    }
  });

  it('(j) stitch-cards core_page tab is hosted outside /ai and renders no rail item', async () => {
    (safeInvoke as jest.Mock).mockResolvedValue([
      corePagePlugin('stitch-cards', 'cards', 'Cards'),
    ]);

    renderAt('/ai');

    await waitFor(() => {
      expect(safeInvoke).toHaveBeenCalledWith('list_service_plugins');
    });
    expect(screen.queryByTestId('ai-hub-rail-item-plugin:stitch-cards:cards')).toBeNull();
  });

  it('(k) plugins without a declarative/core_page kind render no tab', async () => {
    (safeInvoke as jest.Mock).mockResolvedValue([
      {
        id: 'mystery',
        version: '1.0.0',
        status: {
          status: 'running',
          port: null,
          pid: 1,
          uptimeSeconds: 1,
          error: null,
          plugin_id: 'mystery',
          restarts: 0,
          stopping: false,
        },
        // Cast: simulates a manifest whose ui block predates the kind field.
        ui: { tabs: [{ id: 'main', label: 'Mystery' }] } as unknown as ServicePluginInfo['ui'],
      },
    ]);

    renderAt('/ai');

    await waitFor(() => {
      expect(safeInvoke).toHaveBeenCalledWith('list_service_plugins');
    });
    expect(screen.queryByTestId('ai-hub-rail-item-plugin:mystery:main')).toBeNull();
  });

  it('(l) declarative plugins keep the /ai/plugin/{id} route', async () => {
    (safeInvoke as jest.Mock).mockResolvedValue(pluginFixture);

    renderAt('/ai');

    const echoTab = await screen.findByTestId('ai-hub-rail-item-plugin:echo:main');
    await act(async () => {
      fireEvent.click(echoTab);
    });
    await waitFor(() => {
      expect(navigatedPath).toBe('/ai/plugin/echo');
    });
  });
});

// ── W3/P2.4: rail cleanup — tools/notebooklm removed, external core_page skipped ──

describe('AiHubLayout rail cleanup (P2.4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetForTests();
    navigatedPath = '/ai';
    navigatedSearch = '';
    (safeInvoke as jest.Mock).mockResolvedValue([]);
    (useMediaQuery as jest.Mock).mockReturnValue(false);
  });

  it('renders no rail items for the removed tools and notebooklm tabs', () => {
    renderAt('/ai');

    expect(screen.queryByTestId('ai-hub-rail-item-tools')).toBeNull();
    expect(screen.queryByTestId('ai-hub-rail-item-notebooklm')).toBeNull();
  });

  it('renders no rail item for a core_page plugin hosted outside /ai', async () => {
    (safeInvoke as jest.Mock).mockResolvedValue([
      corePagePlugin('stitch-mail', 'mail', 'Mail'),
    ]);

    renderAt('/ai');

    await waitFor(() => {
      expect(safeInvoke).toHaveBeenCalledWith('list_service_plugins');
    });
    expect(screen.queryByTestId('ai-hub-rail-item-plugin:stitch-mail:mail')).toBeNull();
  });

  it('keeps declarative plugin tabs in the rail', async () => {
    (safeInvoke as jest.Mock).mockResolvedValue([
      {
        id: 'stitch-bridges',
        version: '1.0.0',
        status: {
          status: 'running',
          port: null,
          pid: 7,
          uptimeSeconds: 5,
          error: null,
          plugin_id: 'stitch-bridges',
          restarts: 0,
          stopping: false,
        },
        ui: {
          kind: 'declarative',
          tabs: [{ id: 'main', label: 'Bridges', icon: 'Network' }],
        },
      },
    ] satisfies ServicePluginInfo[]);

    renderAt('/ai');

    expect(
      await screen.findByTestId('ai-hub-rail-item-plugin:stitch-bridges:main'),
    ).toBeTruthy();
  });
});

// ── W3/P2.7: rail labels through i18n + plugin icon map ─────────────────────

describe('AiHubLayout rail labels and plugin icons (P2.7)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetForTests();
    navigatedPath = '/ai';
    navigatedSearch = '';
    (safeInvoke as jest.Mock).mockResolvedValue([]);
    (useMediaQuery as jest.Mock).mockReturnValue(false);
  });

  it('resolves the overview and connections labels through i18n keys', () => {
    renderAt('/ai');

    expect(screen.getAllByText('aiHub.tabs.overview').length).toBeGreaterThan(0);
    expect(screen.getByText('aiHub.tabs.connections')).toBeTruthy();
  });

  it('renders the mapped lucide icon for a plugin tab instead of the Puzzle fallback', async () => {
    (safeInvoke as jest.Mock).mockResolvedValue([
      {
        id: 'stitch-radar',
        version: '1.0.0',
        status: {
          status: 'running',
          port: null,
          pid: 9,
          uptimeSeconds: 5,
          error: null,
          plugin_id: 'stitch-radar',
          restarts: 0,
          stopping: false,
        },
        ui: {
          kind: 'declarative',
          tabs: [{ id: 'radar', label: 'Radar', icon: 'Radar' }],
        },
      },
    ] satisfies ServicePluginInfo[]);

    renderAt('/ai');

    const item = await screen.findByTestId('ai-hub-rail-item-plugin:stitch-radar:radar');
    const svgClass = item.querySelector('svg')?.getAttribute('class') ?? '';
    expect(svgClass).toContain('lucide-radar');
    expect(svgClass).not.toContain('lucide-puzzle');
  });
});

// ── W3/P2.9: breadcrumb bar above the outlet ─────────────────────────────────

describe('AiHubLayout breadcrumb bar (P2.9)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetForTests();
    navigatedPath = '/ai';
    navigatedSearch = '';
    (safeInvoke as jest.Mock).mockResolvedValue([]);
    (useMediaQuery as jest.Mock).mockReturnValue(false);
  });

  it('renders three segments at /ai/routing?tab=proxy with only the last non-link', () => {
    renderAt('/ai/routing?tab=proxy');

    const breadcrumb = screen.getByTestId('ai-hub-breadcrumb');
    expect(breadcrumb).toBeTruthy();

    expect(within(breadcrumb).getByText('sidebar.aiHub').closest('a')).toBeTruthy();
    expect(within(breadcrumb).getByText('aiHub.tabs.routing').closest('a')).toBeTruthy();
    const tabSegment = within(breadcrumb).getByText('proxy');
    expect(tabSegment).toBeTruthy();
    expect(tabSegment.closest('a')).toBeNull();
  });

  it('renders two segments without a tab param and the page is the non-link', () => {
    renderAt('/ai/routing');

    const breadcrumb = screen.getByTestId('ai-hub-breadcrumb');
    expect(within(breadcrumb).getByText('sidebar.aiHub').closest('a')).toBeTruthy();
    const pageSegment = within(breadcrumb).getByText('aiHub.tabs.routing');
    expect(pageSegment.closest('a')).toBeNull();
    expect(within(breadcrumb).queryByText('proxy')).toBeNull();
  });
});

// ── W1.3: rail highlight for the antigravity and devbox host routes ──────────

describe('AiHubLayout rail highlight for canonical host routes (W1.3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetForTests();
    navigatedPath = '/ai';
    navigatedSearch = '';
    (safeInvoke as jest.Mock).mockResolvedValue([]);
    (useMediaQuery as jest.Mock).mockReturnValue(false);
  });

  it('highlights the stitch-antigravity plugin tab at /ai/antigravity, not providers', async () => {
    (safeInvoke as jest.Mock).mockResolvedValue([
      {
        id: 'stitch-antigravity',
        version: '0.1.0',
        status: {
          status: 'running',
          port: null,
          pid: 42,
          uptimeSeconds: 5,
          error: null,
          plugin_id: 'stitch-antigravity',
          restarts: 0,
          stopping: false,
        },
        ui: {
          kind: 'declarative',
          tabs: [{ id: 'antigravity', label: 'stitch-antigravity.tab', icon: 'Orbit' }],
        },
      },
    ] satisfies ServicePluginInfo[]);

    renderAt('/ai/antigravity');

    const tab = await screen.findByTestId('ai-hub-rail-item-plugin:stitch-antigravity:antigravity');
    expect(tab.getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('ai-hub-rail-item-providers').getAttribute('aria-current')).toBeNull();
  });

  it('highlights the stitch-devbox plugin tab at /ai/devbox, not providers', async () => {
    (safeInvoke as jest.Mock).mockResolvedValue([
      corePagePlugin('stitch-devbox', 'devbox', 'Devbox'),
    ]);

    renderAt('/ai/devbox');

    const tab = await screen.findByTestId('ai-hub-rail-item-plugin:stitch-devbox:devbox');
    expect(tab.getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('ai-hub-rail-item-providers').getAttribute('aria-current')).toBeNull();
  });
});
