/**
 * Marketplace page render tests.
 *
 * Verifies:
 *   - Rows render for installed, available, and locked (grayed) plugins.
 *   - Locked rows show a lock icon and a disabled install button.
 *   - Installed rows show a Remove button.
 *   - Search filters the list client-side.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
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

    // Wait for items to load and render.
    await waitFor(() => {
      expect(screen.getByText('Installed Plugin')).toBeTruthy();
    });
    expect(screen.getByText('Available Plugin')).toBeTruthy();
    expect(screen.getByText('Locked Plugin')).toBeTruthy();

    // Installed row → Remove button.
    const removeButtons = screen.getAllByRole('button', { name: /remove/i });
    expect(removeButtons).toHaveLength(1);

    // Available row → Install button (enabled).
    const installButtons = screen.getAllByRole('button', { name: /install/i });
    // Two install buttons: one for available (enabled), one for locked (disabled).
    expect(installButtons).toHaveLength(2);

    // Locked row: the install button should be disabled.
    const lockedInstall = installButtons.find(btn => btn.hasAttribute('disabled'));
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

    await waitFor(() => {
      expect(screen.getByText('Installed Plugin')).toBeTruthy();
    });

    // Type a query that only matches the available plugin.
    const searchInput = screen.getByPlaceholderText(/search plugins/i);
    await user.type(searchInput, 'available');

    // Only "Available Plugin" should be visible now.
    expect(screen.getByText('Available Plugin')).toBeTruthy();
    expect(screen.queryByText('Installed Plugin')).toBeNull();
    expect(screen.queryByText('Locked Plugin')).toBeNull();
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

    await waitFor(() => {
      expect(screen.getByText('Available Plugin')).toBeTruthy();
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
});
