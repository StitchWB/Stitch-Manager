/**
 * Users page tests — plugin grants modal integration.
 *
 * Verifies:
 *   - The "Plugins" action button is rendered per user row.
 *   - Clicking it opens a modal with the UserPluginGrants component.
 *
 * Mocks global.fetch (the auth module calls fetch directly) and the
 * pluginGrants module (safeInvoke wrappers) via jest.spyOn.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Users from '../../pages/Users';
import * as pluginGrantsModule from '../../lib/backend/modules/pluginGrants';

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

// Mock the auth store so the page renders without a real session.
jest.mock('../../stores/auth', () => ({
  useAuthStore: (selector?: (s: { user: { id: number; username: string; role: string } | null }) => unknown) =>
    selector ? selector({ user: { id: 99, username: 'admin', role: 'admin' } }) : { user: { id: 99, username: 'admin', role: 'admin' } },
  effectiveRole: (u: { role: string }) => u?.role ?? 'user',
}));

// Mock sonner so toast calls don't blow up in jsdom.
jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

// Mock ConfirmDialogHost.
jest.mock('../../components/ui/ConfirmDialogHost', () => ({
  ConfirmDialogHost: () => null,
  askConfirm: jest.fn(() => Promise.resolve(true)),
}));

// Mock the invoke module so safeInvoke doesn't try real fetch.
jest.mock('../../lib/backend/core/invoke', () => ({
  setAuthExpiredHandler: jest.fn(),
  safeInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

// ── fetch mock helper ────────────────────────────────────────────────────────

function makeJsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone() { return this; },
    headers: new Headers(),
  };
}

const mockUsers = [
  { id: 1, username: 'alice', role: 'user' },
  { id: 2, username: 'bob', role: 'vip' },
];

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Users page — plugins modal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders a Plugins action button per user row', async () => {
    (globalThis as { fetch: jest.Mock }).fetch = jest.fn(async (url: string) => {
      if (url.endsWith('/api/auth/users')) {
        return makeJsonResponse(200, mockUsers);
      }
      return makeJsonResponse(404, { detail: 'not found' });
    });

    render(
      <MemoryRouter>
        <Users />
      </MemoryRouter>
    );

    // Wait for users to load.
    await waitFor(() => {
      expect(screen.getByText('alice')).toBeTruthy();
    });

    // Each row should have a Plugins button (aria-label).
    const pluginsButtons = screen.getAllByLabelText(/plugins/i);
    expect(pluginsButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('clicking the Plugins button opens the grants modal', async () => {
    (globalThis as { fetch: jest.Mock }).fetch = jest.fn(async (url: string) => {
      if (url.endsWith('/api/auth/users')) {
        return makeJsonResponse(200, mockUsers);
      }
      return makeJsonResponse(404, { detail: 'not found' });
    });

    // Mock pluginGrants functions so the modal content loads.
    jest.spyOn(pluginGrantsModule, 'pluginGrantsRoleList').mockResolvedValue({
      roles: { user: [], vip: ['kiro'], premium: [], elite: [], admin: ['*'] },
      plugins: [{ id: 'kiro', name: 'Kiro Plugin', version: '1.0.0' }],
    });
    jest.spyOn(pluginGrantsModule, 'pluginGrantsUserGet').mockResolvedValue({
      grants: [],
      effective: [],
    });

    render(
      <MemoryRouter>
        <Users />
      </MemoryRouter>
    );

    // Wait for users to load.
    await waitFor(() => {
      expect(screen.getByText('alice')).toBeTruthy();
    });

    // Click the first Plugins button.
    const pluginsButtons = screen.getAllByLabelText(/plugins/i);
    await act(async () => {
      fireEvent.click(pluginsButtons[0]);
    });

    // The modal should open and show the per-user grants section.
    await waitFor(() => {
      // The modal title "Per-user grants" should be visible.
      expect(screen.getByText('Per-user grants')).toBeTruthy();
    });
  });

  it('renders a View profile button per user row that navigates to /users/:id', async () => {
    (globalThis as { fetch: jest.Mock }).fetch = jest.fn(async (url: string) => {
      if (url.endsWith('/api/auth/users')) {
        return makeJsonResponse(200, mockUsers);
      }
      return makeJsonResponse(404, { detail: 'not found' });
    });

    // Render with a catch-all route so navigation is observable.
    render(
      <MemoryRouter initialEntries={['/users']}>
        <Routes>
          <Route path="/users" element={<Users />} />
          <Route
            path="/users/:userId"
            element={<div data-testid="profile-route">profile</div>}
          />
        </Routes>
      </MemoryRouter>
    );

    // Wait for users to load.
    await waitFor(() => {
      expect(screen.getByText('alice')).toBeTruthy();
    });

    // Each row should have a "User profile" aria-label button (the eye icon).
    const viewButtons = screen.getAllByLabelText(/user profile/i);
    expect(viewButtons.length).toBeGreaterThanOrEqual(1);

    // Click the first View profile button (alice → /users/1).
    await act(async () => {
      fireEvent.click(viewButtons[0]);
    });

    // The profile route should render, confirming navigation.
    await waitFor(() => {
      expect(screen.getByTestId('profile-route')).toBeTruthy();
    });
  });
});
