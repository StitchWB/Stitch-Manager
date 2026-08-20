/**
 * AccountModal masked-secret hardening tests.
 *
 * Covers:
 *   - Edit modal renders a masked secret field as disabled + hint text.
 *   - Submit payload excludes masked secrets (sends null) so the backend
 *     _pick_secret skips rotation and keeps the existing value.
 *
 * Mocks i18n, toast, the aiProxy backend module, OAuthModal, and UI
 * primitives (same pattern as UserProxyCard.test.tsx).
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AiProxyAccount } from '../../../types/generated';

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
jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

// ── Mock backend aiProxy module ──────────────────────────────────────────────
const updateAiProxyAccount = jest.fn(async () => undefined);
const createAiProxyAccount = jest.fn(async () => 1);

jest.mock('@/lib/backend/modules/aiProxy', () => ({
  updateAiProxyAccount: (...args: unknown[]) => updateAiProxyAccount(...(args as [])),
  createAiProxyAccount: (...args: unknown[]) => createAiProxyAccount(...(args as [])),
}));

// ── Mock OAuthModal ──────────────────────────────────────────────────────────
jest.mock('@/components/ai-proxy/OAuthModal', () => ({
  __esModule: true,
  default: () => null,
}));

// ── Stub UI primitives ───────────────────────────────────────────────────────
jest.mock('@/components/ui', () => ({
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>{children}</button>
  ),
  Input: (props: any) => <input {...props} />,
  Modal: ({ children, isOpen, title, ...rest }: any) =>
    isOpen ? <div {...rest}><h2>{title}</h2>{children}</div> : null,
  Select: ({ value, onChange, options, ...rest }: any) => (
    <select value={value} onChange={onChange} {...rest}>
      {options.map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
  Toggle: ({ checked, onChange, ...rest }: any) => (
    <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} {...rest} />
  ),
}));

import AccountModal from '@/components/ai-proxy/AccountModal';

// ── Factory: an AiProxyAccount with a masked apiKey ─────────────────────────
function makeMaskedAccount(overrides: Partial<AiProxyAccount> = {}): AiProxyAccount {
  return {
    id: 1,
    provider: 'openai',
    name: 'Masked Account',
    oauthToken: null,
    apiKey: 'abcd****wxyz',
    sessionToken: null,
    enabled: true,
    accountType: 'free',
    requestsToday: 0,
    requestsTotal: 0,
    tokensUsed: 0,
    lastUsedAt: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as AiProxyAccount;
}

beforeEach(() => {
  jest.clearAllMocks();
  updateAiProxyAccount.mockResolvedValue(undefined);
  createAiProxyAccount.mockResolvedValue(1);
});

describe('AccountModal — masked secret hardening', () => {
  it('renders a masked apiKey field as disabled with hint text', async () => {
    const account = makeMaskedAccount();

    render(
      <AccountModal
        isOpen={true}
        account={account}
        onClose={jest.fn()}
        onSubmit={jest.fn()}
      />,
    );

    // Wait for the queueMicrotask in useEffect to set formData.
    const apiKeyInput = await screen.findByPlaceholderText('sk-...');
    expect(apiKeyInput).toBeDisabled();
    expect(apiKeyInput).toHaveAttribute('value', 'abcd****wxyz');

    // Hint text is rendered.
    expect(screen.getByText('aiProxy.secretMaskedHint')).toBeTruthy();
  });

  it('excludes masked secrets from the submit payload (sends null)', async () => {
    const user = userEvent.setup();
    const account = makeMaskedAccount();
    const onSubmit = jest.fn();

    render(
      <AccountModal
        isOpen={true}
        account={account}
        onClose={jest.fn()}
        onSubmit={onSubmit}
      />,
    );

    // Wait for formData to populate from the account.
    await screen.findByPlaceholderText('sk-...');

    // Submit the form.
    const submitButton = screen.getByText('aiHub.account_modal.update');
    await user.click(submitButton);

    await waitFor(() => {
      expect(updateAiProxyAccount).toHaveBeenCalledTimes(1);
    });

    const payload = updateAiProxyAccount.mock.calls[0][0] as AiProxyAccount;
    // Masked apiKey must be excluded (null) so backend skips rotation.
    expect(payload.apiKey).toBeNull();
    // Non-active method fields are also null.
    expect(payload.oauthToken).toBeNull();
    expect(payload.sessionToken).toBeNull();
    // Non-secret fields are preserved.
    expect(payload.id).toBe(1);
    expect(payload.provider).toBe('openai');
    expect(payload.name).toBe('Masked Account');
  });

  it('submits a real (non-masked) apiKey normally when editing', async () => {
    const user = userEvent.setup();
    const account = makeMaskedAccount({ apiKey: 'sk-real-key-123' });
    const onSubmit = jest.fn();

    render(
      <AccountModal
        isOpen={true}
        account={account}
        onClose={jest.fn()}
        onSubmit={onSubmit}
      />,
    );

    await screen.findByPlaceholderText('sk-...');

    const submitButton = screen.getByText('aiHub.account_modal.update');
    await user.click(submitButton);

    await waitFor(() => {
      expect(updateAiProxyAccount).toHaveBeenCalledTimes(1);
    });

    const payload = updateAiProxyAccount.mock.calls[0][0] as AiProxyAccount;
    expect(payload.apiKey).toBe('sk-real-key-123');
  });

  it('renders the modal title and submit button from t() keys', async () => {
    // Edit mode: title and button should use the edit_title / update keys.
    const account = makeMaskedAccount();

    const { rerender } = render(
      <AccountModal
        isOpen={true}
        account={account}
        onClose={jest.fn()}
        onSubmit={jest.fn()}
      />,
    );

    await screen.findByPlaceholderText('sk-...');

    // Title comes from t('aiHub.account_modal.edit_title').
    expect(screen.getByText('aiHub.account_modal.edit_title')).toBeTruthy();
    // Submit button comes from t('aiHub.account_modal.update').
    expect(screen.getByText('aiHub.account_modal.update')).toBeTruthy();

    // Add mode: title and button should switch to add_title / create keys.
    rerender(
      <AccountModal
        isOpen={true}
        account={null}
        onClose={jest.fn()}
        onSubmit={jest.fn()}
      />,
    );

    // Title comes from t('aiHub.account_modal.add_title').
    expect(screen.getByText('aiHub.account_modal.add_title')).toBeTruthy();
    // Submit button comes from t('aiHub.account_modal.create').
    expect(screen.getByText('aiHub.account_modal.create')).toBeTruthy();
  });
});
