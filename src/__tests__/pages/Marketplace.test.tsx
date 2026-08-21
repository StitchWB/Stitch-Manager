/**
 * Marketplace page render tests.
 *
 * Verifies:
 *   - Rows render for installed, available, and locked (grayed) plugins.
 *   - Locked rows show a lock icon and a disabled install button.
 *   - Installed rows show an Installed button (disabled, with Check icon).
 *   - Search filters the list client-side.
 *   - Activation-required banner renders when not activated.
 *   - Lock screen renders when no authenticated user (getMarketplace not called).
 *   - TierBadge renders for locked items with required_tier.
 *
 * NOTE: The page uses an IDEA-style master-detail layout. The left pane
 * (data-testid="plugin-list") holds compact rows; the right pane
 * (data-testid="plugin-detail") shows the selected item's details. With
 * auto-select, the first item is always selected, so item names and action
 * buttons appear in BOTH panes — list-scoped queries use within() on the
 * list pane, while "Installed" buttons are queried across the whole screen
 * (they exist in both the list row and the detail action row).
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Marketplace from '../../pages/Marketplace';
import { useAuthStore } from '../../stores/auth';
import * as marketplaceModule from '../../lib/backend/modules/marketplace';
import type { MarketplaceItem } from '../../lib/backend/modules/marketplace';

// Mock Header to keep the test focused on the page body.
jest.mock('../../components/layout/Header', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <div data-testid="header">{title}</div>,
}));

// Mock the app store so language is set and t() resolves.
jest.mock('../../stores/app', () => ({
  useAppStore: (selector?: (s: { language: string }) => unknown) =>
    selector ? selector({ language: 'en' }) : { language: 'en' },
}));

// Mock sonner so toast calls don't blow up in jsdom.
jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

// Mock the invoke module so the auth store can register its 401 callback
// without importing the real fetch wrapper.
jest.mock('../../lib/backend/core/invoke', () => ({
  setAuthExpiredHandler: jest.fn(),
  safeInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

// Mock the auth backend module so importing the auth store doesn't trigger
// real fetch calls.
jest.mock('../../lib/backend/modules/auth', () => ({
  getAuthStatus: jest.fn(),
  getCurrentUser: jest.fn(),
  loginUser: jest.fn(),
  loginTelegram: jest.fn(),
  logoutUser: jest.fn(),
  setupUser: jest.fn(),
  setLoginPolicy: jest.fn(),
}));

const mk = {
  installed: (overrides: Partial<MarketplaceItem> = {}): MarketplaceItem => ({
    id: 'plugin-installed',
    name: 'Installed Plugin',
    description: 'A plugin that is already installed.',
    author: null,
    version: '1.0.0',
    source: 'official',
    entitled: true,
    installed: true,
    installed_version: '1.0.0',
    can_download: true,
    ...overrides,
  }),
  available: (overrides: Partial<MarketplaceItem> = {}): MarketplaceItem => ({
    id: 'plugin-available',
    name: 'Available Plugin',
    description: 'A plugin available for install.',
    author: null,
    version: '2.0.0',
    source: 'community',
    entitled: true,
    installed: false,
    installed_version: null,
    can_download: true,
    ...overrides,
  }),
  locked: (overrides: Partial<MarketplaceItem> = {}): MarketplaceItem => ({
    id: 'plugin-locked',
    name: 'Locked Plugin',
    description: 'A plugin the current role cannot install.',
    author: null,
    version: '3.0.0',
    source: 'official',
    entitled: false,
    installed: false,
    installed_version: null,
    can_download: false,
    ...overrides,
  }),
};

describe('Marketplace page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Provide an authenticated user so existing tests render the feed.
    useAuthStore.setState({
      user: { id: 1, username: 'admin', role: 'admin' as const },
    });
  });

  it('renders installed, available, and locked rows with correct controls', async () => {
    jest
      .spyOn(marketplaceModule, 'getMarketplace')
      .mockResolvedValue({
        activated: true,
        items: [mk.installed(), mk.available(), mk.locked()],
      });

    render(
      <MemoryRouter>
        <Marketplace />
      </MemoryRouter>
    );

    const listPane = screen.getByTestId('plugin-list');

    // Wait for items to load and render.
    await waitFor(() => {
      expect(within(listPane).getByText('Installed Plugin')).toBeTruthy();
    });
    expect(within(listPane).getByText('Available Plugin')).toBeTruthy();
    expect(within(listPane).getByText('Locked Plugin')).toBeTruthy();

    // Available + locked rows → Install buttons (exact match, scoped to list).
    const installButtons = within(listPane).getAllByRole('button', {
      name: 'Install',
    });
    expect(installButtons).toHaveLength(2);

    // Installed buttons appear in both the list row and the detail pane
    // (auto-select picks the first item = "Installed Plugin"). All must be
    // disabled.
    const installedButtons = screen.getAllByRole('button', {
      name: 'Installed',
    });
    expect(installedButtons.length).toBeGreaterThanOrEqual(1);
    expect(
      installedButtons.every(btn => btn.hasAttribute('disabled')),
    ).toBe(true);

    // Locked row: the install button should be disabled.
    const lockedInstall = installButtons.find(btn =>
      btn.hasAttribute('disabled'),
    );
    expect(lockedInstall).toBeTruthy();

    // Locked row: lock icon is rendered (aria-label on the Lock svg).
    const lockIcons = screen.getAllByLabelText(/unavailable for your role/i);
    expect(lockIcons.length).toBeGreaterThanOrEqual(1);
  });

  it('filters rows by search query (client-side)', async () => {
    const user = userEvent.setup();
    jest
      .spyOn(marketplaceModule, 'getMarketplace')
      .mockResolvedValue({
        activated: true,
        items: [mk.installed(), mk.available(), mk.locked()],
      });

    render(
      <MemoryRouter>
        <Marketplace />
      </MemoryRouter>
    );

    const listPane = screen.getByTestId('plugin-list');

    await waitFor(() => {
      expect(within(listPane).getByText('Installed Plugin')).toBeTruthy();
    });

    // Type a query that only matches the available plugin.
    const searchInput = screen.getByPlaceholderText(/search plugins/i);
    await user.type(searchInput, 'available');

    // Only "Available Plugin" should be visible in the list now.
    expect(within(listPane).getByText('Available Plugin')).toBeTruthy();
    expect(within(listPane).queryByText('Installed Plugin')).toBeNull();
    expect(within(listPane).queryByText('Locked Plugin')).toBeNull();
  });

  it('shows activation-required banner when activated is false', async () => {
    jest
      .spyOn(marketplaceModule, 'getMarketplace')
      .mockResolvedValue({
        activated: false,
        items: [mk.available()],
      });

    render(
      <MemoryRouter>
        <Marketplace />
      </MemoryRouter>
    );

    const listPane = screen.getByTestId('plugin-list');

    await waitFor(() => {
      expect(within(listPane).getByText('Available Plugin')).toBeTruthy();
    });

    // The activation-required banner text should be present.
    expect(screen.getByText(/activation required/i)).toBeTruthy();
  });

  it('shows lock screen when no authenticated user and does not call getMarketplace', () => {
    useAuthStore.setState({ user: null });

    const getMarketplaceSpy = jest.spyOn(marketplaceModule, 'getMarketplace');

    render(
      <MemoryRouter>
        <Marketplace />
      </MemoryRouter>
    );

    // Lock screen title is shown.
    expect(screen.getByText('Authorized users only')).toBeTruthy();
    // getMarketplace was NOT called (no fetch attempted).
    expect(getMarketplaceSpy).not.toHaveBeenCalled();
  });

  it('shows TierBadge for locked items with required_tier', async () => {
    jest
      .spyOn(marketplaceModule, 'getMarketplace')
      .mockResolvedValue({
        activated: true,
        items: [mk.locked({ required_tier: 'premium' })],
      });

    render(
      <MemoryRouter>
        <Marketplace />
      </MemoryRouter>
    );

    const listPane = screen.getByTestId('plugin-list');

    await waitFor(() => {
      expect(within(listPane).getByText('Locked Plugin')).toBeTruthy();
    });

    // TierBadge renders the tier name via i18n (auth.role.premium = "Premium").
    // It appears in both the list row and the detail pane.
    expect(screen.getAllByText('Premium').length).toBeGreaterThanOrEqual(1);
  });

  it('shows required tier note for locked items with required_tier', async () => {
    jest
      .spyOn(marketplaceModule, 'getMarketplace')
      .mockResolvedValue({
        activated: true,
        items: [mk.locked({ required_tier: 'vip' })],
      });

    render(
      <MemoryRouter>
        <Marketplace />
      </MemoryRouter>
    );

    const listPane = screen.getByTestId('plugin-list');

    await waitFor(() => {
      expect(within(listPane).getByText('Locked Plugin')).toBeTruthy();
    });

    // The required tier note should be visible in the detail pane.
    // "Requires {tier} role or admin grant" with tier = "Vip"
    expect(
      screen.getByText(/Requires Vip role or admin grant/i)
    ).toBeTruthy();
  });
});
