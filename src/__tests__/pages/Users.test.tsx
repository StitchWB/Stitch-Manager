/**
 * Users page tests — search filter, row kebab menu, plugin grants modal,
 * impact-aware delete.
 *
 * Verifies:
 *   - The client-side search input filters the loaded list by username/role.
 *   - Row actions (User profile / Plugins / Delete) live in a per-row
 *     OverflowMenu; Delete previews backend impact — empty impact routes
 *     through the shared askConfirm, non-empty impact opens the transfer
 *     dialog requiring a successor (DELETE ?transfer_to=), and a 409 race
 *     surfaces detail.message as a toast.
 *   - The Plugins menu item opens the UserPluginGrants modal.
 *
 * Mocks global.fetch (the auth module calls fetch directly) and the
 * pluginGrants module (safeInvoke wrappers) via jest.spyOn.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { toast } from 'sonner';
import Users from '../../pages/Users';
import * as pluginGrantsModule from '../../lib/backend/modules/pluginGrants';
import { askConfirm } from '../../components/ui/ConfirmDialogHost';

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

const emptyImpact = {
  owned_groups: [],
  owned_accounts: 0,
  owned_credentials: 0,
  owned_endpoints: 0,
};

function mockUsersFetch() {
  (globalThis as { fetch: jest.Mock }).fetch = jest.fn(async (url: string) => {
    if (url.endsWith('/api/auth/users')) {
      return makeJsonResponse(200, mockUsers);
    }
    if (url.includes('/delete_impact')) {
      return makeJsonResponse(200, emptyImpact);
    }
    return makeJsonResponse(404, { detail: 'not found' });
  });
}

function mockDeleteFlowFetch(
  impact: unknown,
  deleteStatus = 200,
  deleteBody: unknown = { ok: true },
) {
  const fetchMock = jest.fn(async (url: string, init?: { method?: string }) => {
    if (url.endsWith('/api/auth/users')) {
      return makeJsonResponse(200, mockUsers);
    }
    if (url.includes('/delete_impact')) {
      return makeJsonResponse(200, impact);
    }
    if (init?.method === 'DELETE') {
      return makeJsonResponse(deleteStatus, deleteBody);
    }
    return makeJsonResponse(404, { detail: 'not found' });
  });
  (globalThis as { fetch: jest.Mock }).fetch = fetchMock;
  return fetchMock;
}

function findDeleteCall(fetchMock: ReturnType<typeof mockDeleteFlowFetch>) {
  return fetchMock.mock.calls.find(c => c[1]?.method === 'DELETE');
}

async function clickRowDelete(rowIndex = 0) {
  await openRowMenu(rowIndex);
  await act(async () => {
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
  });
}

function renderPage(initialEntries = ['/users']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/users" element={<Users />} />
        <Route path="/users/:userId" element={<div data-testid="profile-route">profile</div>} />
      </Routes>
    </MemoryRouter>
  );
}

async function openRowMenu(rowIndex = 0) {
  const triggers = screen.getAllByLabelText('Actions');
  await act(async () => {
    fireEvent.click(triggers[rowIndex]);
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Users page — search filter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsersFetch();
  });

  it('filters rows by username substring', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('alice')).toBeTruthy());

    const search = screen.getByPlaceholderText('Search by username or role');
    await act(async () => {
      fireEvent.change(search, { target: { value: 'ali' } });
    });

    expect(screen.getByText('alice')).toBeTruthy();
    expect(screen.queryByText('bob')).toBeNull();
  });

  it('filters rows by role', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('alice')).toBeTruthy());

    const search = screen.getByPlaceholderText('Search by username or role');
    await act(async () => {
      fireEvent.change(search, { target: { value: 'vip' } });
    });

    expect(screen.getByText('bob')).toBeTruthy();
    expect(screen.queryByText('alice')).toBeNull();
  });

  it('shows a no-match empty state and restores the list when cleared', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('alice')).toBeTruthy());

    const search = screen.getByPlaceholderText('Search by username or role');
    await act(async () => {
      fireEvent.change(search, { target: { value: 'zzz' } });
    });
    expect(screen.getByText('No users match your search')).toBeTruthy();

    await act(async () => {
      fireEvent.change(search, { target: { value: '' } });
    });
    await waitFor(() => {
      expect(screen.getByText('alice')).toBeTruthy();
      expect(screen.getByText('bob')).toBeTruthy();
    });
  });
});

describe('Users page — row kebab menu', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsersFetch();
  });

  it('renders one kebab trigger per row exposing profile, plugins and delete actions', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('alice')).toBeTruthy());

    expect(screen.getAllByLabelText('Actions')).toHaveLength(mockUsers.length);

    await openRowMenu(0);
    expect(screen.getByRole('menuitem', { name: 'User profile' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Plugins' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy();
  });

  it('clicking the Plugins menu item opens the grants modal', async () => {
    jest.spyOn(pluginGrantsModule, 'pluginGrantsRoleList').mockResolvedValue({
      roles: { user: [], vip: ['kiro'], premium: [], elite: [], admin: ['*'] },
      plugins: [{ id: 'kiro', name: 'Kiro Plugin', version: '1.0.0' }],
    });
    jest.spyOn(pluginGrantsModule, 'pluginGrantsUserGet').mockResolvedValue({
      grants: [],
      effective: [],
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('alice')).toBeTruthy());

    await openRowMenu(0);
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Plugins' }));
    });

    await waitFor(() => {
      expect(screen.getByText('Per-user grants')).toBeTruthy();
    });
  });

  it('clicking the User profile menu item navigates to /users/:id', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('alice')).toBeTruthy());

    await openRowMenu(0);
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'User profile' }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('profile-route')).toBeTruthy();
    });
  });

  it('clicking the Delete menu item routes through the shared confirm dialog', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('alice')).toBeTruthy());

    await openRowMenu(0);
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    });

    await waitFor(() => {
      expect(askConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Delete user', variant: 'danger' })
      );
    });
  });
});

describe('Users page — impact-aware delete', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deletes without transfer_to when the impact preview is empty', async () => {
    const fetchMock = mockDeleteFlowFetch(emptyImpact);
    renderPage();
    await waitFor(() => expect(screen.getByText('alice')).toBeTruthy());

    await clickRowDelete(0);

    await waitFor(() => expect(findDeleteCall(fetchMock)).toBeTruthy());
    expect(askConfirm).toHaveBeenCalled();
    const [url] = findDeleteCall(fetchMock)!;
    expect(url).toContain('/api/auth/users/1');
    expect(url).not.toContain('transfer_to');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lists owned groups, requires a successor, then deletes with transfer_to', async () => {
    const impact = {
      owned_groups: [{ id: 7, name: 'Team Alpha', member_count: 3 }],
      owned_accounts: 2,
      owned_credentials: 1,
      owned_endpoints: 0,
    };
    const fetchMock = mockDeleteFlowFetch(impact);
    renderPage();
    await waitFor(() => expect(screen.getByText('alice')).toBeTruthy());

    await clickRowDelete(0);

    await waitFor(() => expect(screen.getByText('Team Alpha')).toBeTruthy());
    expect(askConfirm).not.toHaveBeenCalled();
    expect(screen.getByText('3 members')).toBeTruthy();
    expect(screen.getByText('Accounts')).toBeTruthy();
    expect(screen.getByText('Credentials')).toBeTruthy();
    expect(screen.queryByText('Endpoints')).toBeNull();

    const confirmBtn = screen.getByRole('button', { name: 'Transfer and delete' });
    expect(confirmBtn).toBeDisabled();

    // ARIA combobox takes no name-from-content; drive the label-associated native select.
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Transfer ownership to'), {
        target: { value: '2' },
      });
    });

    expect(confirmBtn).toBeEnabled();
    await act(async () => {
      fireEvent.click(confirmBtn);
    });

    await waitFor(() => expect(findDeleteCall(fetchMock)).toBeTruthy());
    expect(findDeleteCall(fetchMock)![0]).toContain('/api/auth/users/1?transfer_to=2');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('surfaces detail.message when the delete returns 409 (race)', async () => {
    mockDeleteFlowFetch(emptyImpact, 409, {
      detail: { message: 'User gained new groups meanwhile', impact: {} },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('alice')).toBeTruthy());

    await clickRowDelete(0);

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('User gained new groups meanwhile');
    });
  });
});
