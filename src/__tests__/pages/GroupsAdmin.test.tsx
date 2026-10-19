/**
 * GroupsAdmin page tests.
 *
 * Verifies:
 *   - Renders the all-groups table from groups_admin_list with unknown
 *     level badges (the list command carries no level).
 *   - Verify calls group_verify and flips the row badge to Verified.
 *   - Suspend goes through askConfirm, calls group_suspend and flips the
 *     row badge to Suspended; a declined confirm does not call the backend.
 *   - Limits load from getGroupsLimits and save through setGroupsLimits;
 *     an invalid limit is rejected with a toast and no backend call.
 *   - A rejected group list surfaces an error banner with Retry.
 *
 * Mirrors AdminOverview.test.tsx: real i18n (en), mocked Header/stores/
 * sonner/backend modules.
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

jest.mock('../../components/ui/ConfirmDialogHost', () => ({
  ConfirmDialogHost: () => null,
  askConfirm: jest.fn(() => Promise.resolve(true)),
}));

jest.mock('../../lib/backend/modules/groups', () => ({
  groupsAdminList: jest.fn(),
  groupVerify: jest.fn(),
  groupSuspend: jest.fn(),
}));

jest.mock('../../lib/backend/modules/settings', () => ({
  getGroupsLimits: jest.fn(),
  setGroupsLimits: jest.fn(),
}));

import GroupsAdmin from '../../pages/GroupsAdmin';
import { groupsAdminList, groupVerify, groupSuspend } from '../../lib/backend/modules/groups';
import { getGroupsLimits, setGroupsLimits } from '../../lib/backend/modules/settings';
import { askConfirm } from '../../components/ui/ConfirmDialogHost';
import { toast } from 'sonner';

const mockGroupsAdminList = groupsAdminList as jest.MockedFunction<typeof groupsAdminList>;
const mockGroupVerify = groupVerify as jest.MockedFunction<typeof groupVerify>;
const mockGroupSuspend = groupSuspend as jest.MockedFunction<typeof groupSuspend>;
const mockGetGroupsLimits = getGroupsLimits as jest.MockedFunction<typeof getGroupsLimits>;
const mockSetGroupsLimits = setGroupsLimits as jest.MockedFunction<typeof setGroupsLimits>;
const mockAskConfirm = askConfirm as jest.MockedFunction<typeof askConfirm>;

function renderPage() {
  return render(
    <MemoryRouter>
      <GroupsAdmin />
    </MemoryRouter>,
  );
}

function makeGroup(id: string, name: string) {
  return { id, name, owner_username: 'alice', member_count: 3, share_count: 2 };
}

describe('GroupsAdmin page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGroupsAdminList.mockResolvedValue({
      groups: [makeGroup('g1', 'team-alpha')],
    });
    mockGetGroupsLimits.mockResolvedValue({
      maxPerUser: 5,
      openMaxMembers: null,
      maxGatedPlugins: 3,
    });
    mockGroupVerify.mockResolvedValue({
      id: 'g1', name: 'team-alpha', owner_id: 1, level: 'verified',
      status: 'active', created_at: '2026-01-01T00:00:00Z',
    });
    mockGroupSuspend.mockResolvedValue({
      id: 'g1', name: 'team-alpha', owner_id: 1, level: 'suspended',
      status: 'suspended', created_at: '2026-01-01T00:00:00Z',
    });
    mockSetGroupsLimits.mockResolvedValue(undefined);
    mockAskConfirm.mockResolvedValue(true);
  });

  it('renders the group row with an unknown level badge', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('team-alpha')).toBeTruthy();
    });
    expect(screen.getByText('alice')).toBeTruthy();
    expect(screen.getByText('Unknown')).toBeTruthy();
  });

  it('verify calls group_verify and flips the level badge', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('team-alpha')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Verify'));
    });

    expect(mockGroupVerify).toHaveBeenCalledWith('g1');
    await waitFor(() => {
      expect(screen.getByText('Verified')).toBeTruthy();
    });
    expect(toast.success).toHaveBeenCalledWith('Group verified');
  });

  it('suspend confirms, calls group_suspend and flips the level badge', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('team-alpha')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Suspend'));
    });

    expect(mockAskConfirm).toHaveBeenCalled();
    expect(mockGroupSuspend).toHaveBeenCalledWith('g1');
    await waitFor(() => {
      expect(screen.getByText('Suspended')).toBeTruthy();
    });
    expect(toast.success).toHaveBeenCalledWith('Group suspended');
  });

  it('declined suspend confirm does not call the backend', async () => {
    mockAskConfirm.mockResolvedValue(false);
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('team-alpha')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Suspend'));
    });

    expect(mockGroupSuspend).not.toHaveBeenCalled();
  });

  it('loads limits and saves them via setGroupsLimits', async () => {
    renderPage();
    const maxPerUser = await screen.findByLabelText('Groups per user');
    expect((maxPerUser as HTMLInputElement).value).toBe('5');
    const openMaxMembers = screen.getByLabelText('Members per open group');
    expect((openMaxMembers as HTMLInputElement).value).toBe('');

    fireEvent.change(openMaxMembers, { target: { value: '50' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Save limits'));
    });

    expect(mockSetGroupsLimits).toHaveBeenCalledWith({
      maxPerUser: 5,
      openMaxMembers: 50,
      maxGatedPlugins: 3,
    });
    expect(toast.success).toHaveBeenCalledWith('Limits saved');
  });

  it('rejects an invalid limit with a toast and no backend call', async () => {
    renderPage();
    const maxPerUser = await screen.findByLabelText('Groups per user');

    fireEvent.change(maxPerUser, { target: { value: '0' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Save limits'));
    });

    expect(toast.error).toHaveBeenCalledWith('Limits must be whole positive numbers');
    expect(mockSetGroupsLimits).not.toHaveBeenCalled();
  });

  it('shows an error banner with retry when the group list fails', async () => {
    mockGroupsAdminList.mockRejectedValue(new Error('groups boom'));
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('groups boom')).toBeTruthy();
    });
    expect(screen.getByText('Retry')).toBeTruthy();
  });
});
