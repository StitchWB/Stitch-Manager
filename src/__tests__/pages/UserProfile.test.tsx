/**
 * UserProfile page tests.
 *
 * Verifies:
 *   - Calls admin_user_overview with the route userId on mount.
 *   - Renders all six cards (Header, Permissions, Groups, Plugins, Keys,
 *     Usage) with the correct data from the backend response.
 *   - Shows the error state when admin_user_overview rejects, with a
 *     Retry button that re-invokes the command.
 *
 * Mocks the invoke module (safeInvoke) via jest.mock so the page never
 * hits real fetch. Follows the Users.test.tsx / Plugins.test.tsx pattern.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import UserProfile from '../../pages/UserProfile';
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

// Mock the invoke module so safeInvoke doesn't try real fetch.
jest.mock('../../lib/backend/core/invoke', () => ({
  setAuthExpiredHandler: jest.fn(),
  safeInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

// ── Test data ────────────────────────────────────────────────────────────────

const mockOverview = {
  user: {
    id: 1,
    username: 'alice',
    role: 'vip',
    telegram_id: 123456,
    created_at: '2024-01-15T10:30:00Z',
  },
  permissions: ['section.ai_hub', 'section.tools'],
  groups: [
    { id: 1, name: 'Team A', owner: true },
    { id: 2, name: 'Team B', owner: false },
  ],
  plugins: {
    effective: ['kiro', 'windsurf'],
    overrides: [
      { pluginId: 'kiro', granted: true },
      { pluginId: 'windsurf', granted: false },
    ],
  },
  keys: {
    ai_gateway_credentials: 3,
    proxy_keys: 2,
    provider_accounts: 5,
    totp: 1,
  },
  usage: {
    requests_today: 42,
    tokens_today: 12345,
  },
};

const safeInvokeMock = safeInvoke as jest.MockedFunction<typeof safeInvoke>;

// ── Tests ───────────────────────────────────────────────────────────────────

describe('UserProfile page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls admin_user_overview with the route userId on mount', async () => {
    safeInvokeMock.mockResolvedValue(mockOverview);

    render(
      <MemoryRouter initialEntries={['/users/1']}>
        <Routes>
          <Route path="/users/:userId" element={<UserProfile />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(safeInvokeMock).toHaveBeenCalledWith('admin_user_overview', { userId: '1' });
    });
  });

  it('renders all six cards with correct data', async () => {
    safeInvokeMock.mockResolvedValue(mockOverview);

    render(
      <MemoryRouter initialEntries={['/users/1']}>
        <Routes>
          <Route path="/users/:userId" element={<UserProfile />} />
        </Routes>
      </MemoryRouter>
    );

    // Wait for data to load and Header card to render.
    await waitFor(() => {
      expect(screen.getByText('alice')).toBeTruthy();
    });

    // Header card: username, role badge, telegram_id, created_at.
    expect(screen.getByText('alice')).toBeTruthy();
    // Role badge renders the role label (auth.role.vip = "VIP").
    expect(screen.getByText('VIP')).toBeTruthy();
    expect(screen.getByText('123456')).toBeTruthy();

    // Permissions card: permission keys rendered as badges.
    expect(screen.getByText('section.ai_hub')).toBeTruthy();
    expect(screen.getByText('section.tools')).toBeTruthy();

    // Groups card: group names + owner badge.
    expect(screen.getByText('Team A')).toBeTruthy();
    expect(screen.getByText('Team B')).toBeTruthy();
    // Owner badge appears for Team A (owner: true).
    const ownerBadges = screen.getAllByText('owner');
    expect(ownerBadges.length).toBeGreaterThanOrEqual(1);

    // Plugins card: effective plugin ids + override badges.
    // 'kiro' and 'windsurf' appear in both effective and overrides lists.
    expect(screen.getAllByText('kiro').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('windsurf').length).toBeGreaterThanOrEqual(1);

    // Keys card: count tiles render the numeric values.
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();

    // Usage card: requests_today and tokens_today.
    expect(screen.getByText('42')).toBeTruthy();
    expect(screen.getByText('12345')).toBeTruthy();
  });

  it('shows empty messages when permissions and groups are empty', async () => {
    safeInvokeMock.mockResolvedValue({
      user: { id: 2, username: 'bob', role: 'user', telegram_id: null, created_at: null },
      permissions: [],
      groups: [],
      plugins: { effective: [], overrides: [] },
      keys: { ai_gateway_credentials: 0, proxy_keys: 0, provider_accounts: 0, totp: 0 },
      usage: { requests_today: 0, tokens_today: 0 },
    });

    render(
      <MemoryRouter initialEntries={['/users/2']}>
        <Routes>
          <Route path="/users/:userId" element={<UserProfile />} />
        </Routes>
      </MemoryRouter>
    );

    // Wait for data to load.
    await waitFor(() => {
      expect(screen.getByText('bob')).toBeTruthy();
    });

    // Empty permissions message.
    expect(screen.getByText('No permissions assigned')).toBeTruthy();
    // Empty groups message.
    expect(screen.getByText('Not a member of any group')).toBeTruthy();
    // Empty plugins message.
    expect(screen.getByText('No plugins available')).toBeTruthy();
  });

  it('shows error state when admin_user_overview rejects, with Retry button', async () => {
    safeInvokeMock.mockRejectedValue(new Error('network down'));

    render(
      <MemoryRouter initialEntries={['/users/3']}>
        <Routes>
          <Route path="/users/:userId" element={<UserProfile />} />
        </Routes>
      </MemoryRouter>
    );

    // Wait for the error message to render.
    await waitFor(() => {
      expect(screen.getByText('Failed to load user profile')).toBeTruthy();
    });

    // Retry button is present.
    expect(screen.getByText('Retry')).toBeTruthy();

    // Clicking Retry re-invokes admin_user_overview.
    safeInvokeMock.mockResolvedValue(mockOverview);
    await act(async () => {
      fireEvent.click(screen.getByText('Retry'));
    });

    await waitFor(() => {
      expect(safeInvokeMock).toHaveBeenCalledTimes(2);
    });
  });

  it('shows loading state while admin_user_overview is pending', async () => {
    // Never resolves — stays in loading state.
    safeInvokeMock.mockReturnValue(new Promise(() => {}));

    render(
      <MemoryRouter initialEntries={['/users/4']}>
        <Routes>
          <Route path="/users/:userId" element={<UserProfile />} />
        </Routes>
      </MemoryRouter>
    );

    // Loading message is shown.
    await waitFor(() => {
      expect(screen.getByText('Loading user profile…')).toBeTruthy();
    });
  });
});
