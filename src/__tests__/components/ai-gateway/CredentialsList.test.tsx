/**
 * CredentialsList Wave-2 tests.
 *
 * Covers:
 *   - Scope chip cluster: personal (mine) / group-shared / legacy rendering.
 *   - Share picker: opening, toggling a group, confirm calls
 *     groupsShareCredential with the right payload.
 *   - Consent-once: first share opens the consent modal; pre-consented
 *     credential skips it and shares directly.
 *   - Unshare: unchecking an already-shared group calls
 *     groupsUnshareCredential.
 *
 * Mocks the Zustand stores with mutable state objects, stubs UI primitives,
 * and mocks i18n to return keys so assertions are stable across locale
 * changes (same pattern as GroupsList.test.tsx).
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

// ── Mock backend groups module (share/unshare spies) ────────────────────────
const groupsShareCredential = jest.fn(async () => ({ success: true }));
const groupsUnshareCredential = jest.fn(async () => ({ success: true }));
jest.mock('@/lib/backend/modules/groups', () => ({
  groupsShareCredential: (...args: unknown[]) => groupsShareCredential(...args),
  groupsUnshareCredential: (...args: unknown[]) => groupsUnshareCredential(...args),
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
  Checkbox: ({ id, label, checked, onChange, ...rest }: any) => (
    <label {...rest}>
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={() => onChange?.()}
        data-testid={`checkbox-${id}`}
      />
      <span>{label}</span>
    </label>
  ),
  Tooltip: ({ children, content }: any) => (
    <span title={content}>{children}</span>
  ),
}));

// ── Mutable store state mocks ───────────────────────────────────────────────
const gatewayState: any = {
  credentials: [],
  loading: { credentials: false },
  errors: { credentials: null },
  fetchCredentials: jest.fn(async () => undefined),
  deleteCredential: jest.fn(async () => undefined),
};

jest.mock('@/stores/aiGateway', () => ({
  useAiGatewayStore: () => gatewayState,
}));

const groupsState: any = {
  groups: [],
  fetchList: jest.fn(async () => undefined),
};

jest.mock('@/stores/groups', () => ({
  useGroupsStore: (selector?: (s: any) => any) =>
    selector ? selector(groupsState) : groupsState,
}));

const authState: any = {
  enabled: true,
  user: { id: 42, username: 'me', role: 'admin' },
};

jest.mock('@/stores/auth', () => ({
  useAuthStore: (selector?: (s: any) => any) =>
    selector ? selector(authState) : authState,
}));

// testCredentialConnection is imported by the component but not exercised here.
jest.mock('@/lib/backend/modules/aiGateway', () => ({
  testCredentialConnection: jest.fn(async () => ({ success: true })),
}));

import { CredentialsList } from '@/components/ai-gateway/CredentialsList';
import type { Credential, ProviderEndpoint } from '@/lib/backend/modules/aiGateway';
import { askConfirm } from '@/components/ui/ConfirmDialogHost';

// ── Factory helpers ─────────────────────────────────────────────────────────

const endpoint: ProviderEndpoint = {
  id: 'ep-1',
  name: 'Test Endpoint',
  adapterType: 'openai',
  baseUrl: 'https://api.example.com',
  enabled: true,
  defaultHeaders: null,
  discoveryPolicy: null,
  healthPolicy: null,
  circuitState: 'closed',
  circuitOpenedAt: null,
  circuitRetryAt: null,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: null,
};

function makeCredential(overrides: Partial<Credential> = {}): Credential {
  return {
    id: overrides.id ?? 'cred-1',
    providerEndpointId: 'ep-1',
    label: overrides.label ?? 'My Key',
    authType: 'api_key',
    fingerprint: 'abcdef0123456789',
    enabled: true,
    runtimeStatus: 'active',
    statusReason: null,
    nextRetryAt: null,
    quotaResetAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    consecutiveFailures: 0,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: null,
    ownerId: overrides.ownerId,
    sharedGroupIds: overrides.sharedGroupIds ?? [],
    sharedGroupNames: overrides.sharedGroupNames ?? [],
    ...overrides,
  } as Credential;
}

function makeGroup(overrides: Partial<{ id: string; name: string; member_count: number; key_count: number }> = {}) {
  return {
    id: overrides.id ?? 'g-1',
    name: overrides.name ?? 'Team Alpha',
    role: 'owner' as const,
    member_count: overrides.member_count ?? 3,
    key_count: overrides.key_count ?? 1,
    created_at: '2024-01-01T00:00:00Z',
  };
}

// ── Reset localStorage + mocks before each ──────────────────────────────────
beforeEach(() => {
  jest.clearAllMocks();
  (askConfirm as any).mockResolvedValue(true);
  groupsShareCredential.mockResolvedValue({ success: true });
  groupsUnshareCredential.mockResolvedValue({ success: true });
  gatewayState.credentials = [];
  gatewayState.loading.credentials = false;
  gatewayState.errors.credentials = null;
  groupsState.groups = [];
  authState.enabled = true;
  authState.user = { id: 42, username: 'me', role: 'admin' };
  // Clear consent localStorage so each test starts un-consented.
  try {
    localStorage.clear();
  } catch {
    // jsdom may not have localStorage in some configs
  }
});

// ── Scope chips ──────────────────────────────────────────────────────────────

describe('CredentialsList — scope chips', () => {
  it('renders personal chip for a credential owned by the current user', () => {
    gatewayState.credentials = [makeCredential({ id: 'cred-mine', ownerId: 42 })];

    render(
      <CredentialsList endpoint={endpoint} onAddCredential={jest.fn()} onEditCredential={jest.fn()} />,
    );

    expect(screen.getByText('ownership.mine')).toBeTruthy();
    // Legacy chip must NOT render (ownerId is set).
    expect(screen.queryByText('ownership.shared')).toBeNull();
  });

  it('renders a group chip per shared group name', () => {
    gatewayState.credentials = [
      makeCredential({
        id: 'cred-shared',
        ownerId: 42,
        sharedGroupIds: ['g-1', 'g-2'],
        sharedGroupNames: ['Team Alpha', 'Team Beta'],
      }),
    ];

    render(
      <CredentialsList endpoint={endpoint} onAddCredential={jest.fn()} onEditCredential={jest.fn()} />,
    );

    expect(screen.getByText('Team Alpha')).toBeTruthy();
    expect(screen.getByText('Team Beta')).toBeTruthy();
    // Personal chip also renders (ownerId === current user).
    expect(screen.getByText('ownership.mine')).toBeTruthy();
  });

  it('renders legacy chip when ownerId is null (instance-shared)', () => {
    gatewayState.credentials = [makeCredential({ id: 'cred-legacy', ownerId: null as unknown as undefined })];

    render(
      <CredentialsList endpoint={endpoint} onAddCredential={jest.fn()} onEditCredential={jest.fn()} />,
    );

    expect(screen.getByText('ownership.shared')).toBeTruthy();
    // No personal chip (no current-user ownership).
    expect(screen.queryByText('ownership.mine')).toBeNull();
  });
});

// ── Share picker + consent-once ─────────────────────────────────────────────

describe('CredentialsList — share picker + consent-once', () => {
  it('disables the share action when the credential is not mine', () => {
    gatewayState.credentials = [makeCredential({ id: 'cred-other', ownerId: 99 })];

    render(
      <CredentialsList endpoint={endpoint} onAddCredential={jest.fn()} onEditCredential={jest.fn()} />,
    );

    // The OverflowMenu mock renders items as buttons; find the share item by label.
    const shareItem = screen.getByText('ai.groups.share.action').closest('button');
    expect(shareItem).toBeTruthy();
    expect((shareItem as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens the consent modal on first share, then calls groupsShareCredential after ack', async () => {
    gatewayState.credentials = [makeCredential({ id: 'cred-mine', ownerId: 42, sharedGroupIds: [] })];
    groupsState.groups = [makeGroup({ id: 'g-1', name: 'Team Alpha' })];

    render(
      <CredentialsList endpoint={endpoint} onAddCredential={jest.fn()} onEditCredential={jest.fn()} />,
    );

    // Open the share picker.
    fireEvent.click(screen.getByText('ai.groups.share.action'));

    // Picker is open — toggle the group checkbox on.
    const checkbox = screen.getByTestId('checkbox-share-group-g-1') as HTMLInputElement;
    fireEvent.click(checkbox);

    // Confirm share — consent modal should open (first share, not consented).
    fireEvent.click(screen.getByText('ai.groups.share.consent.confirm'));

    // Consent modal is open: acknowledge checkbox + confirm.
    await waitFor(() => {
      expect(screen.getByText('ai.groups.share.consent.body')).toBeTruthy();
    });
    const ackCheckbox = screen.getByTestId('checkbox-share-consent-ack') as HTMLInputElement;
    fireEvent.click(ackCheckbox);
    // Picker is closed; only the consent modal's confirm button remains.
    fireEvent.click(screen.getByText('ai.groups.share.consent.confirm'));

    await waitFor(() => {
      expect(groupsShareCredential).toHaveBeenCalledWith({
        credentialId: 'cred-mine',
        groupId: 'g-1',
      });
    });
  });

  it('skips the consent modal when the credential was already consented (localStorage)', async () => {
    // Pre-seed consent for this credential.
    try {
      localStorage.setItem('ai.groups.share.consented', JSON.stringify(['cred-mine']));
    } catch {
      // skip if localStorage unavailable
    }

    gatewayState.credentials = [makeCredential({ id: 'cred-mine', ownerId: 42, sharedGroupIds: [] })];
    groupsState.groups = [makeGroup({ id: 'g-1', name: 'Team Alpha' })];

    render(
      <CredentialsList endpoint={endpoint} onAddCredential={jest.fn()} onEditCredential={jest.fn()} />,
    );

    // Open picker, toggle group on, confirm.
    fireEvent.click(screen.getByText('ai.groups.share.action'));
    fireEvent.click(screen.getByTestId('checkbox-share-group-g-1'));
    fireEvent.click(screen.getByText('ai.groups.share.consent.confirm'));

    // No consent modal — share fires directly.
    await waitFor(() => {
      expect(groupsShareCredential).toHaveBeenCalledWith({
        credentialId: 'cred-mine',
        groupId: 'g-1',
      });
    });
    // Consent body must NOT be visible (modal skipped).
    expect(screen.queryByText('ai.groups.share.consent.body')).toBeNull();
  });

  it('calls groupsUnshareCredential when unchecking an already-shared group', async () => {
    // Pre-seed consent so the consent modal doesn't intercept.
    try {
      localStorage.setItem('ai.groups.share.consented', JSON.stringify(['cred-mine']));
    } catch {
      // skip
    }

    gatewayState.credentials = [
      makeCredential({ id: 'cred-mine', ownerId: 42, sharedGroupIds: ['g-1'], sharedGroupNames: ['Team Alpha'] }),
    ];
    groupsState.groups = [makeGroup({ id: 'g-1', name: 'Team Alpha' })];

    render(
      <CredentialsList endpoint={endpoint} onAddCredential={jest.fn()} onEditCredential={jest.fn()} />,
    );

    // Open picker — g-1 is pre-checked. Uncheck it.
    fireEvent.click(screen.getByText('ai.groups.share.action'));
    const checkbox = screen.getByTestId('checkbox-share-group-g-1') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);

    // Confirm — unshare fires (no new shares, so no consent).
    fireEvent.click(screen.getByText('ai.groups.share.consent.confirm'));

    await waitFor(() => {
      expect(groupsUnshareCredential).toHaveBeenCalledWith({
        credentialId: 'cred-mine',
        groupId: 'g-1',
      });
    });
  });
});
