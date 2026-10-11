/**
 * useAiProvidersController — per-page fetch gating (AC13).
 *
 * The three AI Hub route pages pass their page id so the controller only
 * fetches the data that page renders; callers without a page (AiIntegrations)
 * keep the legacy fetch-everything behavior.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react';

jest.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('@/lib/observability/toast', () => ({
  appToast: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

jest.mock('@/components/ui/ConfirmDialogHost', () => ({
  askConfirm: jest.fn(async () => true),
}));

jest.mock('@/lib/observability/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

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

const aiProxyFns = {
  getAiProxyAccounts: jest.fn(async () => []),
  deleteAiProxyAccount: jest.fn(async () => undefined),
  updateAiProxyAccount: jest.fn(async () => undefined),
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
};
jest.mock('@/lib/backend/modules/aiProxy', () => aiProxyFns);

import { useAiProvidersController } from '@/pages/hooks/useAiProvidersController';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useAiProvidersController page fetch gating', () => {
  it('providers page fetches accounts, quotas and proxy info only', async () => {
    renderHook(() => useAiProvidersController('providers'));

    await waitFor(() => {
      expect(aiProxyFns.getAiProxyAccounts).toHaveBeenCalled();
    });
    expect(aiProxyFns.fetchAllQuotasSafe).toHaveBeenCalled();
    expect(aiProxyFns.getProxySettings).toHaveBeenCalled();
    expect(aiProxyFns.getProviderModelMappings).not.toHaveBeenCalled();
    expect(aiProxyFns.getAvailableModelsSafe).not.toHaveBeenCalled();
    expect(aiProxyFns.getProviderCapabilities).not.toHaveBeenCalled();
    expect(aiProxyFns.getRequestHistory).not.toHaveBeenCalled();
  });

  it('routing page fetches accounts, mappings, capabilities and models but not quotas or history', async () => {
    renderHook(() => useAiProvidersController('routing'));

    await waitFor(() => {
      expect(aiProxyFns.getProviderModelMappings).toHaveBeenCalled();
    });
    expect(aiProxyFns.getAvailableModelsSafe).toHaveBeenCalled();
    expect(aiProxyFns.getProviderCapabilities).toHaveBeenCalled();
    expect(aiProxyFns.getAiProxyAccounts).toHaveBeenCalled();
    expect(aiProxyFns.getProxySettings).toHaveBeenCalled();
    expect(aiProxyFns.fetchAllQuotasSafe).not.toHaveBeenCalled();
    expect(aiProxyFns.getRequestHistory).not.toHaveBeenCalled();
  });

  it('monitor page fetches history, accounts, quotas, capabilities, models and proxy info', async () => {
    renderHook(() => useAiProvidersController('monitor'));

    await waitFor(() => {
      expect(aiProxyFns.getRequestHistory).toHaveBeenCalled();
    });
    expect(aiProxyFns.getAiProxyAccounts).toHaveBeenCalled();
    expect(aiProxyFns.fetchAllQuotasSafe).toHaveBeenCalled();
    expect(aiProxyFns.getProviderCapabilities).toHaveBeenCalled();
    expect(aiProxyFns.getAvailableModelsSafe).toHaveBeenCalled();
    expect(aiProxyFns.getProxySettings).toHaveBeenCalled();
  });

  it('without a page argument fetches everything (legacy callers)', async () => {
    renderHook(() => useAiProvidersController());

    await waitFor(() => {
      expect(aiProxyFns.getRequestHistory).toHaveBeenCalled();
    });
    expect(aiProxyFns.getAiProxyAccounts).toHaveBeenCalled();
    expect(aiProxyFns.fetchAllQuotasSafe).toHaveBeenCalled();
    expect(aiProxyFns.getProviderModelMappings).toHaveBeenCalled();
    expect(aiProxyFns.getProxySettings).toHaveBeenCalled();
  });
});
