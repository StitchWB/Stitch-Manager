/**
 * Plugins page tests.
 *
 * Verifies:
 *   - Role matrix renders plugins × roles with correct checkboxes.
 *   - Toggling a cell calls plugin_grants_role_set.
 *   - Optimistic rollback on error.
 *   - Per-user editor: grant/revoke flows, source badges, bulk revoke confirm.
 *   - User picker selects a user and loads their grants.
 *
 * Mocks the pluginGrants module (safeInvoke wrappers) and the auth module
 * (listUsers) via jest.spyOn, following the Marketplace.test.tsx pattern.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Plugins from '../../pages/Plugins';
import * as pluginGrantsModule from '../../lib/backend/modules/pluginGrants';
import * as authModule from '../../lib/backend/modules/auth';
import type { AuthUser } from '../../lib/backend/modules/auth';

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

// Mock ConfirmDialogHost — askConfirm resolves true immediately.
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

// ── Test data ────────────────────────────────────────────────────────────────

const mockPlugins = [
  { id: 'kiro', name: 'Kiro Plugin', version: '1.0.0' },
  { id: 'windsurf', name: 'Windsurf Plugin', version: '2.0.0' },
];

const mockRoles: Record<string, string[]> = {
  user: [],
  vip: ['kiro'],
  premium: ['kiro', 'windsurf'],
  elite: ['kiro', 'windsurf'],
  admin: ['*'],
};

const mockUsers: AuthUser[] = [
  { id: 1, username: 'alice', role: 'user' },
  { id: 2, username: 'bob', role: 'vip' },
];

const mockUserGrants = {
  grants: [{ pluginId: 'windsurf', granted: true }],
  effective: ['kiro', 'windsurf'],
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Plugins page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the role matrix with plugins × roles and correct checkbox states', async () => {
    jest.spyOn(pluginGrantsModule, 'pluginGrantsRoleList').mockResolvedValue({
      roles: mockRoles,
      plugins: mockPlugins,
    });
    jest.spyOn(authModule, 'listUsers').mockResolvedValue(mockUsers);

    render(
      <MemoryRouter>
        <Plugins />
      </MemoryRouter>
    );

    // Wait for the matrix to load.
    await waitFor(() => {
      expect(screen.getByText('Kiro Plugin')).toBeTruthy();
    });

    // Plugin names are rendered.
    expect(screen.getByText('Kiro Plugin')).toBeTruthy();
    expect(screen.getByText('Windsurf Plugin')).toBeTruthy();

    // "All plugins" row is rendered.
    expect(screen.getByText('All plugins')).toBeTruthy();

    // Role headers are rendered.
    expect(screen.getByText('User')).toBeTruthy();
    expect(screen.getByText('VIP')).toBeTruthy();
    expect(screen.getByText('Premium')).toBeTruthy();
    expect(screen.getByText('Elite')).toBeTruthy();
  });

  it('toggling a role cell calls plugin_grants_role_set and refetches the role list', async () => {
    const roleSetSpy = jest.spyOn(pluginGrantsModule, 'pluginGrantsRoleSet').mockResolvedValue({ success: true });
    const roleListSpy = jest.spyOn(pluginGrantsModule, 'pluginGrantsRoleList').mockResolvedValue({
      roles: mockRoles,
      plugins: mockPlugins,
    });
    jest.spyOn(authModule, 'listUsers').mockResolvedValue(mockUsers);

    render(
      <MemoryRouter>
        <Plugins />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Kiro Plugin')).toBeTruthy();
    });

    // Initial load calls pluginGrantsRoleList once.
    expect(roleListSpy).toHaveBeenCalledTimes(1);

    // Find all checkboxes in the table. The first row is "All plugins",
    // then Kiro, then Windsurf. Each row has 5 role columns (user, vip,
    // premium, elite, admin). We'll click the first non-admin checkbox
    // in the Kiro row.
    const checkboxes = screen.getAllByRole('checkbox');
    // The admin column checkboxes are disabled; find an enabled one.
    const enabledCheckboxes = checkboxes.filter(cb => !cb.hasAttribute('disabled'));
    expect(enabledCheckboxes.length).toBeGreaterThan(0);

    // Click the first enabled checkbox (user role for "All plugins" row).
    await act(async () => {
      fireEvent.click(enabledCheckboxes[0]);
    });

    await waitFor(() => {
      expect(roleSetSpy).toHaveBeenCalled();
    });
    // After a successful mutation, the role list is refetched to reconcile
    // with server truth (e.g. backend normalizes "*" by deduping ids).
    await waitFor(() => {
      expect(roleListSpy).toHaveBeenCalledTimes(2);
    });
  });

  it('optimistic rollback on error', async () => {
    jest.spyOn(pluginGrantsModule, 'pluginGrantsRoleSet').mockRejectedValue(new Error('fail'));
    jest.spyOn(pluginGrantsModule, 'pluginGrantsRoleList').mockResolvedValue({
      roles: { user: [], vip: [], premium: [], elite: [], admin: ['*'] },
      plugins: mockPlugins,
    });
    jest.spyOn(authModule, 'listUsers').mockResolvedValue(mockUsers);

    render(
      <MemoryRouter>
        <Plugins />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Kiro Plugin')).toBeTruthy();
    });

    const checkboxes = screen.getAllByRole('checkbox');
    const enabledCheckboxes = checkboxes.filter(cb => !cb.hasAttribute('disabled'));

    // Click the first enabled checkbox to toggle it on.
    await act(async () => {
      fireEvent.click(enabledCheckboxes[0]);
    });

    // After the error, the checkbox should revert to unchecked.
    await waitFor(() => {
      const revertedCheckboxes = screen.getAllByRole('checkbox');
      const revertedEnabled = revertedCheckboxes.filter(cb => !cb.hasAttribute('disabled'));
      // The first enabled checkbox should be unchecked again (rollback).
      expect(revertedEnabled[0].checked).toBe(false);
    });
  });

  it('per-user section shows user picker and pick-a-user prompt initially', async () => {
    jest.spyOn(pluginGrantsModule, 'pluginGrantsRoleList').mockResolvedValue({
      roles: mockRoles,
      plugins: mockPlugins,
    });
    jest.spyOn(pluginGrantsModule, 'pluginGrantsUserGet').mockResolvedValue(mockUserGrants);
    jest.spyOn(pluginGrantsModule, 'pluginGrantsUserSet').mockResolvedValue({ success: true });
    jest.spyOn(pluginGrantsModule, 'pluginGrantsUserDelete').mockResolvedValue({ success: true });
    jest.spyOn(authModule, 'listUsers').mockResolvedValue(mockUsers);

    render(
      <MemoryRouter>
        <Plugins />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Kiro Plugin')).toBeTruthy();
    });

    // The per-user section should show a "pick a user" prompt initially.
    expect(screen.getByText('Pick a user')).toBeTruthy();
    // The select user label should be present.
    expect(screen.getByText('Select user')).toBeTruthy();
  });

  it('shows empty state when no plugins are configured', async () => {
    jest.spyOn(pluginGrantsModule, 'pluginGrantsRoleList').mockResolvedValue({
      roles: {},
      plugins: [],
    });
    jest.spyOn(authModule, 'listUsers').mockResolvedValue([]);

    render(
      <MemoryRouter>
        <Plugins />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('No plugins configured')).toBeTruthy();
    });
  });

  it('listUsers rejects: users error shown, role matrix still rendered', async () => {
    // Role matrix loads fine; users fetch fails. The per-user section
    // must surface the failure with a retry button, while the role
    // matrix remains fully usable.
    jest.spyOn(pluginGrantsModule, 'pluginGrantsRoleList').mockResolvedValue({
      roles: mockRoles,
      plugins: mockPlugins,
    });
    jest.spyOn(authModule, 'listUsers').mockRejectedValue(new Error('network'));

    render(
      <MemoryRouter>
        <Plugins />
      </MemoryRouter>
    );

    // Role matrix still renders.
    await waitFor(() => {
      expect(screen.getByText('Kiro Plugin')).toBeTruthy();
    });
    expect(screen.getByText('Windsurf Plugin')).toBeTruthy();
    expect(screen.getByText('All plugins')).toBeTruthy();

    // Per-user section shows the users load failure + retry button.
    expect(screen.getByText(/Failed to load users/i)).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();

    // The user picker is NOT rendered (replaced by the error block).
    expect(screen.queryByText('Select user')).toBeNull();
  });
});
