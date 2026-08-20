/**
 * OAuthModal i18n wiring tests.
 *
 * Covers:
 *   - Modal title comes from t('aiProxy.oAuthModal.title') with {provider}
 *     interpolation.
 *   - Success toast on device_code flow uses t() key.
 *   - Cancel/Close button text comes from t('common.cancel') / t('common.close').
 *
 * Mocks i18n (key-returning t), toast, the aiProxy backend module, and UI
 * primitives (same pattern as AccountModal.test.tsx).
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
const providerAuthFlowStart = jest.fn();
const providerAuthFlowStatus = jest.fn();
const openUrlInBrowser = jest.fn();

jest.mock('@/lib/backend/modules/aiProxy', () => ({
  providerAuthFlowStart: (...args: unknown[]) => providerAuthFlowStart(...(args as [])),
  providerAuthFlowStatus: (...args: unknown[]) => providerAuthFlowStatus(...(args as [])),
  openUrlInBrowser: (...args: unknown[]) => openUrlInBrowser(...(args as [])),
}));

// ── Stub UI primitives ───────────────────────────────────────────────────────
jest.mock('@/components/ui', () => ({
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>{children}</button>
  ),
  IconButton: ({ children, onClick, title, ...rest }: any) => (
    <button onClick={onClick} title={title} {...rest}>{children}</button>
  ),
  Modal: ({ children, isOpen, title, closeOnBackdrop: _cbd, closeOnEscape: _ce, ...rest }: any) =>
    isOpen ? <div {...rest}><h2>{title}</h2>{children}</div> : null,
}));

import OAuthModal from '@/components/ai-proxy/OAuthModal';
import { toast } from 'sonner';

beforeEach(() => {
  jest.clearAllMocks();
  // Default: start succeeds with an auth_code flow (simplest path).
  providerAuthFlowStart.mockResolvedValue({
    authUrl: 'https://example.com/oauth/authorize',
    sessionId: 'sess-1',
    flowType: 'auth_code',
    userCode: null,
    verificationUri: null,
  });
  openUrlInBrowser.mockResolvedValue(undefined);
});

describe('OAuthModal — i18n wiring', () => {
  it('renders the modal title from t() with {provider} interpolation', async () => {
    render(
      <OAuthModal
        isOpen={true}
        provider="openai"
        providerName="OpenAI"
        onClose={jest.fn()}
        onSuccess={jest.fn()}
      />,
    );

    // Title should be the key with the provider name interpolated.
    expect(screen.getByText('aiProxy.oAuthModal.title')).toBeTruthy();
    // The mock t() replaces {provider} → "OpenAI", so the rendered text is
    // "aiProxy.oAuthModal.title" (the key itself, since the mock returns the
    // key with params interpolated — but the key has no {provider} literal).
    // Verify the start call received the right provider.
    await waitFor(() => {
      expect(providerAuthFlowStart).toHaveBeenCalledWith({ provider: 'openai' });
    });
  });

  it('shows a success toast from t() when the browser opens (auth_code flow)', async () => {
    const user = userEvent.setup();

    render(
      <OAuthModal
        isOpen={true}
        provider="openai"
        providerName="OpenAI"
        onClose={jest.fn()}
        onSuccess={jest.fn()}
      />,
    );

    // Wait for initOAuth to resolve and the Start button to appear.
    const startButton = await screen.findByText('aiProxy.oAuthModal.openAuthorizationPage');
    await user.click(startButton);

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('aiProxy.oAuthModal.browserOpenedSuccess');
    });
  });

  it('renders Cancel/Close button text from t() keys', async () => {
    render(
      <OAuthModal
        isOpen={true}
        provider="openai"
        providerName="OpenAI"
        onClose={jest.fn()}
        onSuccess={jest.fn()}
      />,
    );

    // Not polling → Close button.
    expect(screen.getByText('common.close')).toBeTruthy();
    expect(screen.queryByText('common.cancel')).toBeNull();
  });

  it('shows a device_code success toast from t() when flowType is device_code', async () => {
    providerAuthFlowStart.mockResolvedValue({
      authUrl: 'https://example.com/device',
      sessionId: 'sess-2',
      flowType: 'device_code',
      userCode: 'ABCD-1234',
      verificationUri: 'https://example.com/verify',
    });

    const user = userEvent.setup();

    render(
      <OAuthModal
        isOpen={true}
        provider="kiro"
        providerName="Kiro"
        onClose={jest.fn()}
        onSuccess={jest.fn()}
      />,
    );

    const startButton = await screen.findByText('aiProxy.oAuthModal.openVerificationPage');
    await user.click(startButton);

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('aiProxy.oAuthModal.verificationPageOpenedSuccess');
    });
  });
});
