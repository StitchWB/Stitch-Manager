/**
 * GroupMembersTab — transfer ownership tests.
 *
 * Covers:
 *   - Owner sees "Передать владение" (transfer) OverflowMenu item on non-self
 *     member rows; clicking it calls askConfirm, then groupsTransferOwnership
 *     with { groupId, userId }, then refreshes detail + toast.
 *   - Transfer item is NOT shown for self (self rows show Leave button, not
 *     the OverflowMenu).
 *   - Transfer item is NOT shown when isOwner is false (members don't get
 *     the OverflowMenu on other members).
 *
 * Mocks the Zustand store with a mutable state object, stubs UI primitives,
 * mocks the backend groups module (transfer spy), and mocks i18n to return
 * keys so assertions are stable across locale changes (same pattern as
 * GroupPoolTab.test.tsx).
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Mock i18n: return the key (with params substituted if present) ──────────
jest.mock('@/lib/i18n', () => ({
  t: (key: string, params?: Record<string, string | number>): string => {
    if (!params) return key;
    return Object.entries(params).reduce(
      (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
      key,
    );
  },
}));

// ── Mock sonner toast ───────────────────────────────────────────────────────
jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

// ── Mock askConfirm (auto-resolve true so transfer proceeds) ────────────────
jest.mock('@/components/ui/ConfirmDialogHost', () => ({
  askConfirm: jest.fn(async () => true),
}));

// ── Mock backend groups module (transfer spy) ──────────────────────────────
const groupsTransferOwnership = jest.fn(async () => ({
  id: 'g-1',
  name: 'Test',
  owner_id: 2,
  created_at: '',
}));
jest.mock('@/lib/backend/modules/groups', () => ({
  groupsTransferOwnership: (...args: unknown[]) => groupsTransferOwnership(...args),
}));

// ── Mock backend auth module (listUsers — admin-only, silently fails) ──────
jest.mock('@/lib/backend/modules/auth', () => ({
  listUsers: jest.fn(async () => []),
}));

// ── Stub UI primitives ─────────────────────────────────────────────────────
jest.mock('@/components/ui', () => ({
  GlassCard: ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
  Badge: ({ children, ...rest }: any) => <span {...rest}>{children}</span>,
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>{children}</button>
  ),
  ButtonBase: ({ children, onClick, ...rest }: any) => (
    <button onClick={onClick} {...rest}>{children}</button>
  ),
  IconButton: ({ children, onClick, 'aria-label': ariaLabel, ...rest }: any) => (
    <button onClick={onClick} aria-label={ariaLabel} {...rest}>{children}</button>
  ),
  Input: ({ value, onChange, placeholder, 'aria-label': ariaLabel, ...rest }: any) => (
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      aria-label={ariaLabel}
      {...rest}
    />
  ),
  OverflowMenu: ({ items = [], triggerLabel, ...rest }: any) => (
    <div {...rest}>
      <button>{triggerLabel}</button>
      {items.map((item: any) => (
        <button
          key={item.id}
          onClick={item.onSelect}
          disabled={item.disabled}
          data-item-id={item.id}
        >
          {item.label}
        </button>
      ))}
    </div>
  ),
  SkeletonLoader: () => <div data-testid="skeleton" />,
  Tooltip: ({ children, content }: any) => (
    <span title={content}>{children}</span>
  ),
}));

// ── Stub TierBadge (imports auth store) ─────────────────────────────────────
jest.mock('@/components/ui/TierBadge', () => ({
  TierBadge: () => <span data-testid="tier-badge" />,
}));

// ── Mutable store state mock ───────────────────────────────────────────────
const storeState: any = {
  detail: null,
  loading: { detail: false },
  inviteMember: jest.fn(async () => ({
    id: 'inv-1', group_id: 'g-1', invitee_username: 'user1',
    invited_by_username: 'owner', status: 'pending', created_at: '',
  })),
  revokeInvite: jest.fn(async () => undefined),
  removeMember: jest.fn(async () => undefined),
  leaveGroup: jest.fn(async () => undefined),
  fetchDetail: jest.fn(async () => undefined),
};

jest.mock('@/stores/groups', () => ({
  useGroupsStore: (selector?: (s: any) => any) =>
    selector ? selector(storeState) : storeState,
}));

import { GroupMembersTab } from '@/components/ai-groups/GroupMembersTab';
import type { GroupDetailResponse } from '@/lib/backend/modules/groups';
import { askConfirm } from '@/components/ui/ConfirmDialogHost';
import { toast } from 'sonner';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeDetail(overrides: Partial<GroupDetailResponse> = {}): GroupDetailResponse {
  return {
    group: overrides.group ?? {
      id: 'g-1',
      name: 'Test Group',
      owner_id: 1,
      created_at: '2024-01-01T00:00:00Z',
    },
    members: overrides.members ?? [
      { user_id: 1, username: 'owner', role: 'owner' as const, joined_at: '2024-01-01' },
      { user_id: 2, username: 'alice', role: 'member' as const, joined_at: '2024-01-02' },
    ],
    invites: overrides.invites ?? [],
    is_owner: overrides.is_owner ?? true,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('GroupMembersTab — transfer ownership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storeState.detail = null;
    storeState.loading = { detail: false };
  });

  it('shows transfer item on non-self member rows for owner', () => {
    storeState.detail = makeDetail();

    render(
      <GroupMembersTab groupId="g-1" isOwner={true} currentUserId="1" />,
    );

    // The OverflowMenu for alice (user_id=2, not self) renders the transfer item.
    const transferBtn = screen.getByText('ai.groups.members.transfer.action');
    expect(transferBtn).toBeTruthy();
    expect((transferBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('calls groupsTransferOwnership after confirm when transfer is clicked', async () => {
    storeState.detail = makeDetail();

    render(
      <GroupMembersTab groupId="g-1" isOwner={true} currentUserId="1" />,
    );

    // Click the transfer item.
    fireEvent.click(screen.getByText('ai.groups.members.transfer.action'));

    // askConfirm was called.
    await waitFor(() => {
      expect(askConfirm).toHaveBeenCalled();
    });

    // groupsTransferOwnership called with correct payload.
    await waitFor(() => {
      expect(groupsTransferOwnership).toHaveBeenCalledWith({
        groupId: 'g-1',
        userId: 2,
      });
    });

    // Detail refreshed.
    expect(storeState.fetchDetail).toHaveBeenCalledWith('g-1');

    // Success toast.
    expect(toast.success).toHaveBeenCalledWith(
      'ai.groups.members.transfer.success',
    );
  });

  it('does not call groupsTransferOwnership when confirm is cancelled', async () => {
    (askConfirm as jest.Mock).mockResolvedValueOnce(false);
    storeState.detail = makeDetail();

    render(
      <GroupMembersTab groupId="g-1" isOwner={true} currentUserId="1" />,
    );

    fireEvent.click(screen.getByText('ai.groups.members.transfer.action'));

    await waitFor(() => {
      expect(askConfirm).toHaveBeenCalled();
    });

    // Give the async path a tick to settle.
    await new Promise(r => setTimeout(r, 10));

    expect(groupsTransferOwnership).not.toHaveBeenCalled();
  });

  it('does not show transfer item for self (owner row)', () => {
    storeState.detail = makeDetail();

    const { container } = render(
      <GroupMembersTab groupId="g-1" isOwner={true} currentUserId="1" />,
    );

    // The owner row (user_id=1, self) shows a Leave button, not an OverflowMenu.
    // So there should be exactly one transfer item (for alice, not for owner).
    const transferBtns = screen.getAllByText('ai.groups.members.transfer.action');
    expect(transferBtns).toHaveLength(1);
  });

  it('does not show transfer item when isOwner is false', () => {
    storeState.detail = makeDetail({ is_owner: false });

    render(
      <GroupMembersTab groupId="g-1" isOwner={false} currentUserId="1" />,
    );

    // Non-owner: no OverflowMenu on other members → no transfer item.
    expect(screen.queryByText('ai.groups.members.transfer.action')).toBeNull();
  });
});
