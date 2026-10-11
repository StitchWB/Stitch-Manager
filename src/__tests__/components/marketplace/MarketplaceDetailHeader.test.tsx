/**
 * MarketplaceDetailHeader Open action tests.
 *
 * Verifies the Open button resolves through CORE_PAGE_ROUTES: a core_page
 * plugin (stitch-cards) opens its real host route (/tools), while a
 * declarative plugin (stitch-relaycheck) opens /ai/plugin/{id}.
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

function LocationSpy() {
  const loc = useLocation();
  useEffect(() => {
    navigatedPath = loc.pathname;
  }, [loc.pathname]);
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
              onLockedClick={onLockedClick}
            />
          }
        />
        <Route path="/tools" element={<div data-testid="terminal" />} />
        <Route path="/ai/plugin/:id" element={<div data-testid="terminal" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('MarketplaceDetailHeader Open action', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    navigatedPath = '';
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
