/**
 * Contract tests for lib/Backend/modules/apiKeys.ts
 *
 * Goal: lock down frontend<->backend invoke command names + arg shapes.
 * Mocks global.fetch (HTTP backend via safeInvoke).
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import {
  getGeminiApiKeys,
  setGeminiApiKeys,
  getOpenAIApiKeys,
  setOpenAIApiKeys,
  getAntigravityApiKeys,
  setAntigravityApiKeys,
  getZaiApiKeys,
  setZaiApiKeys,
  type ZaiApiKey,
} from '../../../../lib/backend/modules/apiKeys';
import type { AntigravityApiKey, GeminiApiKey, OpenAIApiKey } from '../../../../types/generated';

const originalFetch = globalThis.fetch;

const mockFetchOk = (data: unknown) => {
  globalThis.fetch = jest.fn<any>().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  }) as unknown as typeof fetch;
};

describe('lib/Backend/modules/apiKeys', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('getGeminiApiKeys invokes get_gemini_api_keys with no args', async () => {
    const keys: GeminiApiKey[] = [{ apiKey: 'gemini-1' }];
    mockFetchOk(keys);

    await expect(getGeminiApiKeys()).resolves.toEqual(keys);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/get_gemini_api_keys',
      expect.objectContaining({ body: JSON.stringify({}) }),
    );
  });

  it('setGeminiApiKeys invokes set_gemini_api_keys with { keys }', async () => {
    const keys: GeminiApiKey[] = [{ apiKey: 'gemini-1' }];
    mockFetchOk(undefined);

    await expect(setGeminiApiKeys(keys)).resolves.toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/set_gemini_api_keys',
      expect.objectContaining({ body: JSON.stringify({ keys }) }),
    );
  });

  it('getOpenAIApiKeys invokes get_openai_api_keys with no args', async () => {
    const keys: OpenAIApiKey[] = [{ apiKey: 'openai-1' }];
    mockFetchOk(keys);

    await expect(getOpenAIApiKeys()).resolves.toEqual(keys);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/get_openai_api_keys',
      expect.objectContaining({ body: JSON.stringify({}) }),
    );
  });

  it('setOpenAIApiKeys invokes set_openai_api_keys with { keys }', async () => {
    const keys: OpenAIApiKey[] = [{ apiKey: 'openai-1' }];
    mockFetchOk(undefined);

    await expect(setOpenAIApiKeys(keys)).resolves.toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/set_openai_api_keys',
      expect.objectContaining({ body: JSON.stringify({ keys }) }),
    );
  });

  it('getAntigravityApiKeys invokes get_antigravity_api_keys with no args', async () => {
    const keys: AntigravityApiKey[] = [{ apiKey: 'ag-1' }];
    mockFetchOk(keys);

    await expect(getAntigravityApiKeys()).resolves.toEqual(keys);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/get_antigravity_api_keys',
      expect.objectContaining({ body: JSON.stringify({}) }),
    );
  });

  it('setAntigravityApiKeys invokes set_antigravity_api_keys with { keys }', async () => {
    const keys: AntigravityApiKey[] = [{ apiKey: 'ag-1' }];
    mockFetchOk(undefined);

    await expect(setAntigravityApiKeys(keys)).resolves.toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/set_antigravity_api_keys',
      expect.objectContaining({ body: JSON.stringify({ keys }) }),
    );
  });

  it('getZaiApiKeys invokes get_zai_api_keys with no args', async () => {
    const keys: ZaiApiKey[] = [{ apiKey: 'zai-1', baseUrl: null, prefix: null }];
    mockFetchOk(keys);

    await expect(getZaiApiKeys()).resolves.toEqual(keys);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/get_zai_api_keys',
      expect.objectContaining({ body: JSON.stringify({}) }),
    );
  });

  it('setZaiApiKeys invokes set_zai_api_keys with { keys }', async () => {
    const keys: ZaiApiKey[] = [{ apiKey: 'zai-1', baseUrl: null, prefix: null }];
    mockFetchOk(undefined);

    await expect(setZaiApiKeys(keys)).resolves.toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/set_zai_api_keys',
      expect.objectContaining({ body: JSON.stringify({ keys }) }),
    );
  });
});
