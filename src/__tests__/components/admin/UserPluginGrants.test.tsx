/**
 * UserPluginGrants component tests.
 *
 * Verifies:
 *   - Granted list renders with source badges (role vs override).
 *   - Available list renders with Grant buttons.
 *   - Grant button calls plugin_grants_user_set.
 *   - Revoke button calls plugin_grants_user_set with granted:false
 *     (creates a revoke override — correct for role-granted AND
 *     override-granted plugins; user_delete would be a no-op for
 *     role-granted plugins and silently lose the revoke intent).
 *   - Revoking a role-granted plugin removes it from the granted list.
 *   - Wildcard "*" in role grants / effective: all plugins granted,
 *     available list empty.
 *   - Bulk revoke-all triggers ConfirmDialog (uses user_delete to fall
 *     back to role defaults — correct semantics for that button).
 *
 * Mocks the pluginGrants module via jest.spyOn.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { UserPluginGrants } from '@/components/admin/UserPluginGrants';
import * as pluginGrantsModule from '@/lib/backend/modules/pluginGrants';

// Mock the app store so language is set and t() resolves.
jest.mock('@/stores/app', () => ({
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
jest.mock('@/components/ui/ConfirmDialogHost', () => ({
  ConfirmDialogHost: () => null,
  askConfirm: jest.fn(() => Promise.resolve(true)),
}));

// Mock the invoke module so safeInvoke doesn't try real fetch.
jest.mock('@/lib/backend/core/invoke', () => ({
  setAuthExpiredHandler: jest.fn(),
  safeInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

const mockPlugins = [
  { id: 'kiro', name: 'Kiro Plugin', version: '1.0.0' },
  { id: 'windsurf', name: 'Windsurf Plugin', version: '2.0.0' },
  { id: 'trae', name: 'Trae Plugin', version: '3.0.0' },
];

const mockRoles: Record<string, string[]> = {
  user: [],
  vip: ['kiro'],
  premium: ['kiro', 'windsurf'],
  elite: ['kiro', 'windsurf'],
  admin: ['*'],
};

// User has kiro (from role) + windsurf (from override grant).
// Trae is not granted.
const mockUserGrants = {
  grants: [{ pluginId: 'windsurf', granted: true }],
  effective: ['kiro', 'windsurf'],
};

describe('UserPluginGrants component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders granted list with source badges and available list with Grant buttons', async () => {
    jest.spyOn(pluginGrantsModule, 'pluginGrantsRoleList').mockResolvedValue({
      roles: mockRoles,
      plugins: mockPlugins,
    });
    jest.spyOn(pluginGrantsModule, 'pluginGrantsUserGet').mockResolvedValue(mockUserGrants);

    render(
      <MemoryRouter>
        <UserPluginGrants userId={1} username="alice" role="vip" />
      </MemoryRouter>
    );

    // Wait for data to load.
    await waitFor(() => {
      expect(screen.getByText('Kiro Plugin')).toBeTruthy();
    });

    // Granted list: Kiro (from role) and Windsurf (from override).
    expect(screen.getByText('Kiro Plugin')).toBeTruthy();
    expect(screen.getByText('Windsurf Plugin')).toBeTruthy();

    // Source badges: "role" for Kiro, "override" for Windsurf.
    expect(screen.getByText('role')).toBeTruthy();
    expect(screen.getByText('override')).toBeTruthy();

    // Available list: Trae Plugin with a Grant button.
    expect(screen.getByText('Trae Plugin')).toBeTruthy();
    const grantButtons = screen.getAllByLabelText('Grant');
    expect(grantButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('clicking Grant calls plugin_grants_user_set', async () => {
    const setSpy = jest.spyOn(pluginGrantsModule, 'pluginGrantsUserSet').mockResolvedValue({ success: true });
    const getSpy = jest.spyOn(pluginGrantsModule, 'pluginGrantsUserGet').mockResolvedValue(mockUserGrants);
    jest.spyOn(pluginGrantsModule, 'pluginGrantsRoleList').mockResolvedValue({
      roles: mockRoles,
      plugins: mockPlugins,
    });

    render(
      <MemoryRouter>
        <UserPluginGrants userId={1} username="alice" role="vip" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Trae Plugin')).toBeTruthy();
    });

    // Click the Grant button for Trae.
    const grantButtons = screen.getAllByLabelText('Grant');
    await act(async () => {
      fireEvent.click(grantButtons[0]);
    });

    await waitFor(() => {
      expect(setSpy).toHaveBeenCalledWith({ userId: 1, pluginId: 'trae', granted: true });
    });
    // After grant, user grants should be re-fetched.
    expect(getSpy).toHaveBeenCalled();
  });

  it('clicking Revoke calls plugin_grants_user_set with granted:false', async () => {
    const setSpy = jest.spyOn(pluginGrantsModule, 'pluginGrantsUserSet').mockResolvedValue({ success: true });
    const getSpy = jest.spyOn(pluginGrantsModule, 'pluginGrantsUserGet').mockResolvedValue(mockUserGrants);
    jest.spyOn(pluginGrantsModule, 'pluginGrantsRoleList').mockResolvedValue({
      roles: mockRoles,
      plugins: mockPlugins,
    });

    render(
      <MemoryRouter>
        <UserPluginGrants userId={1} username="alice" role="vip" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Windsurf Plugin')).toBeTruthy();
    });

    // Click the Revoke button for Windsurf (second in the granted list,
    // since Kiro is first).
    const revokeButtons = screen.getAllByLabelText('Revoke');
    await act(async () => {
      fireEvent.click(revokeButtons[1]);
    });

    await waitFor(() => {
      expect(setSpy).toHaveBeenCalledWith({ userId: 1, pluginId: 'windsurf', granted: false });
    });
    expect(getSpy).toHaveBeenCalled();
  });

  it('revoking a role-granted plugin calls user_set granted:false and removes it from the granted list', async () => {
    // Kiro is role-granted for vip (no override). Revoking it must create a
    // revoke override via user_set — user_delete would be a no-op (no
    // override to delete) and silently lose the revoke intent.
    const setSpy = jest.spyOn(pluginGrantsModule, 'pluginGrantsUserSet').mockResolvedValue({ success: true });
    // After revoke, server reports kiro no longer effective.
    const revokedUserGrants = {
      grants: [{ pluginId: 'kiro', granted: false }],
      effective: ['windsurf'],
    };
    jest.spyOn(pluginGrantsModule, 'pluginGrantsUserGet')
      .mockResolvedValueOnce(mockUserGrants) // initial load
      .mockResolvedValueOnce(revokedUserGrants); // after revoke
    jest.spyOn(pluginGrantsModule, 'pluginGrantsRoleList').mockResolvedValue({
      roles: mockRoles,
      plugins: mockPlugins,
    });

    render(
      <MemoryRouter>
        <UserPluginGrants userId={1} username="alice" role="vip" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Kiro Plugin')).toBeTruthy();
    });

    // Kiro is first in the granted list and shows the "role" source badge.
    expect(screen.getByText('role')).toBeTruthy();

    // Click the Revoke button for Kiro (first in the granted list).
    const revokeButtons = screen.getAllByLabelText('Revoke');
    await act(async () => {
      fireEvent.click(revokeButtons[0]);
    });

    await waitFor(() => {
      expect(setSpy).toHaveBeenCalledWith({ userId: 1, pluginId: 'kiro', granted: false });
    });

    // After the server reconciles, Kiro should no longer be in the granted
    // list — it moves to the available list (with a Grant button). The
    // granted list header count drops to 1 (only Windsurf remains).
    await waitFor(() => {
      expect(screen.getByText(/Granted · 1/i)).toBeTruthy();
    });
    // Kiro is now in the available list — a Grant button is rendered for it.
    expect(screen.getByText('Kiro Plugin')).toBeTruthy();
    expect(screen.getAllByLabelText('Grant').length).toBeGreaterThanOrEqual(1);
  });

  it('bulk Revoke all triggers confirm and calls plugin_grants_user_delete for all overrides', async () => {
    const deleteSpy = jest.spyOn(pluginGrantsModule, 'pluginGrantsUserDelete').mockResolvedValue({ success: true });
    jest.spyOn(pluginGrantsModule, 'pluginGrantsUserGet').mockResolvedValue(mockUserGrants);
    jest.spyOn(pluginGrantsModule, 'pluginGrantsRoleList').mockResolvedValue({
      roles: mockRoles,
      plugins: mockPlugins,
    });

    render(
      <MemoryRouter>
        <UserPluginGrants userId={1} username="alice" role="vip" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Windsurf Plugin')).toBeTruthy();
    });

    // Click the "Revoke all" bulk button.
    const revokeAllButton = screen.getByText('Revoke all');
    await act(async () => {
      fireEvent.click(revokeAllButton);
    });

    // askConfirm resolves true → delete should be called for the override.
    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalled();
    });
  });

  it('shows summary with role grant count and override delta', async () => {
    jest.spyOn(pluginGrantsModule, 'pluginGrantsRoleList').mockResolvedValue({
      roles: mockRoles,
      plugins: mockPlugins,
    });
    jest.spyOn(pluginGrantsModule, 'pluginGrantsUserGet').mockResolvedValue(mockUserGrants);

    render(
      <MemoryRouter>
        <UserPluginGrants userId={1} username="alice" role="vip" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Role vip grants 1 plugins/i)).toBeTruthy();
    });

    // Override delta: +1 (windsurf granted).
    expect(screen.getByText('+1')).toBeTruthy();
  });

  it('wildcard "*" in role grants: summary shows full count, granted list shows all, available empty', async () => {
    // Role "elite" grants "*" — every plugin is role-granted.
    const wildcardRoles: Record<string, string[]> = {
      ...mockRoles,
      elite: ['*'],
    };
    // User has no overrides; effective = role grants = all plugins.
    const wildcardUserGrants = {
      grants: [],
      effective: ['kiro', 'windsurf', 'trae'],
    };
    jest.spyOn(pluginGrantsModule, 'pluginGrantsRoleList').mockResolvedValue({
      roles: wildcardRoles,
      plugins: mockPlugins,
    });
    jest.spyOn(pluginGrantsModule, 'pluginGrantsUserGet').mockResolvedValue(wildcardUserGrants);

    render(
      <MemoryRouter>
        <UserPluginGrants userId={1} username="alice" role="elite" />
      </MemoryRouter>
    );

    // Summary: role grants all 3 plugins.
    await waitFor(() => {
      expect(screen.getByText(/Role elite grants 3 plugins/i)).toBeTruthy();
    });

    // Granted list shows all 3 plugins with "role" source badge.
    expect(screen.getByText('Kiro Plugin')).toBeTruthy();
    expect(screen.getByText('Windsurf Plugin')).toBeTruthy();
    expect(screen.getByText('Trae Plugin')).toBeTruthy();

    // Available list is empty — no Grant buttons rendered.
    expect(screen.queryAllByLabelText('Grant').length).toBe(0);
  });

  it('wildcard "*" in effective: granted list shows all plugins, available empty', async () => {
    // User's effective list contains "*" — they have access to all plugins
    // (e.g. via an override grant of "*" or role grant of "*").
    const wildcardEffectiveUserGrants = {
      grants: [{ pluginId: '*', granted: true }],
      effective: ['*'],
    };
    jest.spyOn(pluginGrantsModule, 'pluginGrantsRoleList').mockResolvedValue({
      roles: mockRoles,
      plugins: mockPlugins,
    });
    jest.spyOn(pluginGrantsModule, 'pluginGrantsUserGet').mockResolvedValue(wildcardEffectiveUserGrants);

    render(
      <MemoryRouter>
        <UserPluginGrants userId={1} username="alice" role="user" />
      </MemoryRouter>
    );

    // Granted list shows all 3 plugins.
    await waitFor(() => {
      expect(screen.getByText('Kiro Plugin')).toBeTruthy();
    });
    expect(screen.getByText('Windsurf Plugin')).toBeTruthy();
    expect(screen.getByText('Trae Plugin')).toBeTruthy();

    // Available list is empty — no Grant buttons rendered.
    expect(screen.queryAllByLabelText('Grant').length).toBe(0);
  });
});
