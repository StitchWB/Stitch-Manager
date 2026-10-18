/**
 * MarketplaceDetailHeader Open action tests.
 *
 * Verifies the Open button resolves through CORE_PAGE_ROUTES: a core_page
 * plugin (stitch-cards) opens its real host route (/tools), while a
 * declarative plugin (stitch-relaycheck) opens /ai/plugin/{id}.
 *
 * Also covers update semantics: the Update button and the version arrow
 * follow hasPluginUpdate (server flag with semver fallback, "newer" not
 * "different") and are suppressed for plugins-local dev copies.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { useEffect } from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { MarketplaceDetailHeader } from '@/components/marketplace/MarketplaceDetailHeader';
import { useServicePlugins } from '@/hooks/useServicePlugins';
import type { MarketplaceItem } from '@/lib/backend/modules/marketplace';
import type { ServicePluginInfo } from '@/lib/backend/modules/servicePlugins';

jest.mock('@/lib/backend/core/invoke', () => ({
  setAuthExpiredHandler: jest.fn(),
  safeInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

jest.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('@/hooks/useServicePlugins', () => ({
  useServicePlugins: jest.fn(),
}));

let navigatedPath = '';
let navigatedSearch = '';

function LocationSpy() {
  const loc = useLocation();
  useEffect(() => {
    navigatedPath = loc.pathname;
    navigatedSearch = loc.search;
  }, [loc.pathname, loc.search]);
  return null;
}

function mkItem(overrides: Partial<MarketplaceItem> = {}): MarketplaceItem {
  return {
    id: 'stitch-cards',
    name: 'Stitch Cards',
    description: null,
    author: null,
    version: '1.0.0',
    source: 'official',
    entitled: true,
    installed: true,
    installed_version: '1.0.0',
    can_download: true,
    ...overrides,
  };
}

function mkPlugin(id: string, kind: 'declarative' | 'core_page'): ServicePluginInfo {
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
      kind,
      tabs: [{ id: 'main', label: 'Main' }],
    },
  };
}

const onInstall = jest.fn();
const onUninstall = jest.fn();
const onToggleEnabled = jest.fn();
const onLockedClick = jest.fn();

function renderHeader(item: MarketplaceItem) {
  return render(
    <MemoryRouter initialEntries={['/marketplace']}>
      <LocationSpy />
      <Routes>
        <Route
          path="/marketplace"
          element={
            <MarketplaceDetailHeader
              item={item}
              busy={false}
              isGuest={false}
              sourceLabel="official"
              onInstall={onInstall}
              onUninstall={onUninstall}
              onToggleEnabled={onToggleEnabled}
              onLockedClick={onLockedClick}
            />
          }
        />
        <Route path="/tools" element={<div data-testid="terminal" />} />
        <Route path="/totp" element={<div data-testid="terminal" />} />
        <Route path="/logs" element={<div data-testid="terminal" />} />
        <Route path="/ai/antigravity" element={<div data-testid="terminal" />} />
        <Route path="/ai/plugin/:id" element={<div data-testid="terminal" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('MarketplaceDetailHeader Open action', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    navigatedPath = '';
    navigatedSearch = '';
  });

  it('opens a core_page plugin at its host route', async () => {
    (useServicePlugins as jest.Mock).mockReturnValue([mkPlugin('stitch-cards', 'core_page')]);

    renderHeader(mkItem());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'marketplace.open' }));
    });

    await waitFor(() => {
      expect(navigatedPath).toBe('/tools');
    });
  });

  it('opens a canonical plugin at its /ai route', async () => {
    (useServicePlugins as jest.Mock).mockReturnValue([
      mkPlugin('stitch-antigravity', 'declarative'),
    ]);

    renderHeader(mkItem({ id: 'stitch-antigravity', name: 'Antigravity' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'marketplace.open' }));
    });

    await waitFor(() => {
      expect(navigatedPath).toBe('/ai/antigravity');
    });
  });

  it('opens a declarative plugin at /ai/plugin/{id}', async () => {
    (useServicePlugins as jest.Mock).mockReturnValue([
      mkPlugin('stitch-relaycheck', 'declarative'),
    ]);

    renderHeader(mkItem({ id: 'stitch-relaycheck', name: 'RelayCheck' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'marketplace.open' }));
    });

    await waitFor(() => {
      expect(navigatedPath).toBe('/ai/plugin/stitch-relaycheck');
    });
  });
});

describe('MarketplaceDetailHeader update semantics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    navigatedPath = '';
    navigatedSearch = '';
    (useServicePlugins as jest.Mock).mockReturnValue([]);
  });

  it('newer installed version without flags: no Update button and no arrow', () => {
    renderHeader(mkItem({ installed_version: '2.0.0', version: '1.5.0' }));

    expect(screen.queryByRole('button', { name: 'marketplace.update' })).toBeNull();
    expect(screen.queryByText('2.0.0 → 1.5.0')).toBeNull();
    expect(screen.getByTestId('installed-status')).toBeTruthy();
  });

  it('older installed version without flags: Update button and arrow via fallback', () => {
    renderHeader(mkItem({ installed_version: '1.0.0', version: '1.1.0' }));

    expect(screen.getByRole('button', { name: 'marketplace.update' })).toBeTruthy();
    expect(screen.getByText('1.0.0 → 1.1.0')).toBeTruthy();
  });

  it('update_available=false overrides differing versions', () => {
    renderHeader(
      mkItem({ installed_version: '1.0.0', version: '1.1.0', update_available: false }),
    );

    expect(screen.queryByRole('button', { name: 'marketplace.update' })).toBeNull();
    expect(screen.queryByText('1.0.0 → 1.1.0')).toBeNull();
  });

  it('update_available=true shows the Update button', () => {
    renderHeader(
      mkItem({ installed_version: '1.0.0', version: '1.0.1', update_available: true }),
    );

    expect(screen.getByRole('button', { name: 'marketplace.update' })).toBeTruthy();
    expect(screen.getByText('1.0.0 → 1.0.1')).toBeTruthy();
  });

  it('dev_shadow: no devCopy chip in header, no Update button even when update_available', () => {
    renderHeader(
      mkItem({
        installed_version: '1.0.0',
        version: '1.1.0',
        update_available: true,
        dev_shadow: true,
      }),
    );

    expect(screen.queryByText('marketplace.devCopy')).toBeNull();
    expect(screen.queryByRole('button', { name: 'marketplace.update' })).toBeNull();
    expect(screen.queryByText('1.0.0 → 1.1.0')).toBeNull();
    expect(screen.getByTestId('installed-status')).toBeTruthy();
  });
});

describe('MarketplaceDetailHeader CTA cluster', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    navigatedPath = '';
    navigatedSearch = '';
    (useServicePlugins as jest.Mock).mockReturnValue([]);
  });

  it('installed without update: installed is a non-button status node, rendered once', () => {
    renderHeader(mkItem());

    const status = screen.getByTestId('installed-status');
    expect(status.tagName).not.toBe('BUTTON');
    expect(status.closest('button')).toBeNull();
    expect(status.textContent).toContain('marketplace.installed');
    expect(status.className).toContain('text-slate-400');
    expect(screen.queryByRole('button', { name: 'marketplace.installed' })).toBeNull();
    expect(screen.getAllByText('marketplace.installed')).toHaveLength(1);
  });

  it('remove button carries ghost danger classes and is never a filled primary CTA', () => {
    renderHeader(mkItem());

    const remove = screen.getByRole('button', { name: 'marketplace.remove' });
    expect(remove.className).toContain('text-rose-400');
    expect(remove.className).toContain('hover:bg-rose-500/10');
    expect(remove.className).toContain('border-transparent');
    expect(remove.className).not.toContain('bg-indigo-500/15');
    expect(remove.className).not.toContain('bg-red-500/10');
  });

  it('remove stays ghost-danger next to an update CTA', () => {
    renderHeader(
      mkItem({ installed_version: '1.0.0', version: '1.1.0', update_available: true }),
    );

    expect(screen.getByRole('button', { name: 'marketplace.update' })).toBeTruthy();
    const remove = screen.getByRole('button', { name: 'marketplace.remove' });
    expect(remove.className).toContain('text-rose-400');
    expect(remove.className).not.toContain('bg-indigo-500/15');
    expect(screen.queryByTestId('installed-status')).toBeNull();
  });

  it('not installed: install is the primary CTA and no remove button exists', () => {
    renderHeader(mkItem({ installed: false, installed_version: null }));

    const install = screen.getByRole('button', { name: 'marketplace.install' });
    expect(install.className).toContain('bg-indigo-500/15');
    expect(screen.queryByRole('button', { name: 'marketplace.remove' })).toBeNull();
    expect(screen.queryByTestId('installed-status')).toBeNull();
  });
});

describe('MarketplaceDetailHeader enable/disable toggle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    navigatedPath = '';
    navigatedSearch = '';
  });

  function mkRuntimePlugin(
    id: string,
    enabled: boolean,
    kind: 'declarative' | 'core_page' = 'core_page',
  ): ServicePluginInfo {
    return { ...mkPlugin(id, kind), enabled };
  }

  it('running plugin: Disable button asks to turn the runtime off', async () => {
    (useServicePlugins as jest.Mock).mockReturnValue([
      mkRuntimePlugin('stitch-cards', true),
    ]);

    renderHeader(mkItem());

    const toggle = screen.getByTestId('toggle-enabled');
    expect(toggle.textContent).toContain('marketplace.disable');

    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(onToggleEnabled).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'stitch-cards' }),
      false,
    );
  });

  it('disabled plugin: Enable button, dimming badge in the title row', async () => {
    (useServicePlugins as jest.Mock).mockReturnValue([
      mkRuntimePlugin('stitch-cards', false),
    ]);

    renderHeader(mkItem());

    expect(screen.getByTestId('disabled-badge')).toBeTruthy();
    const toggle = screen.getByTestId('toggle-enabled');
    expect(toggle.textContent).toContain('marketplace.enable');

    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(onToggleEnabled).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'stitch-cards' }),
      true,
    );
  });

  it('no runtime host (catalog-only item): no toggle button', () => {
    (useServicePlugins as jest.Mock).mockReturnValue([]);

    renderHeader(mkItem());

    expect(screen.queryByTestId('toggle-enabled')).toBeNull();
  });
});

describe('MarketplaceDetailHeader quick actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    navigatedPath = '';
    navigatedSearch = '';
    (useServicePlugins as jest.Mock).mockReturnValue([]);
  });

  it('settings gear routes a core_page plugin to its host page', async () => {
    renderHeader(mkItem());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'marketplace.settings' }));
    });

    await waitFor(() => {
      expect(navigatedPath).toBe('/tools');
    });
  });

  it('settings gear resolves stitch-totp through the legacy /ai/plugin redirect map', async () => {
    renderHeader(mkItem({ id: 'stitch-totp', name: 'Stitch TOTP' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'marketplace.settings' }));
    });

    await waitFor(() => {
      expect(navigatedPath).toBe('/totp');
    });
  });

  it('settings gear is disabled with a tooltip when the plugin has no settings surface', () => {
    renderHeader(mkItem({ id: 'engine-pack', name: 'Engine Pack' }));

    const gear = screen.getByRole('button', { name: 'marketplace.settings' });
    expect(gear.hasAttribute('disabled')).toBe(true);
  });

  it('logs button navigates to /logs pre-filtered by the plugin source', async () => {
    renderHeader(mkItem({ id: 'stitch-totp', name: 'Stitch TOTP' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'marketplace.logs' }));
    });

    await waitFor(() => {
      expect(navigatedPath).toBe('/logs');
      expect(navigatedSearch).toBe('?source=plugin:stitch-totp');
    });
  });

  it('not installed: no settings gear and no logs button', () => {
    renderHeader(mkItem({ installed: false, installed_version: null }));

    expect(screen.queryByRole('button', { name: 'marketplace.settings' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'marketplace.logs' })).toBeNull();
  });
});
