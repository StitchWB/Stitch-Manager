/**
 * Marketplace page render tests.
 *
 * Verifies:
 *   - Rows render for installed, available, and locked (grayed) plugins.
 *   - Locked rows show a lock icon and a disabled install button.
 *   - Installed rows show a non-interactive installed status (Check icon).
 *   - Search filters the list client-side.
 *   - Activation-required banner renders when not activated.
 *   - Guest mode (no user): the catalog still renders; official items are
 *     locked with the auth-required tooltip; clicking a locked install
 *     button opens the Telegram login view; community items stay installable.
 *   - TierBadge renders for locked items with required_tier.
 *   - Access tab: admin-only option, ?tab=access deep link, fallbacks.
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
import * as pluginGrantsModule from '../../lib/backend/modules/pluginGrants';
import * as authModule from '../../lib/backend/modules/auth';
import { safeInvoke } from '../../lib/backend/core/invoke';

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
// real fetch calls. listUsers backs the access panel's per-user section.
jest.mock('../../lib/backend/modules/auth', () => ({
  getAuthStatus: jest.fn(),
  getCurrentUser: jest.fn(),
  loginUser: jest.fn(),
  loginTelegram: jest.fn(),
  logoutUser: jest.fn(),
  setupUser: jest.fn(),
  setLoginPolicy: jest.fn(),
  listUsers: jest.fn(),
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

    expect(
      screen.getAllByTestId('installed-status').length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole('button', { name: 'Installed' })).toBeNull();

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

  it('guest mode: renders the catalog, locks official items with the auth tooltip, keeps community installable', async () => {
    const user = userEvent.setup();
    useAuthStore.setState({ user: null, authView: 'welcome' });

    jest
      .spyOn(marketplaceModule, 'getMarketplace')
      .mockResolvedValue({
        activated: false,
        items: [
          mk.locked({ id: 'official-plugin', name: 'Official Plugin' }),
          mk.available({ id: 'community-plugin', name: 'Community Plugin' }),
        ],
      });

    render(
      <MemoryRouter>
        <Marketplace />
      </MemoryRouter>
    );

    const listPane = screen.getByTestId('plugin-list');

    // The catalog is fetched and rendered for guests (no lock wall).
    await waitFor(() => {
      expect(within(listPane).getByText('Official Plugin')).toBeTruthy();
    });
    expect(within(listPane).getByText('Community Plugin')).toBeTruthy();

    // Official (locked) item: the lock icon is labeled with the
    // auth-required tooltip text.
    expect(
      screen.getAllByLabelText(
        'Official plugins are available after signing in via Telegram',
      ).length,
    ).toBeGreaterThanOrEqual(1);

    // Community item: the install button is enabled.
    const communityRow = within(listPane)
      .getByText('Community Plugin')
      .closest('div[role="button"]') as HTMLElement;
    const communityInstall = within(communityRow).getByRole('button', {
      name: 'Install',
    });
    expect(communityInstall.hasAttribute('disabled')).toBe(false);

    // Official item: clicking the locked install button switches the auth
    // store to the Telegram login view.
    const officialRow = within(listPane)
      .getByText('Official Plugin')
      .closest('div[role="button"]') as HTMLElement;
    const officialInstall = within(officialRow).getByRole('button', {
      name: 'Install',
    });
    await user.click(officialInstall);
    expect(useAuthStore.getState().authView).toBe('telegram');
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

  it('catalog tab groups installed and available plugins under separate headers', async () => {
    jest
      .spyOn(marketplaceModule, 'getMarketplace')
      .mockResolvedValue({
        activated: true,
        items: [mk.installed(), mk.available()],
      });

    render(
      <MemoryRouter>
        <Marketplace />
      </MemoryRouter>
    );

    const listPane = screen.getByTestId('plugin-list');

    await waitFor(() => {
      expect(
        within(listPane).getByRole('heading', { name: /Installed · 1/i }),
      ).toBeTruthy();
    });
    expect(
      within(listPane).getByRole('heading', { name: /Available · 1/i }),
    ).toBeTruthy();
    expect(within(listPane).getByText('Installed Plugin')).toBeTruthy();
    expect(within(listPane).getByText('Available Plugin')).toBeTruthy();
  });

  it('installed tab shows only the local stack under the "Installed" header', async () => {
    jest
      .spyOn(marketplaceModule, 'getMarketplace')
      .mockResolvedValue({
        activated: true,
        items: [mk.installed(), mk.available()],
      });

    render(
      <MemoryRouter initialEntries={['/marketplace?tab=installed']}>
        <Marketplace />
      </MemoryRouter>
    );

    const listPane = screen.getByTestId('plugin-list');

    await waitFor(() => {
      expect(
        within(listPane).getByRole('heading', { name: /Installed · 1/i }),
      ).toBeTruthy();
    });
    expect(within(listPane).getByText('Installed Plugin')).toBeTruthy();
    expect(within(listPane).queryByText('Available Plugin')).toBeNull();
  });
});

describe('Marketplace page — access tab', () => {
  const adminUser = { id: 1, username: 'admin', role: 'admin' as const };
  const regularUser = { id: 2, username: 'bob', role: 'user' as const };

  beforeEach(() => {
    jest.clearAllMocks();
    (safeInvoke as jest.Mock).mockImplementation(() => Promise.resolve([]));
    (authModule.listUsers as jest.Mock).mockResolvedValue([]);
    jest.spyOn(marketplaceModule, 'getMarketplace').mockResolvedValue({
      activated: true,
      items: [],
    });
    jest.spyOn(pluginGrantsModule, 'pluginGrantsRoleList').mockResolvedValue({
      roles: { user: [], vip: [], premium: [], elite: [], admin: ['*'] },
      plugins: [{ id: 'kiro', name: 'Kiro Plugin', version: '1.0.0' }],
    });
  });

  it('renders the access panel for an admin on ?tab=access', async () => {
    useAuthStore.setState({ enabled: true, user: adminUser });

    render(
      <MemoryRouter initialEntries={['/marketplace?tab=access']}>
        <Marketplace />
      </MemoryRouter>
    );

    expect(await screen.findByText('Access by role')).toBeTruthy();
    expect(await screen.findByText('Kiro Plugin')).toBeTruthy();
    expect(screen.getByText('All plugins')).toBeTruthy();

    // The access tab option is present and active.
    expect(screen.getByRole('button', { name: 'Access' })).toBeTruthy();

    // The master-detail split is hidden while the panel owns the content area.
    const splitPane = screen.getByTestId('plugin-list').parentElement;
    expect(splitPane?.className).toContain('hidden');
  });

  it('hides the access tab option for non-admins and falls back to the marketplace tab', async () => {
    useAuthStore.setState({ enabled: true, user: regularUser });
    (marketplaceModule.getMarketplace as jest.Mock).mockResolvedValue({
      activated: true,
      items: [mk.available()],
    });

    render(
      <MemoryRouter initialEntries={['/marketplace?tab=access']}>
        <Marketplace />
      </MemoryRouter>
    );

    // The marketplace list renders instead of the access panel.
    const listPane = screen.getByTestId('plugin-list');
    await waitFor(() => {
      expect(within(listPane).getByText('Available Plugin')).toBeTruthy();
    });
    expect(listPane.parentElement?.className).not.toContain('hidden');
    expect(screen.queryByText('Access by role')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Access' })).toBeNull();
  });

  it('falls back to the marketplace tab for unknown ?tab= values', async () => {
    useAuthStore.setState({ enabled: true, user: adminUser });
    (marketplaceModule.getMarketplace as jest.Mock).mockResolvedValue({
      activated: true,
      items: [mk.available()],
    });

    render(
      <MemoryRouter initialEntries={['/marketplace?tab=bogus']}>
        <Marketplace />
      </MemoryRouter>
    );

    const listPane = screen.getByTestId('plugin-list');
    await waitFor(() => {
      expect(within(listPane).getByText('Available Plugin')).toBeTruthy();
    });
    expect(screen.queryByText('Access by role')).toBeNull();
  });

  it('syncs the ?tab= param when switching to the access tab', async () => {
    const user = userEvent.setup();
    useAuthStore.setState({ enabled: true, user: adminUser });

    render(
      <MemoryRouter initialEntries={['/marketplace']}>
        <Marketplace />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'Access' }));

    // tab is derived from the URL param, so the panel rendering proves the click wrote it
    expect(await screen.findByText('Access by role')).toBeTruthy();
  });
});
