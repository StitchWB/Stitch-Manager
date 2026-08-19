/**
 * GroupPoolTab Wave-2 tests.
 *
 * Covers:
 *   - "Добавить ключ" button opens the endpoint-picker modal.
 *   - OverflowMenu "disable" item calls updateCredential toggling enabled,
 *     then refreshes the pool.
 *   - OverflowMenu "Убрать из группы" (unshare) calls askConfirm, then
 *     groupsUnshareCredential with the right payload, then refreshes.
 *   - onPoolCountChange lifts the pool length to the parent.
 *
 * Mocks the Zustand stores with mutable state objects, stubs UI primitives,
 * mocks the backend groups module (unshare spy), and mocks i18n to return
 * keys so assertions are stable across locale changes (same pattern as
 * GroupsList.test.tsx and CredentialsList.test.tsx).
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

// ── Mock toast ───────────────────────────────────────────────────────────────
jest.mock('@/lib/observability/toast', () => ({
  appToast: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

// ── Mock askConfirm (auto-resolve true so destructive paths proceed) ────────
jest.mock('@/components/ui/ConfirmDialogHost', () => ({
  askConfirm: jest.fn(async () => true),
}));

// ── Mock backend groups module (unshare spy) ─────────────────────────────────
const groupsUnshareCredential = jest.fn(async () => ({ success: true }));
jest.mock('@/lib/backend/modules/groups', () => ({
  groupsUnshareCredential: (...args: unknown[]) => groupsUnshareCredential(...args),
  // CredentialForm imports groupsShareCredential — stub it so the component
  // compiles even though we don't exercise the share path here.
  groupsShareCredential: jest.fn(async () => ({ success: true })),
}));

// ── Stub CredentialForm so we don't pull in the full ai-gateway tree ────────
jest.mock('@/components/ai-gateway/CredentialForm', () => ({
  CredentialForm: ({ endpoint, open, onClose }: any) =>
    open ? (
      <div data-testid="credential-form">
        <span data-testid="endpoint-id">{endpoint?.id}</span>
        <button onClick={onClose}>close</button>
      </div>
    ) : null,
}));

// ── Stub UI primitives ─────────────────────────────────────────────────────
jest.mock('@/components/ui', () => ({
  GlassCard: ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
  Badge: ({ children, variant, ...rest }: any) => (
    <span data-variant={variant} {...rest}>{children}</span>
  ),
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>{children}</button>
  ),
  IconButton: ({ children, onClick, 'aria-label': ariaLabel, ...rest }: any) => (
    <button onClick={onClick} aria-label={ariaLabel} {...rest}>{children}</button>
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
  Modal: ({ children, isOpen, footer, ...rest }: any) =>
    isOpen ? (
      <div {...rest}>
        {children}
        {footer}
      </div>
    ) : null,
  Select: ({ value, onValueChange, children, ...rest }: any) => (
    <select
      value={value}
      onChange={(e) => onValueChange?.(e.target.value)}
      {...rest}
    >
      {children}
    </select>
  ),
  EmptyState: ({ title, ...rest }: any) => (
    <div {...rest}><span>{title}</span></div>
  ),
  SkeletonLoader: () => <div data-testid="skeleton" />,
  ProviderLogo: ({ provider, ...rest }: any) => (
    <span data-testid="provider-logo" {...rest}>{provider}</span>
  ),
}));

// ── Mutable store state mocks ───────────────────────────────────────────────
const groupsState: any = {
  pool: [],
  loading: { pool: false },
  errors: { pool: null },
  fetchPool: jest.fn(async () => undefined),
};

jest.mock('@/stores/groups', () => ({
  useGroupsStore: (selector?: (s: any) => any) =>
    selector ? selector(groupsState) : groupsState,
}));

const gatewayState: any = {
  endpoints: [],
  updateCredential: jest.fn(async () => null),
  fetchEndpoints: jest.fn(async () => undefined),
};

jest.mock('@/stores/aiGateway', () => ({
  useAiGatewayStore: (selector?: (s: any) => any) =>
    selector ? selector(gatewayState) : gatewayState,
}));

// ── Mock auth store (CredentialForm imports it) ─────────────────────────────
jest.mock('@/stores/auth', () => ({
  useAuthStore: (selector?: (s: any) => any) =>
    selector ? selector({ enabled: false, user: null }) : { enabled: false, user: null },
}));

import { GroupPoolTab } from '@/components/ai-groups/GroupPoolTab';
import type { PoolItem } from '@/lib/backend/modules/groups';
import { askConfirm } from '@/components/ui/ConfirmDialogHost';
import { appToast } from '@/lib/observability/toast';

// ── Factory helpers ─────────────────────────────────────────────────────────

function makePoolItem(overrides: Partial<PoolItem> = {}): PoolItem {
  return {
    credential_id: overrides.credential_id ?? 'cred-1',
    label: overrides.label ?? 'My Key',
    endpoint_name: overrides.endpoint_name ?? 'OpenAI',
    adapter_type: overrides.adapter_type ?? 'openai',
    runtime_status: overrides.runtime_status ?? 'active',
    enabled: overrides.enabled ?? true,
    contributor_username: overrides.contributor_username ?? 'owner',
    masked_secret: overrides.masked_secret ?? 'sk-••••••••',
    can_manage: overrides.can_manage ?? true,
    can_unshare: overrides.can_unshare ?? true,
    created_at: overrides.created_at ?? '2024-01-01T00:00:00Z',
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('GroupPoolTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    groupsState.pool = [];
    groupsState.loading = { pool: false };
    groupsState.errors = { pool: null };
    gatewayState.endpoints = [];
  });

  it('renders empty state when pool is empty', () => {
    render(<GroupPoolTab groupId="g-1" />);

    expect(screen.getByText('ai.groups.pool.empty')).toBeTruthy();
  });

  it('renders pool rows with status badges', () => {
    groupsState.pool = [
      makePoolItem({ credential_id: 'c1', label: 'Alpha Key' }),
      makePoolItem({ credential_id: 'c2', label: 'Beta Key', runtime_status: 'disabled' }),
    ];

    render(<GroupPoolTab groupId="g-1" />);

    expect(screen.getByText('Alpha Key')).toBeTruthy();
    expect(screen.getByText('Beta Key')).toBeTruthy();
  });

  it('renders "Добавить ключ" button that opens the endpoint-picker modal', () => {
    render(<GroupPoolTab groupId="g-1" />);

    const addBtn = screen.getByText('ai.groups.pool.addKey');
    fireEvent.click(addBtn);

    // The picker modal is open — title visible.
    expect(screen.getByText('ai.groups.pool.addKey')).toBeTruthy();
    // No endpoints → shows the "no endpoints" message.
    expect(screen.getByText('ai.groups.pool.noEndpoints')).toBeTruthy();
  });

  it('shows endpoint Select when endpoints exist and opens CredentialForm on pick', () => {
    gatewayState.endpoints = [
      { id: 'ep-1', name: 'OpenAI', adapterType: 'openai', baseUrl: '', enabled: true, circuitState: 'closed', createdAt: '' },
    ];

    render(<GroupPoolTab groupId="g-1" />);

    // Open the picker.
    fireEvent.click(screen.getByText('ai.groups.pool.addKey'));

    // The Select is rendered with the endpoint option.
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select).toBeTruthy();

    // Pick the endpoint — CredentialForm should render.
    fireEvent.change(select, { target: { value: 'ep-1' } });

    expect(screen.getByTestId('credential-form')).toBeTruthy();
    expect(screen.getByTestId('endpoint-id').textContent).toBe('ep-1');
  });

  it('calls updateCredential toggling enabled when "disable" menu item is clicked', async () => {
    groupsState.pool = [makePoolItem({ credential_id: 'c1', enabled: true, can_manage: true })];

    render(<GroupPoolTab groupId="g-1" />);

    // The OverflowMenu renders the "disable" item (item.enabled=true → label=disable).
    const disableBtn = screen.getByText('ai.groups.pool.disable');
    fireEvent.click(disableBtn);

    await waitFor(() => {
      expect(gatewayState.updateCredential).toHaveBeenCalledWith({ id: 'c1', enabled: false });
    });
    expect(groupsState.fetchPool).toHaveBeenCalledWith('g-1');
    expect(appToast.success).toHaveBeenCalledWith('ai.groups.pool.toggled', 'ai-groups');
  });

  it('calls updateCredential enabling when "enable" menu item is clicked on disabled item', async () => {
    groupsState.pool = [makePoolItem({ credential_id: 'c2', enabled: false, can_manage: true })];

    render(<GroupPoolTab groupId="g-1" />);

    const enableBtn = screen.getByText('ai.groups.pool.enable');
    fireEvent.click(enableBtn);

    await waitFor(() => {
      expect(gatewayState.updateCredential).toHaveBeenCalledWith({ id: 'c2', enabled: true });
    });
  });

  it('disables toggle menu item when can_manage is false', () => {
    groupsState.pool = [makePoolItem({ can_manage: false })];

    render(<GroupPoolTab groupId="g-1" />);

    const toggleBtn = screen.getByText('ai.groups.pool.disable');
    expect((toggleBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('calls groupsUnshareCredential after confirm when "unshare" menu item is clicked', async () => {
    groupsState.pool = [makePoolItem({ credential_id: 'c1', can_unshare: true })];

    render(<GroupPoolTab groupId="g-1" />);

    const unshareBtn = screen.getByText('ai.groups.pool.unshareFromGroup');
    fireEvent.click(unshareBtn);

    await waitFor(() => {
      expect(askConfirm).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(groupsUnshareCredential).toHaveBeenCalledWith({
        credentialId: 'c1',
        groupId: 'g-1',
      });
    });
    expect(groupsState.fetchPool).toHaveBeenCalledWith('g-1');
    expect(appToast.success).toHaveBeenCalledWith('ai.groups.pool.unshared', 'ai-groups');
  });

  it('disables unshare menu item when can_unshare is false', () => {
    groupsState.pool = [makePoolItem({ can_unshare: false })];

    render(<GroupPoolTab groupId="g-1" />);

    const unshareBtn = screen.getByText('ai.groups.pool.unshareFromGroup');
    expect((unshareBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not call groupsUnshareCredential when confirm is cancelled', async () => {
    (askConfirm as jest.Mock).mockResolvedValueOnce(false);
    groupsState.pool = [makePoolItem({ credential_id: 'c1', can_unshare: true })];

    render(<GroupPoolTab groupId="g-1" />);

    fireEvent.click(screen.getByText('ai.groups.pool.unshareFromGroup'));

    await waitFor(() => {
      expect(askConfirm).toHaveBeenCalled();
    });

    // Give the async path a tick to settle.
    await new Promise(r => setTimeout(r, 10));

    expect(groupsUnshareCredential).not.toHaveBeenCalled();
  });

  it('lifts pool count to parent via onPoolCountChange', () => {
    const onPoolCountChange = jest.fn();
    groupsState.pool = [makePoolItem(), makePoolItem(), makePoolItem()];

    render(<GroupPoolTab groupId="g-1" onPoolCountChange={onPoolCountChange} />);

    expect(onPoolCountChange).toHaveBeenCalledWith(3);
  });
});
