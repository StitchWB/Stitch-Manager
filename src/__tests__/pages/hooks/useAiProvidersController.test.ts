/**
 * useAiProvidersController — handleToggleEnabled masked-secret strip test.
 *
 * Verifies that toggling enabled on an account whose secrets are masked
 * (first4+"****"+last4) strips those secrets to null before calling
 * updateAiProxyAccount, so the backend never receives a mask placeholder
 * as the real secret value.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { renderHook, act, waitFor } from '@testing-library/react';
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
jest.mock('@/lib/observability/toast', () => ({
  appToast: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

// ── Mock askConfirm ─────────────────────────────────────────────────────────
jest.mock('@/components/ui/ConfirmDialogHost', () => ({
  askConfirm: jest.fn(async () => true),
}));

// ── Mock logger ─────────────────────────────────────────────────────────────
jest.mock('@/lib/observability/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

// ── Mock aiProxy store ──────────────────────────────────────────────────────
const storeState = {
  setProviderQuotas: jest.fn(),
  setOpenAiAccountQuotas: jest.fn(),
  setKiroAccountQuotas: jest.fn(),
  openAiAccountQuotas: {} as Record<string, unknown>,
};
jest.mock('@/stores/aiProxy', () => ({
  useAiProxyStore: (selector?: (s: any) => any) =>
    selector ? selector(storeState) : storeState,
  refreshProxyStatus: jest.fn(async () => null),
}));

// ── Mock backend aiProxy module ──────────────────────────────────────────────
const updateAiProxyAccount = jest.fn(async () => undefined);
const getAiProxyAccounts = jest.fn(async () => [] as AiProxyAccount[]);

jest.mock('@/lib/backend/modules/aiProxy', () => ({
  getAiProxyAccounts: (...args: unknown[]) => getAiProxyAccounts(...(args as [])),
  deleteAiProxyAccount: jest.fn(async () => undefined),
  updateAiProxyAccount: (...args: unknown[]) => updateAiProxyAccount(...(args as [])),
  debugRunAiProxyMigration: jest.fn(async () => ''),
  getAvailableModelsSafe: jest.fn(async () => []),
  getProviderCapabilities: jest.fn(async () => []),
  getProviderModelMappings: jest.fn(async () => []),
  setProviderModelMappings: jest.fn(async () => undefined),
  testProviderConnection: jest.fn(async () => ({ success: true, provider: '', message: 'ok' })),
  getRequestHistory: jest.fn(async () => []),
  startAiProxy: jest.fn(async () => null),
  stopAiProxy: jest.fn(async () => null),
  getProxySettings: jest.fn(async () => null),
  updateProxySettings: jest.fn(async () => undefined),
  exportAiProxyAccountsPayload: jest.fn(async () => ''),
  importAiProxyAccountsPayload: jest.fn(async () => 0),
  fetchAllQuotasSafe: jest.fn(async () => []),
  fetchOpenAiAccountQuotasSafe: jest.fn(async () => []),
  fetchKiroAccountQuotasSafe: jest.fn(async () => []),
  scanAuthFiles: jest.fn(async () => []),
}));

import { useAiProvidersController } from '@/pages/hooks/useAiProvidersController';

// ── Factory: an AiProxyAccount with all secrets masked ─────────────────────
function makeMaskedAccount(overrides: Partial<AiProxyAccount> = {}): AiProxyAccount {
  return {
    id: 42,
    provider: 'openai',
    name: 'Masked Toggle Account',
    oauthToken: 'toke****nend',
    apiKey: 'abcd****wxyz',
    sessionToken: 'sess****oken',
    oauthRefreshToken: 'refr****eshd',
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
  getAiProxyAccounts.mockResolvedValue([]);
});

describe('useAiProvidersController — handleToggleEnabled masked-secret strip', () => {
  it('strips masked secrets to null when toggling enabled', async () => {
    const { result } = renderHook(() => useAiProvidersController());

    const account = makeMaskedAccount();

    await act(async () => {
      await result.current.handleToggleEnabled(account);
    });

    await waitFor(() => {
      expect(updateAiProxyAccount).toHaveBeenCalledTimes(1);
    });

    const payload = updateAiProxyAccount.mock.calls[0][0] as AiProxyAccount;
    // All masked secrets must be stripped to null.
    expect(payload.apiKey).toBeNull();
    expect(payload.oauthToken).toBeNull();
    expect(payload.sessionToken).toBeNull();
    expect(payload.oauthRefreshToken).toBeNull();
    // The toggle itself must flip enabled.
    expect(payload.enabled).toBe(false);
    // Non-secret fields are preserved.
    expect(payload.id).toBe(42);
    expect(payload.name).toBe('Masked Toggle Account');
  });

  it('preserves real (non-masked) secrets when toggling enabled', async () => {
    const { result } = renderHook(() => useAiProvidersController());

    const account = makeMaskedAccount({
      apiKey: 'sk-real-key',
      oauthToken: 'real-oauth-token',
      sessionToken: 'real-session-token',
      oauthRefreshToken: 'real-refresh-token',
    });

    await act(async () => {
      await result.current.handleToggleEnabled(account);
    });

    await waitFor(() => {
      expect(updateAiProxyAccount).toHaveBeenCalledTimes(1);
    });

    const payload = updateAiProxyAccount.mock.calls[0][0] as AiProxyAccount;
    expect(payload.apiKey).toBe('sk-real-key');
    expect(payload.oauthToken).toBe('real-oauth-token');
    expect(payload.sessionToken).toBe('real-session-token');
    expect(payload.oauthRefreshToken).toBe('real-refresh-token');
    expect(payload.enabled).toBe(false);
  });
});
