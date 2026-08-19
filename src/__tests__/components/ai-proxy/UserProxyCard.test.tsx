/**
 * UserProxyCard Wave-2 tests.
 *
 * Covers:
 *   - Renders nothing when auth is disabled (desktop mode).
 *   - Fetches proxy_keys_list on mount and renders pool chips
 *     (personal / groups / legacy) with counts.
 *   - Copy on the default key fires askConfirm (requireConfirm=true)
 *     before writing to the clipboard.
 *   - Create key calls proxyKeysCreate and shows the raw-key modal.
 *
 * Mocks the backend aiGateway module, stubs UI primitives, and mocks i18n
 * to return keys (same pattern as GroupsList.test.tsx).
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Mock i18n ───────────────────────────────────────────────────────────────
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

// ── Mock askConfirm ─────────────────────────────────────────────────────────
const askConfirmMock = jest.fn(async () => true);
jest.mock('@/components/ui/ConfirmDialogHost', () => ({
  askConfirm: (...args: unknown[]) => askConfirmMock(...(args as [])),
}));

// ── Mock backend aiGateway module (proxy_keys_* spies) ──────────────────────
const proxyKeysList = jest.fn();
const proxyKeysCreate = jest.fn();
const proxyKeysRevoke = jest.fn();

jest.mock('@/lib/backend/modules/aiGateway', () => ({
  proxyKeysList: (...args: unknown[]) => proxyKeysList(...(args as [])),
  proxyKeysCreate: (...args: unknown[]) => proxyKeysCreate(...(args as [])),
  proxyKeysRevoke: (...args: unknown[]) => proxyKeysRevoke(...(args as [])),
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
  Tooltip: ({ children, content }: any) => (
    <span title={content}>{children}</span>
  ),
  Modal: ({ children, isOpen, footer, ...rest }: any) =>
    isOpen ? (
      <div {...rest}>
        {children}
        {footer}
      </div>
    ) : null,
}));

// ── Mutable auth store mock ─────────────────────────────────────────────────
const authState: any = { enabled: true };
jest.mock('@/stores/auth', () => ({
  useAuthStore: (selector?: (s: any) => any) =>
    selector ? selector(authState) : authState,
}));

import { UserProxyCard } from '@/components/ai-proxy/UserProxyCard';

// ── Factory: a proxy_keys_list response ─────────────────────────────────────
function makeListResponse(overrides: Partial<{
  baseUrl: string;
  keys: Array<{ id: string; label: string | null; maskedKey: string; enabled: boolean; createdAt: string; lastUsedAt: string | null; isDefault: boolean }>;
  pool: { personal: number; legacy: number; groups: Array<{ id: string; name: string; keys: number }> };
}> = {}) {
  return {
    baseUrl: overrides.baseUrl ?? 'http://127.0.0.1:4000/v1',
    keys: overrides.keys ?? [
      {
        id: 'pk-1',
        label: 'default',
        maskedKey: 'abcd****wxyz',
        enabled: true,
        createdAt: '2024-01-01T00:00:00Z',
        lastUsedAt: null,
        isDefault: true,
      },
    ],
    pool: overrides.pool ?? {
      personal: 3,
      legacy: 2,
      groups: [
        { id: 'g-1', name: 'Team Alpha', keys: 4 },
      ],
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  askConfirmMock.mockResolvedValue(true);
  authState.enabled = true;
  proxyKeysList.mockResolvedValue(makeListResponse());
  proxyKeysCreate.mockResolvedValue({ key: 'raw-secret-token', id: 'pk-new' });
  proxyKeysRevoke.mockResolvedValue({ success: true });
  // Stub clipboard
  (navigator as any).clipboard = { writeText: jest.fn(async () => undefined) };
});

describe('UserProxyCard', () => {
  it('renders nothing when auth is disabled', () => {
    authState.enabled = false;
    const { container } = render(<UserProxyCard />);
    expect(container.firstChild).toBeNull();
    expect(proxyKeysList).not.toHaveBeenCalled();
  });

  it('fetches proxy_keys_list on mount and renders pool chips with counts', async () => {
    render(<UserProxyCard />);

    await waitFor(() => {
      expect(proxyKeysList).toHaveBeenCalled();
    });

    // Pool chips render with counts.
    expect(screen.getByText(/ai\.proxy\.pool\.personal/)).toBeTruthy();
    expect(screen.getByText(/Team Alpha/)).toBeTruthy();
    expect(screen.getByText(/ai\.proxy\.pool\.legacy/)).toBeTruthy();
    // Base URL + default key copy fields render.
    expect(screen.getByText('http://127.0.0.1:4000/v1')).toBeTruthy();
    expect(screen.getByText('abcd****wxyz')).toBeTruthy();
  });

  it('fires askConfirm before copying the default key (requireConfirm)', async () => {
    render(<UserProxyCard />);

    await waitFor(() => {
      expect(proxyKeysList).toHaveBeenCalled();
    });

    // Click the default-key copy button (aria-label = aiHub.actions.copy).
    // There are two copy buttons (baseUrl + defaultKey); both share the label.
    const copyButtons = screen.getAllByLabelText('aiHub.actions.copy');
    // The second one is the default key (requireConfirm=true).
    fireEvent.click(copyButtons[1]);

    await waitFor(() => {
      expect(askConfirmMock).toHaveBeenCalled();
    });
    // askConfirm options: title = common.copy, variant = warning.
    const callArgs = askConfirmMock.mock.calls[0][0];
    expect(callArgs.variant).toBe('warning');
    expect(callArgs.title).toBe('common.copy');
  });

  it('creates a key and shows the raw-key modal once', async () => {
    render(<UserProxyCard />);

    await waitFor(() => {
      expect(proxyKeysList).toHaveBeenCalled();
    });

    // Click "Create key".
    fireEvent.click(screen.getByText('ai.proxy.createKey'));

    await waitFor(() => {
      expect(proxyKeysCreate).toHaveBeenCalled();
    });

    // Raw-key modal is open with the raw token + the hint.
    await waitFor(() => {
      expect(screen.getByText('ai.proxy.rawKeyHint')).toBeTruthy();
      expect(screen.getByText('raw-secret-token')).toBeTruthy();
    });
  });
});
