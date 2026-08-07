/**
 * Contract tests for lib/backend/modules/accounts.ts — refreshAccounts wrapper.
 *
 * Locks down the frontend→backend invoke command name + arg shape for the
 * batch refresh command. Mocks global.fetch (HTTP backend via safeInvoke).
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { refreshAccounts } from '../../../../lib/backend/modules/accounts';

const originalFetch = globalThis.fetch;

const mockFetchOk = (data: unknown) => {
  globalThis.fetch = jest.fn<any>().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  }) as unknown as typeof fetch;
};

describe('lib/backend/modules/accounts — refreshAccounts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('invokes refresh_accounts with { accountIds }', async () => {
    const result = {
      total: 2,
      updated: 2,
      failed: 0,
      results: [
        { accountId: '1', ok: true, account: { id: 1, email: 'a@b.c' } },
        { accountId: '2', ok: true, account: { id: 2, email: 'd@e.f' } },
      ],
    };
    mockFetchOk(result);

    await expect(refreshAccounts({ accountIds: [1, 2] })).resolves.toEqual(result);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/refresh_accounts',
      expect.objectContaining({
        body: JSON.stringify({ accountIds: [1, 2] }),
      }),
    );
  });

  it('passes through failures in results', async () => {
    const result = {
      total: 2,
      updated: 1,
      failed: 1,
      results: [
        { accountId: '3', ok: true, account: { id: 3, email: 'a@b.c' } },
        { accountId: '4', ok: false, error: 'timeout' },
      ],
    };
    mockFetchOk(result);

    const res = await refreshAccounts({ accountIds: [3, 4] });
    expect(res.failed).toBe(1);
    expect(res.results[1].ok).toBe(false);
    expect(res.results[1].error).toBe('timeout');
    expect(res.results[1].account).toBeUndefined();
  });
});
