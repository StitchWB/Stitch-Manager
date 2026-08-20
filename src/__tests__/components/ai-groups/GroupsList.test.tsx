/**
 * Groups UI component tests.
 *
 * Covers:
 *   - GroupsList: renders rows with role badges + meta, empty state CTA,
 *     search filter, onSelect/onCreate callbacks, skeleton/error states.
 *   - InviteBanner: accept/decline call the store resolveInvite action with
 *     the correct { inviteId, accept } payload, then fire onResolved.
 *   - GroupDetail: sole-owner guard disables Leave (header button + overflow
 *     item), while multiple members enables Leave.
 *
 * Mocks the Zustand store with a mutable state object (same pattern as the
 * pre-existing test), stubs UI primitives, and mocks i18n to return keys so
 * assertions are stable across locale changes.
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
  getLocale: () => 'en',
}));

// ── Mock sonner toast ───────────────────────────────────────────────────────
jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

// ── Mock askConfirm (auto-resolve true so non-sole-owner paths proceed) ─────
jest.mock('@/components/ui/ConfirmDialogHost', () => ({
  askConfirm: jest.fn(async () => true),
}));

// ── Mock child tab components (GroupDetail renders them) ───────────────────
jest.mock('@/components/ai-groups/GroupPoolTab', () => ({
  GroupPoolTab: () => <div data-testid="pool-tab" />,
}));
jest.mock('@/components/ai-groups/GroupMembersTab', () => ({
  GroupMembersTab: () => <div data-testid="members-tab" />,
}));
jest.mock('@/components/ai-groups/GroupSettingsTab', () => ({
  GroupSettingsTab: () => <div data-testid="settings-tab" />,
}));

// ── Stub UI primitives ─────────────────────────────────────────────────────
jest.mock('@/components/ui', () => ({
  GlassCard: ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
  Badge: ({ children, ...rest }: any) => <span {...rest}>{children}</span>,
  Button: ({ children, onClick, ...rest }: any) => (
    <button onClick={onClick} {...rest}>{children}</button>
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
  EmptyState: ({ title, description, action, ...rest }: any) => (
    <div {...rest}>
      <span>{title}</span>
      {description && <span>{description}</span>}
      {action}
    </div>
  ),
  SkeletonLoader: () => <div data-testid="skeleton" />,
  Tooltip: ({ children, content }: any) => (
    <span title={content}>{children}</span>
  ),
  PageHeader: ({ title, actions, ...rest }: any) => (
    <div {...rest}>
      <h1>{title}</h1>
      {actions}
    </div>
  ),
  TabButton: ({ label, onClick, active, ...rest }: any) => (
    <button onClick={onClick} data-active={active} {...rest}>{label}</button>
  ),
  OverflowMenu: ({ items = [], triggerLabel, ...rest }: any) => (
    <div {...rest}>
      <button>{triggerLabel}</button>
      {items.map((item: any) => (
        <button key={item.id} onClick={item.onSelect} disabled={item.disabled}>
          {item.label}
        </button>
      ))}
    </div>
  ),
  Modal: ({ children, isOpen, ...rest }: any) =>
    isOpen ? <div {...rest}>{children}</div> : null,
  KeyValueList: ({ rows = [], ...rest }: any) => (
    <div {...rest}>
      {rows.map((r: any) => <div key={r.id}>{r.label}: {r.value}</div>)}
    </div>
  ),
  ConfirmDialog: ({ isOpen, onConfirm, ...rest }: any) =>
    isOpen ? <div {...rest}><button onClick={onConfirm}>confirm</button></div> : null,
  ProviderLogo: ({ provider, ...rest }: any) => (
    <span data-testid="provider-logo" {...rest}>{provider}</span>
  ),
}));

// ── Mutable store state mock ───────────────────────────────────────────────
const storeState: any = {
  groups: [],
  invites: [],
  detail: null,
  pool: [],
  loading: { list: false, detail: false, pool: false, action: false },
  errors: { list: null, detail: null, pool: null, action: null },
  fetchList: jest.fn(async () => undefined),
  fetchDetail: jest.fn(async () => undefined),
  fetchPool: jest.fn(async () => undefined),
  createGroup: jest.fn(async () => ({ id: 'g-1', name: 'Test', owner_id: 1, created_at: '' })),
  updateGroup: jest.fn(async () => ({ id: 'g-1', name: 'Test', owner_id: 1, created_at: '' })),
  deleteGroup: jest.fn(async () => undefined),
  inviteMember: jest.fn(async () => ({
    id: 'inv-1', group_id: 'g-1', invitee_username: 'user1',
    invited_by_username: 'owner', status: 'pending', created_at: '',
  })),
  resolveInvite: jest.fn(async () => undefined),
  revokeInvite: jest.fn(async () => undefined),
  removeMember: jest.fn(async () => undefined),
  leaveGroup: jest.fn(async () => undefined),
  clearDetail: jest.fn(),
  clearActionError: jest.fn(),
};

jest.mock('@/stores/groups', () => ({
  useGroupsStore: (selector?: (s: any) => any) =>
    selector ? selector(storeState) : storeState,
}));

import { GroupsList } from '@/components/ai-groups/GroupsList';
import { InviteBanner } from '@/components/ai-groups/InviteBanner';
import { GroupDetail } from '@/components/ai-groups/GroupDetail';
import { askConfirm } from '@/components/ui/ConfirmDialogHost';
import { toast } from 'sonner';
import type {
  GroupSummary,
  GroupInviteSummary,
  GroupDetailResponse,
} from '@/lib/backend/modules/groups';

// ── Factory helpers ────────────────────────────────────────────────────────

function makeGroup(overrides: Partial<GroupSummary> = {}): GroupSummary {
  return {
    id: overrides.id ?? 'g-1',
    name: overrides.name ?? 'Test Group',
    role: overrides.role ?? 'owner',
    member_count: overrides.member_count ?? 3,
    key_count: overrides.key_count ?? 2,
    created_at: overrides.created_at ?? '2024-01-01T00:00:00Z',
  };
}

function makeInvite(overrides: Partial<GroupInviteSummary> = {}): GroupInviteSummary {
  return {
    id: overrides.id ?? 'inv-1',
    group_id: overrides.group_id ?? 'g-1',
    group_name: overrides.group_name ?? 'Test Group',
    invited_by_username: overrides.invited_by_username ?? 'admin',
    created_at: overrides.created_at ?? '2024-01-01T00:00:00Z',
  };
}

function makeDetail(overrides: Partial<GroupDetailResponse> = {}): GroupDetailResponse {
  return {
    group: overrides.group ?? {
      id: 'g-1', name: 'Test Group', owner_id: 1,
      created_at: '2024-01-01T00:00:00Z',
    },
    members: overrides.members ?? [
      { user_id: 1, username: 'owner', role: 'owner' as const, joined_at: '2024-01-01' },
    ],
    invites: overrides.invites ?? [],
    is_owner: overrides.is_owner ?? true,
  };
}

// ── GroupsList ──────────────────────────────────────────────────────────────

describe('GroupsList', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storeState.groups = [];
    storeState.invites = [];
    storeState.detail = null;
    storeState.pool = [];
    storeState.loading = { list: false, detail: false, pool: false, action: false };
    storeState.errors = { list: null, detail: null, pool: null, action: null };
  });

  it('renders empty state with CTA when no groups', () => {
    render(
      <GroupsList selectedId={null} onSelect={jest.fn()} onCreate={jest.fn()} />,
    );

    expect(screen.getByText('ai.groups.empty.title')).toBeTruthy();
    expect(screen.getByText('ai.groups.empty.desc')).toBeTruthy();
    // CTA button rendered inside the empty state action slot.
    expect(screen.getByText('ai.groups.create.cta')).toBeTruthy();
  });

  it('renders group rows with role badges and meta', () => {
    storeState.groups = [
      makeGroup({ id: 'g-1', name: 'Alpha Team', role: 'owner', member_count: 5, key_count: 3 }),
      makeGroup({ id: 'g-2', name: 'Beta Squad', role: 'member', member_count: 2, key_count: 1 }),
    ];

    render(
      <GroupsList selectedId={null} onSelect={jest.fn()} onCreate={jest.fn()} />,
    );

    // Group names visible.
    expect(screen.getByText('Alpha Team')).toBeTruthy();
    expect(screen.getByText('Beta Squad')).toBeTruthy();

    // Role badges.
    expect(screen.getByText('ai.groups.role.owner')).toBeTruthy();
    expect(screen.getByText('ai.groups.role.member')).toBeTruthy();

    // Meta line — one per group row.
    expect(screen.getAllByText('ai.groups.meta')).toHaveLength(2);
  });

  it('filters groups by search query', () => {
    storeState.groups = [
      makeGroup({ id: 'g-1', name: 'Alpha Team' }),
      makeGroup({ id: 'g-2', name: 'Beta Squad' }),
    ];

    const { container } = render(
      <GroupsList selectedId={null} onSelect={jest.fn()} onCreate={jest.fn()} />,
    );

    const searchInput = container.querySelector(
      'input[aria-label="ai.groups.search.placeholder"]',
    );
    expect(searchInput).toBeTruthy();

    fireEvent.change(searchInput!, { target: { value: 'alpha' } });

    expect(screen.getByText('Alpha Team')).toBeTruthy();
    expect(screen.queryByText('Beta Squad')).toBeNull();
  });

  it('calls onSelect when a group row is clicked', () => {
    const onSelect = jest.fn();
    storeState.groups = [makeGroup({ id: 'g-1', name: 'Alpha Team' })];

    render(<GroupsList selectedId={null} onSelect={onSelect} onCreate={jest.fn()} />);

    const row = screen.getByText('Alpha Team').closest('button');
    expect(row).toBeTruthy();
    fireEvent.click(row!);

    expect(onSelect).toHaveBeenCalledWith('g-1');
  });

  it('calls onCreate when the create button is clicked', () => {
    const onCreate = jest.fn();
    storeState.groups = [makeGroup({ id: 'g-1', name: 'Alpha Team' })];

    render(<GroupsList selectedId={null} onSelect={jest.fn()} onCreate={onCreate} />);

    const createBtn = screen.getByLabelText('ai.groups.create.title');
    fireEvent.click(createBtn);

    expect(onCreate).toHaveBeenCalled();
  });

  it('shows skeleton loader while loading', () => {
    storeState.loading = { list: true, detail: false, pool: false, action: false };

    const { container } = render(
      <GroupsList selectedId={null} onSelect={jest.fn()} onCreate={jest.fn()} />,
    );

    expect(container.querySelector('[data-testid="skeleton"]')).toBeTruthy();
  });

  it('shows error state with retry when load fails', () => {
    storeState.errors = { list: 'Network error', detail: null, pool: null, action: null };

    render(
      <GroupsList selectedId={null} onSelect={jest.fn()} onCreate={jest.fn()} />,
    );

    expect(screen.getByText('ai.groups.loadFailed')).toBeTruthy();
    expect(screen.getByText('common.retry')).toBeTruthy();
  });
});

// ── InviteBanner ────────────────────────────────────────────────────────────

describe('InviteBanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storeState.resolveInvite = jest.fn(async () => undefined);
  });

  it('renders nothing when there are no invites', () => {
    const { container } = render(<InviteBanner invites={[]} onResolved={jest.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders accept and decline buttons for each invite', () => {
    const invites = [makeInvite({ id: 'inv-1', group_name: 'Alpha Group' })];

    render(<InviteBanner invites={invites} onResolved={jest.fn()} />);

    expect(screen.getByText('ai.groups.invite.banner.accept')).toBeTruthy();
    expect(screen.getByText('ai.groups.invite.banner.decline')).toBeTruthy();
    // Banner title (with group param substituted into the key — no-op since
    // the key string has no {group} placeholder, so the raw key is returned).
    expect(screen.getByText('ai.groups.invite.banner.title')).toBeTruthy();
  });

  it('calls resolveInvite with accept=true when Accept is clicked', async () => {
    const invites = [makeInvite({ id: 'inv-1', group_name: 'Alpha Group' })];
    const onResolved = jest.fn();

    render(<InviteBanner invites={invites} onResolved={onResolved} />);

    fireEvent.click(screen.getByText('ai.groups.invite.banner.accept'));

    await waitFor(() => {
      expect(storeState.resolveInvite).toHaveBeenCalledWith({
        inviteId: 'inv-1',
        accept: true,
      });
    });
    expect(onResolved).toHaveBeenCalled();
  });

  it('calls resolveInvite with accept=false when Decline is clicked', async () => {
    const invites = [makeInvite({ id: 'inv-1', group_name: 'Alpha Group' })];
    const onResolved = jest.fn();

    render(<InviteBanner invites={invites} onResolved={onResolved} />);

    fireEvent.click(screen.getByText('ai.groups.invite.banner.decline'));

    await waitFor(() => {
      expect(storeState.resolveInvite).toHaveBeenCalledWith({
        inviteId: 'inv-1',
        accept: false,
      });
    });
    expect(onResolved).toHaveBeenCalled();
  });
});

// ── GroupDetail — sole-owner Leave guard ────────────────────────────────────

describe('GroupDetail — sole-owner Leave disabled', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storeState.loading = { list: false, detail: false, pool: false, action: false };
    storeState.errors = { list: null, detail: null, pool: null, action: null };
    storeState.detail = null;
  });

  it('disables Leave when the current user is the sole owner', () => {
    // Sole owner: is_owner=true, members has exactly one entry.
    storeState.detail = makeDetail({
      is_owner: true,
      members: [
        { user_id: 1, username: 'owner', role: 'owner' as const, joined_at: '2024-01-01' },
      ],
    });

    render(
      <GroupDetail
        groupId="g-1"
        currentUserId="1"
        onBack={jest.fn()}
        onDeleted={jest.fn()}
        onLeft={jest.fn()}
      />,
    );

    // The header renders a disabled Leave button when sole owner, and the
    // OverflowMenu's leave item is also disabled. Both have the same label.
    const leaveButtons = screen.getAllByText('ai.groups.actions.leave');
    expect(leaveButtons.length).toBeGreaterThanOrEqual(1);

    for (const btn of leaveButtons) {
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('enables Leave when there are multiple members', () => {
    storeState.detail = makeDetail({
      is_owner: true,
      members: [
        { user_id: 1, username: 'owner', role: 'owner' as const, joined_at: '2024-01-01' },
        { user_id: 2, username: 'member2', role: 'member' as const, joined_at: '2024-01-02' },
      ],
    });

    render(
      <GroupDetail
        groupId="g-1"
        currentUserId="1"
        onBack={jest.fn()}
        onDeleted={jest.fn()}
        onLeft={jest.fn()}
      />,
    );

    // No disabled header Leave button (soleOwner is false). The OverflowMenu
    // leave item is enabled.
    const leaveItems = screen.getAllByText('ai.groups.actions.leave');
    const enabledLeave = leaveItems.find(
      el => (el as HTMLButtonElement).disabled === false,
    );
    expect(enabledLeave).toBeTruthy();
  });

  it('opens ConfirmDialog directly when Delete overflow item is clicked', async () => {
    storeState.detail = makeDetail({
      is_owner: true,
      members: [
        { user_id: 1, username: 'owner', role: 'owner' as const, joined_at: '2024-01-01' },
        { user_id: 2, username: 'member2', role: 'member' as const, joined_at: '2024-01-02' },
      ],
    });

    const onDeleted = jest.fn();
    render(
      <GroupDetail
        groupId="g-1"
        currentUserId="1"
        onBack={jest.fn()}
        onDeleted={onDeleted}
        onLeft={jest.fn()}
      />,
    );

    // Click the Delete overflow item.
    fireEvent.click(screen.getByText('ai.groups.actions.delete'));

    // askConfirm was called (delete opens ConfirmDialog directly).
    await waitFor(() => {
      expect(askConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'ai.groups.settings.deleteConfirm.title',
          variant: 'danger',
        }),
      );
    });

    // deleteGroup called with the group id.
    await waitFor(() => {
      expect(storeState.deleteGroup).toHaveBeenCalledWith('g-1');
    });

    // onDeleted called after deleteGroup.
    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalled();
    });
  });

  it('shows toast and redirects to settings when Rename overflow item is clicked', async () => {
    storeState.detail = makeDetail({
      is_owner: true,
      members: [
        { user_id: 1, username: 'owner', role: 'owner' as const, joined_at: '2024-01-01' },
        { user_id: 2, username: 'member2', role: 'member' as const, joined_at: '2024-01-02' },
      ],
    });

    render(
      <GroupDetail
        groupId="g-1"
        currentUserId="1"
        onBack={jest.fn()}
        onDeleted={jest.fn()}
        onLeft={jest.fn()}
      />,
    );

    // Click the Rename overflow item.
    fireEvent.click(screen.getByText('ai.groups.actions.rename'));

    // Toast info was shown explaining the redirect.
    expect(toast.info).toHaveBeenCalledWith('ai.groups.actions.deleteViaSettings');

    // Settings tab is now active (settings-tab mock renders).
    await waitFor(() => {
      expect(screen.getByTestId('settings-tab')).toBeTruthy();
    });
  });
});
