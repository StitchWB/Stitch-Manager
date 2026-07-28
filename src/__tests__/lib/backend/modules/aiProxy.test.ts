/**
 * Contract tests for lib/Backend/modules/aiProxy.ts
 *
 * Minimal assertions only: lock down key command + nested arg shape.
 * Mocks global.fetch (HTTP backend via safeInvoke).
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import {
  createAiProxyAccount,
  getAvailableModels,
  getProviderCapabilities,
  getProviderModelMappings,
  scanAuthFiles,
  setProviderModelMappings,
  testProviderConnection,
} from '../../../../lib/backend/modules/aiProxy';
import type { AiProxyAccount } from '../../../../types/generated';

const originalFetch = globalThis.fetch;

const mockFetchOk = (data: unknown) => {
  globalThis.fetch = jest.fn<any>().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  }) as unknown as typeof fetch;
};

describe('lib/Backend/modules/aiProxy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('createAiProxyAccount invokes create_ai_proxy_account with account.apiKey present', async () => {
    mockFetchOk(123);

    const apiKey = 'sk-test-123';
    const account: AiProxyAccount = {
      id: null,
      provider: 'openai',
      name: 'From Key',
      oauthToken: null,
      apiKey,
      sessionToken: null,
      enabled: true,
      accountType: 'free',
      requestsToday: 0,
      requestsTotal: 0,
      tokensUsed: 0,
      lastUsedAt: null,
      createdAt: 0,
      updatedAt: 0,
    };

    await expect(createAiProxyAccount(account)).resolves.toBe(123);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/create_ai_proxy_account',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    // Verify body contains the apiKey
    const callArgs = (globalThis.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse((callArgs[1] as { body: string }).body);
    expect(body.account.apiKey).toBe(apiKey);
  });

  it('getAvailableModels invokes get_available_models with no args', async () => {
    mockFetchOk([]);

    await expect(getAvailableModels()).resolves.toEqual([]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/get_available_models',
      expect.objectContaining({ body: JSON.stringify({}) }),
    );
  });

  it('getProviderCapabilities invokes get_provider_capabilities with no args', async () => {
    mockFetchOk([]);

    await expect(getProviderCapabilities()).resolves.toEqual([]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/get_provider_capabilities',
      expect.objectContaining({ body: JSON.stringify({}) }),
    );
  });

  it('getProviderModelMappings invokes get_provider_model_mappings with no args', async () => {
    mockFetchOk([]);

    await expect(getProviderModelMappings()).resolves.toEqual([]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/get_provider_model_mappings',
      expect.objectContaining({ body: JSON.stringify({}) }),
    );
  });

  it('setProviderModelMappings invokes set_provider_model_mappings with { mappings }', async () => {
    const mappings = [{ modelPattern: '^gpt-', provider: 'openai', modelId: 'gpt-4-turbo' }];
    mockFetchOk(undefined);

    await expect(setProviderModelMappings(mappings)).resolves.toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/set_provider_model_mappings',
      expect.objectContaining({ body: JSON.stringify({ mappings }) }),
    );
  });

  it('testProviderConnection invokes test_provider_connection with provider and modelId', async () => {
    const result = {
      success: true,
      provider: 'openai',
      modelId: 'gpt-4-turbo',
      message: 'ok',
    };
    mockFetchOk(result);

    await expect(testProviderConnection('openai', 'gpt-4-turbo')).resolves.toEqual(result);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/test_provider_connection',
      expect.objectContaining({
        body: JSON.stringify({ provider: 'openai', model_id: 'gpt-4-turbo' }),
      }),
    );
  });

  it('scanAuthFiles invokes scan_auth_files with no args', async () => {
    mockFetchOk([]);

    await expect(scanAuthFiles()).resolves.toEqual([]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/scan_auth_files',
      expect.objectContaining({ body: JSON.stringify({}) }),
    );
  });
});
