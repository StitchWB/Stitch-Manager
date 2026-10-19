/**
 * AdminOverview page tests.
 *
 * Verifies:
 *   - Renders the all-groups table, partner-members table and plugin-grant
 *     audit table from the mocked backend modules.
 *   - The enforce_login toggle reflects GET /api/auth/status and writes
 *     through setLoginPolicy (POST /api/auth/policy).
 *   - Empty datasets render the per-section empty states.
 *   - A rejected section surfaces an error banner with Retry.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

jest.mock('../../components/layout/Header', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <div data-testid="header">{title}</div>,
}));

jest.mock('../../stores/app', () => ({
  useAppStore: (selector?: (s: { language: string }) => unknown) =>
    selector ? selector({ language: 'en' }) : { language: 'en' },
}));

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

jest.mock('../../lib/backend/modules/groups', () => ({
  groupsAdminList: jest.fn(),
}));
jest.mock('../../lib/backend/modules/partners', () => ({
  listPartnerMembers: jest.fn(),
}));
jest.mock('../../lib/backend/modules/pluginGrants', () => ({
  pluginGrantsAuditList: jest.fn(),
}));
jest.mock('../../lib/backend/modules/auth', () => ({
  getAuthStatus: jest.fn(),
  setLoginPolicy: jest.fn(),
}));

import AdminOverview from '../../pages/AdminOverview';
import { groupsAdminList } from '../../lib/backend/modules/groups';
import { listPartnerMembers } from '../../lib/backend/modules/partners';
import { pluginGrantsAuditList } from '../../lib/backend/modules/pluginGrants';
import { getAuthStatus, setLoginPolicy } from '../../lib/backend/modules/auth';

const mockGroupsAdminList = groupsAdminList as jest.MockedFunction<typeof groupsAdminList>;
const mockListPartnerMembers = listPartnerMembers as jest.MockedFunction<typeof listPartnerMembers>;
const mockPluginGrantsAuditList = pluginGrantsAuditList as jest.MockedFunction<typeof pluginGrantsAuditList>;
const mockGetAuthStatus = getAuthStatus as jest.MockedFunction<typeof getAuthStatus>;
const mockSetLoginPolicy = setLoginPolicy as jest.MockedFunction<typeof setLoginPolicy>;

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminOverview />
    </MemoryRouter>,
  );
}

describe('AdminOverview page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGroupsAdminList.mockResolvedValue({
      groups: [
        { id: 'g1', name: 'team-alpha', owner_username: 'alice', member_count: 3, share_count: 2 },
      ],
    });
    mockListPartnerMembers.mockResolvedValue([
      {
        channel_id: 'ch-1',
        user_id: 7,
        granted_role: 'vip',
        invited_by_tg_id: 999,
        created_at: '2026-01-02T03:04:05Z',
      },
    ]);
    mockPluginGrantsAuditList.mockResolvedValue({
      entries: [
        {
          ts: '2026-01-02T03:04:05Z',
          adminUserId: 1,
          action: 'role_set',
          scope: 'role',
          target: 'vip',
          pluginId: 'stitch-totp',
          granted: true,
        },
      ],
    });
    mockGetAuthStatus.mockResolvedValue({
      enabled: true,
      has_users: true,
      required: true,
      enforce_login: true,
      tg_auth_mode: 'legacy',
      reachable: true,
    });
    mockSetLoginPolicy.mockImplementation(async (v: boolean) => v);
  });

  it('renders groups, partner members and audit rows', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('team-alpha')).toBeTruthy();
    });

    expect(screen.getByText('alice')).toBeTruthy();
    expect(screen.getByText('ch-1')).toBeTruthy();
    expect(screen.getAllByText('vip').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('stitch-totp')).toBeTruthy();
    expect(screen.getByText('role_set')).toBeTruthy();
    expect(screen.getByText('Granted')).toBeTruthy();
    expect(mockPluginGrantsAuditList).toHaveBeenCalledWith(20);
  });

  it('enforce_login toggle reflects status and persists via setLoginPolicy', async () => {
    renderPage();

    const toggle = await screen.findByRole('checkbox');
    await waitFor(() => {
      expect((toggle as HTMLInputElement).checked).toBe(true);
    });

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(mockSetLoginPolicy).toHaveBeenCalledWith(false);
    await waitFor(() => {
      expect((toggle as HTMLInputElement).checked).toBe(false);
    });
  });

  it('shows empty states when datasets are empty', async () => {
    mockGroupsAdminList.mockResolvedValue({ groups: [] });
    mockListPartnerMembers.mockResolvedValue([]);
    mockPluginGrantsAuditList.mockResolvedValue({ entries: [] });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('No groups yet')).toBeTruthy();
    });
    expect(screen.getByText('No partner members yet')).toBeTruthy();
    expect(screen.getByText('No audit entries yet')).toBeTruthy();
  });

  it('shows an error banner with retry when a section fails', async () => {
    mockGroupsAdminList.mockRejectedValue(new Error('groups boom'));

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('groups boom')).toBeTruthy();
    });
    expect(screen.getByText('Retry')).toBeTruthy();
  });
});
